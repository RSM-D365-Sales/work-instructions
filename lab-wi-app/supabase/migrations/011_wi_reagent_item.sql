-- Migration 011: Link work_instructions to a reagent item
-- Adds an optional FK so a WI can be tied to a specific reagent item from the item master.

ALTER TABLE public.work_instructions
  ADD COLUMN IF NOT EXISTS reagent_item_id uuid REFERENCES public.reagent_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_wi_reagent_item ON public.work_instructions(reagent_item_id);
