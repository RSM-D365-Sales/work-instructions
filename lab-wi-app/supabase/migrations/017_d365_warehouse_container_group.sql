-- Migration 017: Warehouse-sync configuration
-- Adds a "container group" filter (used when pulling D365 InventoryWarehouses
-- so we don't import every warehouse in the legal entity) and surfaces the
-- chosen default container type on each lab row.

-- Shared D365 config — additional filter for the warehouse sync
ALTER TABLE public.d365_config
  ADD COLUMN IF NOT EXISTS warehouse_container_group text NOT NULL DEFAULT '';

COMMENT ON COLUMN public.d365_config.warehouse_container_group IS
  'Filter on InventoryWarehouses.DefaultContainerTypeCode. Blank = only warehouses with any non-empty default container type. Set a specific code (e.g. "LAB") to restrict further.';

-- Surface the default container type on each lab so admins can see what was matched
ALTER TABLE public.labs
  ADD COLUMN IF NOT EXISTS default_container_type text;
