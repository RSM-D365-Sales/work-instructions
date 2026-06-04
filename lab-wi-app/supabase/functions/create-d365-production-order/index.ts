// Supabase Edge Function: create-d365-production-order
// Creates a basic D365 F&SC ProductionOrderHeader for a production order that
// was raised from a reagent order (the "insufficient stock" planner flow).
//
// Request:  POST { production_order_id: string }
// Response: { success, production_order_number?, d365_prod_id?, skipped?, error? }
//
// The production order is created in D365 with the requirement fields:
//   • ItemNumber             — the production order's item (from its WI's reagent item)
//   • ProductionQuantity     — the production order batch size
//   • DeliveryDate           — the source reagent order's needed-by date
//   • ProductionWarehouseId  — REAGENT (config.reagent_source_warehouse_id, default 'REAGENT')
//   • ProductionSiteId       — '3' (request override or default)
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
  item_number: string;
  product_name: string;
}
interface WorkInstructionRow {
  product_name: string;
  reagent_item: ReagentItemRow | null;
}
interface ProductionOrderRow {
  id: string;
  production_order_number: string;
  batch_size: number | null;
  batch_size_unit: string | null;
  required_by: string | null;
  scheduled_start: string | null;
  source_reagent_order_id: string | null;
  work_instruction: WorkInstructionRow | null;
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
  production_order_id?: string;
  site?: string;
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
  const prodOrderId = parsed.production_order_id;
  if (!prodOrderId) return json({ error: 'production_order_id is required' }, 400);
  const site = (parsed.site ?? '3').trim() || '3';

  // Load production order + its work instruction's reagent item.
  const poResp = await admin
    .from('production_orders')
    .select(
      'id, production_order_number, batch_size, batch_size_unit, required_by, scheduled_start, source_reagent_order_id, ' +
      'work_instruction:work_instructions(product_name, reagent_item:reagent_items(item_number, product_name))'
    )
    .eq('id', prodOrderId)
    .single();

  if (poResp.error || !poResp.data) {
    return json({ error: 'Production order not found' }, 404);
  }
  const po = poResp.data as unknown as ProductionOrderRow;

  const itemNumber = po.work_instruction?.reagent_item?.item_number ?? '';
  if (!itemNumber) {
    await admin.from('production_orders').update({
      d365_create_status: 'failed',
      d365_create_error: 'Work instruction is not linked to a D365 item (no item_number).',
    }).eq('id', prodOrderId);
    return json({ success: false, error: 'Production order item has no D365 item_number' }, 400);
  }

  // Requirement date: prefer the source reagent order's needed-by date, then the
  // PO's required_by / scheduled_start, else today.
  let requirementDate = po.required_by ?? null;
  if (!requirementDate && po.source_reagent_order_id) {
    const roResp = await admin
      .from('reagent_orders')
      .select('requested_for_date')
      .eq('id', po.source_reagent_order_id)
      .single();
    requirementDate = (roResp.data as { requested_for_date?: string } | null)?.requested_for_date ?? null;
  }
  if (!requirementDate && po.scheduled_start) requirementDate = po.scheduled_start;
  const deliveryDate = requirementDate ? new Date(requirementDate) : new Date();
  const quantity = po.batch_size != null ? Number(po.batch_size) : 1;

  // Load D365 config
  const cfgResp = await admin.from('d365_config').select('*').single();
  if (cfgResp.error || !cfgResp.data) return json({ error: 'D365 config not found' }, 500);
  const cfg = cfgResp.data as unknown as D365Config;

  if (!cfg.enabled) {
    await admin.from('production_orders').update({
      d365_create_status: 'skipped',
      d365_create_error: 'D365 integration disabled in d365_config.',
    }).eq('id', prodOrderId);
    return json({ success: false, skipped: true, error: 'D365 integration disabled' });
  }

  const clientSecret = Deno.env.get('D365_CLIENT_SECRET');
  if (!clientSecret) {
    await admin.from('production_orders').update({
      d365_create_status: 'failed',
      d365_create_error: 'D365_CLIENT_SECRET secret is not set on the function.',
    }).eq('id', prodOrderId);
    return json({ success: false, error: 'D365_CLIENT_SECRET secret is not set' }, 500);
  }

  const warehouse = ((cfg.reagent_source_warehouse_id ?? 'REAGENT').trim()) || 'REAGENT';
  const company   = (cfg.company ?? '').trim();

  try {
    const base  = cfg.d365_url.replace(/\/$/, '');
    const token = await getD365Token(cfg.tenant_id, cfg.client_id, clientSecret, cfg.d365_url);
    const companyQS = company ? '?cross-company=false' : '?cross-company=true';

    // Basic ProductionOrderHeader. Field names follow the F&SC
    // ProductionOrderHeaders data entity; adjust to the target instance if it
    // rejects any property (D365 may require a default BOM/route to firm).
    const headerBody: Record<string, unknown> = {
      ItemNumber:             itemNumber,
      ProductionType:         'Standard',
      ProductionQuantity:     quantity,
      ProductionSiteId:       site,
      ProductionWarehouseId:  warehouse,
      DeliveryDate:           isoDate(deliveryDate),
    };
    if (company) headerBody.dataAreaId = company;

    const resp = await fetch(`${base}/data/ProductionOrderHeaders${companyQS}`, {
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

    if (!resp.ok) {
      const errText = await resp.text();
      const detail = `ProductionOrderHeader create failed (${resp.status}): ${errText.slice(0, 1000)}`;
      await admin.from('production_orders').update({
        d365_create_status: 'failed',
        d365_create_error: detail,
      }).eq('id', prodOrderId);
      return json({ success: false, error: detail, d365_status: resp.status }, 500);
    }

    const header = await resp.json() as { ProductionOrderNumber?: string };
    const d365ProdId = header.ProductionOrderNumber ?? null;

    await admin.from('production_orders').update({
      d365_create_status: 'sent',
      d365_create_error: null,
      d365_prod_id: d365ProdId,
    }).eq('id', prodOrderId);

    return json({
      success: true,
      production_order_number: po.production_order_number,
      d365_prod_id: d365ProdId,
      item_number: itemNumber,
      quantity,
      site,
      warehouse,
      delivery_date: isoDate(deliveryDate),
    });

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from('production_orders').update({
      d365_create_status: 'failed',
      d365_create_error: msg.slice(0, 1500),
    }).eq('id', prodOrderId);
    return json({ success: false, error: msg }, 500);
  }
});
