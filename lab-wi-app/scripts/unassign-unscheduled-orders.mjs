/**
 * Unassign all UNSCHEDULED production orders.
 *
 * "Unscheduled" matches the Unscheduled Orders page: scheduled_start IS NULL and
 * status not completed/cancelled. Scheduled orders (and their assignees) are left
 * untouched — the auto-scheduler will pick a person + time for the unscheduled
 * ones to meet their required-by date.
 *
 * Usage (RSM proxy needs NODE_TLS_REJECT_UNAUTHORIZED):
 *   $env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
 *   node scripts/unassign-unscheduled-orders.mjs          # dry run (reports only)
 *   node scripts/unassign-unscheduled-orders.mjs --apply  # performs the update
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://txjqoynbucpjhrkjedeo.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_SERVICE_ROLE_KEY in the environment before running.');
  process.exit(1);
}

const apply = process.argv.includes('--apply');
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Unscheduled orders that currently have an assignee.
const { data: targets, error } = await sb
  .from('production_orders')
  .select('id, production_order_number, lot_number, status, assigned_to, assignee:profiles!production_orders_assigned_to_fkey(full_name)')
  .is('scheduled_start', null)
  .not('assigned_to', 'is', null)
  .not('status', 'in', '(completed,cancelled)');

if (error) { console.error('Query failed:', error.message); process.exit(1); }

console.log(`Found ${targets.length} unscheduled order(s) with an assignee:`);
for (const o of targets) {
  console.log(`  ${o.production_order_number ?? o.lot_number}  [${o.status}]  → ${o.assignee?.full_name ?? o.assigned_to}`);
}

if (!apply) {
  console.log('\nDry run only. Re-run with --apply to set these to unassigned.');
  process.exit(0);
}

if (targets.length === 0) { console.log('\nNothing to update.'); process.exit(0); }

const { error: updErr, count } = await sb
  .from('production_orders')
  .update({ assigned_to: null }, { count: 'exact' })
  .is('scheduled_start', null)
  .not('assigned_to', 'is', null)
  .not('status', 'in', '(completed,cancelled)');

if (updErr) { console.error('\nUpdate failed:', updErr.message); process.exit(1); }
console.log(`\n✓ Unassigned ${count ?? targets.length} unscheduled order(s).`);
