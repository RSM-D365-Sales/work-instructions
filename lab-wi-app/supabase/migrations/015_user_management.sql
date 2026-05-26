-- ============================================================
-- Migration 015: User management UI support
--   * Add email column to public.profiles (mirrors auth.users.email)
--   * Update handle_new_user() trigger to populate it
--   * Backfill emails for any existing profiles
--   * Add an "Admins can read all profiles" SELECT policy (already
--     permitted under existing "Users can read all profiles" — kept
--     idempotent here)
--   * Helpful index on profiles.role for the assignment dropdown
-- Run in Supabase SQL Editor.
-- ============================================================

-- 1) Email column ----------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email text;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_unique
  ON public.profiles (lower(email))
  WHERE email IS NOT NULL;

-- 2) Backfill emails from auth.users ---------------------------------
UPDATE public.profiles p
   SET email = u.email
  FROM auth.users u
 WHERE p.id = u.id
   AND (p.email IS NULL OR p.email <> u.email);

-- 3) Re-create handle_new_user() to capture email + role from metadata
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, role)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'full_name', new.email),
    new.email,
    COALESCE(new.raw_user_meta_data->>'role', 'operator')
  )
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name);
  RETURN new;
END;
$$;

-- 4) Index for assignment dropdowns ----------------------------------
CREATE INDEX IF NOT EXISTS profiles_role_idx ON public.profiles (role);

-- 5) Admin-only DELETE policy on profiles ----------------------------
-- (Admin already has FOR ALL via migration 003, but be explicit.)
-- No additional policy needed.
