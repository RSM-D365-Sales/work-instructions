-- Migration 055: Session Wishlist (live feedback board)
-- ---------------------------------------------------------------------------
-- Captures wishlist items / feedback raised during demo sessions. Everyone
-- signed in (RSM and prospect users on their own logins) can add and triage
-- items; the board is grouped by priority (Critical/High/Medium/Low) and a dev
-- tracker follows each item's status through to Completed. Realtime-enabled so
-- the board updates live on every screen — reviewed each evening to plan the
-- next day's build. Run in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS public.wishlist_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  detail      text,
  section     text NOT NULL DEFAULT 'General',
  category    text NOT NULL DEFAULT 'feature'
                CHECK (category IN ('feature','bug','idea','question','like')),
  priority    text NOT NULL DEFAULT 'medium'
                CHECK (priority IN ('critical','high','medium','low')),
  status      text NOT NULL DEFAULT 'new'
                CHECK (status IN ('new','planned','in_progress','completed','declined')),
  created_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wishlist_created ON public.wishlist_items (created_at DESC);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.wishlist_items ENABLE ROW LEVEL SECURITY;

-- Everyone signed in can see the board.
DROP POLICY IF EXISTS wishlist_select ON public.wishlist_items;
CREATE POLICY wishlist_select ON public.wishlist_items
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Everyone signed in can add an item (RSM + prospect users).
DROP POLICY IF EXISTS wishlist_insert ON public.wishlist_items;
CREATE POLICY wishlist_insert ON public.wishlist_items
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL AND created_by = auth.uid());

-- Collaborative triage: anyone signed in can update priority/status/etc.
-- (RSM drives the dev tracker; keeping it open avoids blocking the session).
DROP POLICY IF EXISTS wishlist_update ON public.wishlist_items;
CREATE POLICY wishlist_update ON public.wishlist_items
  FOR UPDATE USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- The creator or an admin can delete.
DROP POLICY IF EXISTS wishlist_delete ON public.wishlist_items;
CREATE POLICY wishlist_delete ON public.wishlist_items
  FOR DELETE USING (created_by = auth.uid() OR public.current_user_role() = 'admin');

-- ─── Realtime (live board) ───────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='wishlist_items'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.wishlist_items;
  END IF;
END $$;
