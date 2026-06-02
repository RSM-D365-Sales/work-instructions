-- ============================================================
-- Migration 025: Quality Control (QC capture, COA/COQ, trending)
--   * qc_tests        — the QC specification panel for a reagent item
--                       (e.g. pH 7.2–7.6, Osmolality 280–300 mOsm/kg)
--   * qc_results      — actual measured values captured against a
--                       production order; spec limits are snapshotted
--                       onto each result so certificates stay immutable
--                       and trending stays consistent.
--   * qc_certificates — issued Certificate of Analysis / Quality records
--                       (auto number COA-YYYY-NNNN / COQ-YYYY-NNNN).
-- Run in Supabase SQL Editor.
-- ============================================================

-- 1) QC TEST SPECIFICATIONS (on the reagent item) --------------------
CREATE TABLE IF NOT EXISTS public.qc_tests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reagent_item_id   uuid NOT NULL REFERENCES public.reagent_items(id) ON DELETE CASCADE,
  test_order        integer NOT NULL DEFAULT 0,
  name              text NOT NULL,                       -- e.g. "pH", "Osmolality"
  unit              text,                                -- e.g. "mOsm/kg", "mS/cm"
  result_type       text NOT NULL DEFAULT 'numeric'
                      CHECK (result_type IN ('numeric','text','passfail')),
  lower_limit       numeric,                             -- numeric spec lower bound
  upper_limit       numeric,                             -- numeric spec upper bound
  target            numeric,                             -- optional target value
  expected_text     text,                                -- expected value for qualitative tests
  method            text,                                -- e.g. "USP <791>"
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES public.profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_qc_tests_reagent_item ON public.qc_tests (reagent_item_id, test_order);

-- 2) QC RESULTS (captured against a production order) ----------------
CREATE TABLE IF NOT EXISTS public.qc_results (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_order_id  uuid NOT NULL REFERENCES public.production_orders(id) ON DELETE CASCADE,
  qc_test_id           uuid REFERENCES public.qc_tests(id) ON DELETE SET NULL,
  test_order           integer NOT NULL DEFAULT 0,
  -- snapshot of the spec at capture time (immutable on the certificate)
  name                 text NOT NULL,
  unit                 text,
  result_type          text NOT NULL DEFAULT 'numeric'
                         CHECK (result_type IN ('numeric','text','passfail')),
  lower_limit          numeric,
  upper_limit          numeric,
  target               numeric,
  expected_text        text,
  method               text,
  -- captured measurement
  result_numeric       numeric,
  result_text          text,
  passed               boolean,                          -- evaluated app-side; null = N/A
  instrument           text,
  comment              text,
  tested_by            uuid REFERENCES public.profiles(id),
  tested_at            timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qc_results_order ON public.qc_results (production_order_id);
CREATE INDEX IF NOT EXISTS idx_qc_results_test  ON public.qc_results (qc_test_id);
-- one result per test per order (history preserved if a spec is later removed)
CREATE UNIQUE INDEX IF NOT EXISTS uq_qc_results_order_test
  ON public.qc_results (production_order_id, qc_test_id)
  WHERE qc_test_id IS NOT NULL;

-- 3) QC CERTIFICATES (issued COA / COQ) ------------------------------
CREATE SEQUENCE IF NOT EXISTS public.qc_certificate_seq START 1;

CREATE TABLE IF NOT EXISTS public.qc_certificates (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_order_id  uuid NOT NULL REFERENCES public.production_orders(id) ON DELETE CASCADE,
  certificate_number   text NOT NULL UNIQUE,
  cert_type            text NOT NULL DEFAULT 'COA'
                         CHECK (cert_type IN ('COA','COQ')),
  issued_by            uuid REFERENCES public.profiles(id),
  issued_at            timestamptz NOT NULL DEFAULT now(),
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qc_certificates_order ON public.qc_certificates (production_order_id);

-- Auto-assign certificate_number (COA-2026-0001) when not supplied
CREATE OR REPLACE FUNCTION public.set_qc_certificate_number()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.certificate_number IS NULL OR NEW.certificate_number = '' THEN
    NEW.certificate_number := NEW.cert_type || '-' || to_char(now(), 'YYYY') || '-' ||
                              lpad(nextval('public.qc_certificate_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_qc_certificate_number ON public.qc_certificates;
CREATE TRIGGER trg_qc_certificate_number
  BEFORE INSERT ON public.qc_certificates
  FOR EACH ROW EXECUTE FUNCTION public.set_qc_certificate_number();

-- 4) updated_at triggers ---------------------------------------------
CREATE OR REPLACE FUNCTION public.set_qc_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_qc_tests_updated_at ON public.qc_tests;
CREATE TRIGGER trg_qc_tests_updated_at
  BEFORE UPDATE ON public.qc_tests
  FOR EACH ROW EXECUTE FUNCTION public.set_qc_updated_at();

DROP TRIGGER IF EXISTS trg_qc_results_updated_at ON public.qc_results;
CREATE TRIGGER trg_qc_results_updated_at
  BEFORE UPDATE ON public.qc_results
  FOR EACH ROW EXECUTE FUNCTION public.set_qc_updated_at();

-- 5) RLS -------------------------------------------------------------
ALTER TABLE public.qc_tests        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qc_results      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qc_certificates ENABLE ROW LEVEL SECURITY;

-- qc_tests: everyone authenticated reads; admin/author/approver manage
DROP POLICY IF EXISTS "qc_tests_read" ON public.qc_tests;
CREATE POLICY "qc_tests_read" ON public.qc_tests
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "qc_tests_write" ON public.qc_tests;
CREATE POLICY "qc_tests_write" ON public.qc_tests
  FOR ALL
  USING (public.current_user_role() IN ('admin','author','approver'))
  WITH CHECK (public.current_user_role() IN ('admin','author','approver'));

-- qc_results: everyone authenticated reads + captures (operators record QC)
DROP POLICY IF EXISTS "qc_results_read" ON public.qc_results;
CREATE POLICY "qc_results_read" ON public.qc_results
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "qc_results_write" ON public.qc_results;
CREATE POLICY "qc_results_write" ON public.qc_results
  FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- qc_certificates: everyone authenticated reads + issues
DROP POLICY IF EXISTS "qc_certificates_read" ON public.qc_certificates;
CREATE POLICY "qc_certificates_read" ON public.qc_certificates
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "qc_certificates_write" ON public.qc_certificates;
CREATE POLICY "qc_certificates_write" ON public.qc_certificates
  FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
