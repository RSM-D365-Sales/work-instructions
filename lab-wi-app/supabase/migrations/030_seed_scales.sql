-- ============================================================
-- Migration 030: Demo scales + scale barcode
--   * Adds a scannable `barcode` column to scales.
--   * Seeds a variety of lab balances that appear "connected"
--     (status = active → Wifi badge). None are really wired up;
--     during a run the operator scans the scale name/barcode and
--     enters the weight manually as a "live" reading.
-- Run in Supabase SQL Editor.
-- ============================================================

ALTER TABLE public.scales
  ADD COLUMN IF NOT EXISTS barcode text;

COMMENT ON COLUMN public.scales.barcode IS
  'Scannable code for the scale — matched (along with name / serial) when an operator scans to connect during a weigh step.';

-- Seed demo scales (only the ones that do not already exist by name).
INSERT INTO public.scales
  (name, barcode, model, manufacturer, serial_number, location, status,
   conn_a_type, conn_a_label, conn_a_config, preferred_conn)
SELECT
  v.name, v.barcode, v.model, v.manufacturer, v.serial_number, v.location,
  'active'::public.scale_status,
  'http_rest'::public.scale_connection_type, 'Primary',
  jsonb_build_object('url', v.url, 'polling_interval_ms', 500),
  1
FROM (VALUES
  ('Analytical Balance A1', 'SCL-A1', 'XPR205',     'Mettler Toledo', 'B204992101', 'Weigh Room 1',      'https://scale-a1.lab.local/api/weight'),
  ('Analytical Balance A2', 'SCL-A2', 'Cubis II',   'Sartorius',      'C551007722', 'Weigh Room 1',      'https://scale-a2.lab.local/api/weight'),
  ('Precision Balance P1',  'SCL-P1', 'MS3002TS',   'Mettler Toledo', 'B331845510', 'Prep Lab',          'https://scale-p1.lab.local/api/weight'),
  ('Bench Scale B1',        'SCL-B1', 'Ranger 3000','Ohaus',          'R300148899', 'Receiving Dock',    'https://scale-b1.lab.local/api/weight'),
  ('Microbalance M1',       'SCL-M1', 'MSA2.7S',    'Sartorius',      'M270055431', 'QC Laboratory',     'https://scale-m1.lab.local/api/weight')
) AS v(name, barcode, model, manufacturer, serial_number, location, url)
WHERE NOT EXISTS (
  SELECT 1 FROM public.scales s WHERE s.name = v.name
);
