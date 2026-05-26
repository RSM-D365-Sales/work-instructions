// Supabase Edge Function: create-d365-transfer-order
// Creates a D365 F&SC TransferOrderHeader + TransferOrderLineV2 for a reagent order.
//
// Request:  POST { order_id: string }
// Response: { success, transfer_order_number?, error? }
//
// Required Supabase secret:  D365_CLIENT_SECRET
// Auto-provided runtime env:  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY

// @ts-ignore - Deno-specific URL import for Supabase Edge Functions
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// @ts-ignore - Deno global is provided by the Supabase Edge runtime
declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface ReagentItemRow {
  id: string;
  item_number: string;
  product_name: string;
  unit_of_measure: string;
}

interface LabRow {
  id: string;
  warehouse_id: string;
  name: string;
  d365_company: string | null;
}

interface ReagentOrderItemRow {
  id: string;
  line_number: number;
  quantity: number;
  unit: string;
  reagent_item: ReagentItemRow | null;
}

interface ReagentOrderRow {
  id: string;
  // Legacy single-item columns (still populated for old orders;
  // new orders use reagent_order_items only).
  quantity: number | null;
  reagent_item: ReagentItemRow | null;
  requested_for_date: string;
  lab: LabRow | null;
  items: ReagentOrderItemRow[] | null;
}

interface D365Config {
  enabled: boolean;
  d365_url: string;
  tenant_id: string;
  client_id: string;
  company: string | null;
  reagent_source_warehouse_id: string | null;
}

interface RequestBody {
  order_id?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function getD365Token(
  tenantId: string,
  clientId: string,
  clientSecret: string,
  d365Url: string,
): Promise<string> {
  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const scope = `${d365Url.replace(/\/$/, '')}/.default`;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope,
  });
  const resp = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Token request failed (${resp.status}): ${err}`);
  }
  const data = await resp.json() as { access_token?: string };
  if (!data.access_token) throw new Error('No access_token in Entra ID response');
  return data.access_token;
}

function isoDate(d: Date): string {
  return d.toISOString().split('T')[0] + 'T00:00:00Z';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const ANON         = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

  // Verify caller
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Unauthorized' }, 401);

  const userClient = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData } = await userClient.auth.getUser();
  if (!userData?.user) return json({ error: 'Unauthorized' }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Parse body
  let parsed: RequestBody;
  try {
    parsed = await req.json() as RequestBody;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const orderId = parsed.order_id;
  if (!orderId) return json({ error: 'order_id is required' }, 400);

  // Load order + joins (including line items)
  const orderResp = await admin
    .from('reagent_orders')
    .select(
      '*, ' +
      'reagent_item:reagent_items(id, item_number, product_name, unit_of_measure), ' +
      'lab:labs(id, warehouse_id, name, d365_company), ' +
      'items:reagent_order_items(id, line_number, quantity, unit, ' +
      '  reagent_item:reagent_items(id, item_number, product_name, unit_of_measure))'
    )
    .eq('id', orderId)
    .single();

  if (orderResp.error || !orderResp.data) {
    return json({ error: 'Order not found' }, 404);
  }
  const order = orderResp.data as unknown as ReagentOrderRow;

  // Normalize: prefer the line-items table; fall back to the legacy
  // single-item columns for older orders that pre-date migration 020.
  let lines: ReagentOrderItemRow[] = (order.items ?? [])
    .slice()
    .sort((a, b) => a.line_number - b.line_number);
  if (lines.length === 0 && order.reagent_item && order.quantity != null) {
    lines = [{
      id: 'legacy',
      line_number: 1,
      quantity: order.quantity,
      unit: order.reagent_item.unit_of_measure,
      reagent_item: order.reagent_item,
    }];
  }

  // Load D365 config
  const cfgResp = await admin.from('d365_config').select('*').single();
  if (cfgResp.error || !cfgResp.data) return json({ error: 'D365 config not found' }, 500);
  const cfg = cfgResp.data as unknown as D365Config;

  if (!cfg.enabled) {
    await admin.from('reagent_orders').update({
      transfer_order_status: 'skipped',
      transfer_order_error: 'D365 integration disabled in d365_config.',
    }).eq('id', orderId);
    return json({ success: false, skipped: true, error: 'D365 integration disabled' });
  }

  const clientSecret = Deno.env.get('D365_CLIENT_SECRET');
  if (!clientSecret) {
    await admin.from('reagent_orders').update({
      transfer_order_status: 'failed',
      transfer_order_error: 'D365_CLIENT_SECRET secret is not set on the function.',
    }).eq('id', orderId);
    return json({ success: false, error: 'D365_CLIENT_SECRET secret is not set' }, 500);
  }

  // Use the user-selected "requested for" date for both ship and receive.
  const neededBy    = new Date(order.requested_for_date + 'T00:00:00Z');
  const shipDate    = neededBy;
  const receiveDate = neededBy;

  const sourceWarehouse = ((cfg.reagent_source_warehouse_id ?? 'REAGENT').trim()) || 'REAGENT';
  const destWarehouse   = order.lab?.warehouse_id ?? '';
  const company         = ((order.lab?.d365_company ?? cfg.company) ?? '').trim();

  if (!destWarehouse) {
    await admin.from('reagent_orders').update({
      transfer_order_status: 'failed',
      transfer_order_error: 'Destination lab has no D365 warehouse_id.',
    }).eq('id', orderId);
    return json({ success: false, error: 'Destination lab has no warehouse_id' }, 400);
  }
  if (lines.length === 0) {
    await admin.from('reagent_orders').update({
      transfer_order_status: 'failed',
      transfer_order_error: 'Order has no line items.',
    }).eq('id', orderId);
    return json({ success: false, error: 'Order has no line items' }, 400);
  }
  const missingItemNumber = lines.find(l => !l.reagent_item?.item_number);
  if (missingItemNumber) {
    await admin.from('reagent_orders').update({
      transfer_order_status: 'failed',
      transfer_order_error: 'One or more line items have no D365 item_number.',
    }).eq('id', orderId);
    return json({ success: false, error: 'A reagent on the order has no item_number' }, 400);
  }

  try {
    const base  = cfg.d365_url.replace(/\/$/, '');
    const token = await getD365Token(cfg.tenant_id, cfg.client_id, clientSecret, cfg.d365_url);

    const companyQS = company ? '?cross-company=false' : '?cross-company=true';

    // ── 1) TransferOrderHeader ─────────────────────────────────────────
    const headerBody: Record<string, unknown> = {
      ShippingWarehouseId:   sourceWarehouse,
      ReceivingWarehouseId:  destWarehouse,
      RequestedShippingDate: isoDate(shipDate),
      RequestedReceiptDate:  isoDate(receiveDate),
    };
    if (company) headerBody.dataAreaId = company;

    const headerResp = await fetch(`${base}/data/TransferOrderHeaders${companyQS}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'OData-MaxVersion': '4.0',
        'OData-Version': '4.0',
      },
      body: JSON.stringify(headerBody),
    });

    if (!headerResp.ok) {
      const errText = await headerResp.text();
      throw new Error(`TransferOrderHeader create failed (${headerResp.status}): ${errText.slice(0, 800)}`);
    }
    const header = await headerResp.json() as { TransferOrderNumber?: string };
    const transferOrderNumber = header.TransferOrderNumber;
    if (!transferOrderNumber) {
      throw new Error('D365 did not return a TransferOrderNumber on the created header.');
    }

    // ── 2) TransferOrderLineV2 (one POST per order line) ──────────────
    // Minimal payload confirmed to work against D365 F&SC. Warehouses,
    // dates, and unit come from the header / item master. Sending any
    // extra property (e.g. ShippingWarehouseId, InventoryUnitSymbol)
    // triggers AxODataEntityDeserializer TargetInvocationException (400).
    const linePayloads: Record<string, unknown>[] = [];
    for (let idx = 0; idx < lines.length; idx++) {
      const ln = lines[idx];
      const lineBody: Record<string, unknown> = {
        TransferOrderNumber: transferOrderNumber,
        ItemNumber:          ln.reagent_item!.item_number,
        LineNumber:          idx + 1,
        TransferQuantity:    Number(ln.quantity),
      };
      if (company) lineBody.dataAreaId = company;
      linePayloads.push(lineBody);

      const lineResp = await fetch(`${base}/data/TransferOrderLinesV2${companyQS}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'OData-MaxVersion': '4.0',
          'OData-Version': '4.0',
        },
        body: JSON.stringify(lineBody),
      });

      if (!lineResp.ok) {
        const errText = await lineResp.text();
        const detail = `Header created (${transferOrderNumber}) but line ${idx + 1} of ${lines.length} failed (${lineResp.status}): ${errText.slice(0, 1000)}`;
        await admin.from('reagent_orders').update({
          transfer_order_number: transferOrderNumber,
          transfer_order_status: 'failed',
          transfer_order_error: detail,
          transfer_order_created_at: new Date().toISOString(),
        }).eq('id', orderId);
        return json({
          success: false,
          transfer_order_number: transferOrderNumber,
          error: detail,
          d365_status: lineResp.status,
          d365_response: errText.slice(0, 2000),
          failed_line: idx + 1,
          line_payload: lineBody,
          lines_posted: idx,
        }, 500);
      }
    }

    await admin.from('reagent_orders').update({
      transfer_order_number: transferOrderNumber,
      transfer_order_status: 'created',
      transfer_order_error: null,
      transfer_order_created_at: new Date().toISOString(),
    }).eq('id', orderId);

    return json({
      success: true,
      transfer_order_number: transferOrderNumber,
      source_warehouse: sourceWarehouse,
      destination_warehouse: destWarehouse,
      ship_date: isoDate(shipDate),
      receive_date: isoDate(receiveDate),
      line_count: lines.length,
    });

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from('reagent_orders').update({
      transfer_order_status: 'failed',
      transfer_order_error: msg.slice(0, 1500),
    }).eq('id', orderId);
    return json({ success: false, error: msg }, 500);
  }
});
