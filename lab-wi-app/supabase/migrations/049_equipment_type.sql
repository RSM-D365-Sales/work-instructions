-- Migration 049: Equipment type on the scales (equipment) table
--
-- The "Scales" page becomes "Equipment" and now holds more than balances —
-- pH meters (and osmometers, etc.). A type column lets each step pull the
-- right instrument: the Weigh step shows balances, the Adjust pH step shows
-- pH meters. Additive; existing rows default to 'balance'.
--
-- (The table keeps its name `scales` — renaming it would ripple through every
-- query, policy, and the weigh-scale integration for no functional gain. The
-- rename is a UI-level relabel to "Equipment"; the type column is the real
-- change.)
-- Run in the Supabase SQL Editor.

ALTER TABLE public.scales
  ADD COLUMN IF NOT EXISTS equipment_type text NOT NULL DEFAULT 'balance'
    CHECK (equipment_type IN ('balance', 'ph_meter', 'osmometer', 'other'));

-- Type the demo instruments seeded by scripts/seed_quality_trends.sql, if present.
UPDATE public.scales SET equipment_type = 'ph_meter'
 WHERE equipment_type = 'balance' AND name ILIKE 'pH Meter%';

UPDATE public.scales SET equipment_type = 'osmometer'
 WHERE equipment_type = 'balance' AND name ILIKE 'Osmometer%';
