// Supabase Edge Function: ingest-d365-prod-order
// Receives a webhook from Power Automate when a D365 F&SC ProdTable
// record is created, and inserts a matching row into
// public.production_orders.
//
// Auth: shared secret in the `x-webhook-secret` header
//       (set the Supabase secret D365_INGEST_SECRET to match the value
//        configured in the Power Automate HTTP action).
//
// Request body (from Power Automate):
//   {
//     "prod_id":       "P000123",        // REQUIRED - D365 ProdId (unique)
//     "item_number":   "RGT-001",        // REQUIRED - D365 ItemId, used to find the WI
//     "qty_scheduled": 100,              // optional - batch size
//     "required_date": "2026-06-01",     // optional - ISO date, mapped to required_by
//     "notes":         "..."             // optional
//   }
//
// Product name and batch unit are NOT accepted from the payload — they are
// taken from the reagent item master already in Supabase (matched via
// item_number: reagent_items.product_name and reagent_items.unit_of_measure).
//
// Response:
//   { success: true, production_order_id, work_instruction_id, product_name, unit, status: 'created' | 'duplicate' }
//   { success: false, error }                                                  (4xx / 5xx)
//
// Required Supabase secrets:
//   D365_INGEST_SECRET     - shared secret to authenticate Power Automate
//   D365_SYNC_USER_ID      - profile UUID to attribute the insert to (created_by)
// Auto-provided runtime env:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

// @ts-ignore - Deno-specific URL import for Supabase Edge Functions
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// @ts-ignore - Deno global is provided by the Supabase Edge runtime
declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface RequestBody {
  prod_id?: string;
  item_number?: string;
  qty_scheduled?: number | string | null;
  required_date?: string | null;
  notes?: string | null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST')    return json({ success: false, error: 'Method not allowed' }, 405);

  // ---- Auth: shared secret -------------------------------------------------
  const expectedSecret = Deno.env.get('D365_INGEST_SECRET');
  const presented      = req.headers.get('x-webhook-secret');
  if (!expectedSecret) return json({ success: false, error: 'Server not configured (missing D365_INGEST_SECRET)' }, 500);
  if (presented !== expectedSecret) return json({ success: false, error: 'Unauthorized' }, 401);

  // ---- Parse body ----------------------------------------------------------
  let body: RequestBody;
  try { body = await req.json(); }
  catch { return json({ success: false, error: 'Invalid JSON body' }, 400); }

  const prodId     = (body.prod_id     ?? '').toString().trim();
  const itemNumber = (body.item_number ?? '').toString().trim();
  if (!prodId)     return json({ success: false, error: 'prod_id is required' }, 400);
  if (!itemNumber) return json({ success: false, error: 'item_number is required' }, 400);

  const qty         = body.qty_scheduled == null || body.qty_scheduled === ''
    ? null
    : Number(body.qty_scheduled);
  const requiredBy  = body.required_date ? String(body.required_date).slice(0, 10) : null;
  const notes       = body.notes?.toString() ?? null;

  if (qty !== null && !Number.isFinite(qty)) {
    return json({ success: false, error: 'qty_scheduled must be a number' }, 400);
  }

  // ---- Supabase client (service role) -------------------------------------
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const syncUserId  = Deno.env.get('D365_SYNC_USER_ID');
  if (!supabaseUrl || !serviceKey) return json({ success: false, error: 'Supabase env not configured' }, 500);
  if (!syncUserId)                 return json({ success: false, error: 'D365_SYNC_USER_ID not configured' }, 500);

  const supabase = createClient(supabaseUrl, serviceKey);

  // ---- Idempotency: bail if this ProdId is already ingested ---------------
  {
    const { data: existing, error } = await supabase
      .from('production_orders')
      .select('id, work_instruction_id')
      .eq('d365_prod_id', prodId)
      .maybeSingle();
    if (error) return json({ success: false, error: `Lookup failed: ${error.message}` }, 500);
    if (existing) {
      return json({
        success: true,
        status: 'duplicate',
        production_order_id: existing.id,
        work_instruction_id: existing.work_instruction_id,
      });
    }
  }

  // ---- Resolve reagent item + work instruction ----------------------------
  // Strategy:
  //   1. Find the reagent item by item_number (case-insensitive). Its
  //      product_name and unit_of_measure are the master values already in
  //      Supabase (synced from D365) — used instead of anything in the payload.
  //   2. Pick the latest APPROVED work_instruction linked to that reagent item.
  let workInstructionId: string | null = null;

  const { data: reagentItem } = await supabase
    .from('reagent_items')
    .select('id, product_name, unit_of_measure')
    .ilike('item_number', itemNumber)
    .maybeSingle();

  if (reagentItem?.id) {
    const { data: wi } = await supabase
      .from('work_instructions')
      .select('id')
      .eq('reagent_item_id', reagentItem.id)
      .eq('status', 'approved')
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (wi?.id) workInstructionId = wi.id;
  }

  if (!workInstructionId) {
    return json({
      success: false,
      error: `No approved work instruction found for D365 item_number="${itemNumber}"`,
    }, 422);
  }

  // Product name & batch unit come from the reagent item master in Supabase.
  const item = reagentItem as { product_name?: string; unit_of_measure?: string } | null;
  const resolvedProductName = item?.product_name ?? null;
  const resolvedUnit        = item?.unit_of_measure?.trim() || 'L';

  // ---- Insert the production order ----------------------------------------
  const { data: inserted, error: insertErr } = await supabase
    .from('production_orders')
    .insert({
      d365_prod_id:            prodId,
      production_order_number:  prodId,       // D365 ProdId is the production order number
      work_instruction_id:     workInstructionId,
      lot_number:              prodId,        // use D365 ProdId as the lot for traceability
      batch_size:              qty,
      batch_size_unit:         resolvedUnit,
      status:                  'pending',
      notes:                   notes,
      required_by:             requiredBy,
      created_by:              syncUserId,    // attribute to the configured sync user
    })
    .select('id, work_instruction_id')
    .single();

  if (insertErr) return json({ success: false, error: `Insert failed: ${insertErr.message}` }, 500);

  return json({
    success: true,
    status: 'created',
    production_order_id: inserted.id,
    work_instruction_id: inserted.work_instruction_id,
    product_name: resolvedProductName,
    unit: resolvedUnit,
  });
});
