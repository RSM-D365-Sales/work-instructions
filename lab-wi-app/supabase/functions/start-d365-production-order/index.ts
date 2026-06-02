// Supabase Edge Function: start-d365-production-order
// Posts a "ProdProductionOrderStart" message to the D365 F&SC SysMessage
// (Message Processor) framework when an operator starts a production order.
//
// Request:  POST { order_id: string }
// Response: { success, message_queue?, production_order_number?, d365_status?, error?, skipped? }
//
// Calls:  POST {d365_url}/api/services/SysMessageServices/SysMessageService/SendMessage
//   body: {
//     "_companyId":     "<legal entity, e.g. USMF>",
//     "_messageQueue":  "<d365_config.mes_message_queue>",
//     "_messageType":   "ProdProductionOrderStart",
//     "_messageContent": "{\"ProductionOrderNumber\":\"P000289\",
//                          \"AutomaticBomConsumptionRule\":\"Never\",
//                          \"AutomaticRouteConsumptionRule\":\"Never\"}"
//   }
//
// Required Supabase secret:   D365_CLIENT_SECRET
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

interface ProductionOrderRow {
  id: string;
  production_order_number: string | null;
  d365_prod_id: string | null;
  status: string;
}

interface D365Config {
  enabled: boolean;
  d365_url: string;
  tenant_id: string;
  client_id: string;
  company: string | null;
  mes_message_queue: string | null;
  prod_start_bom_consumption: string | null;
  prod_start_route_consumption: string | null;
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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const ANON         = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

  // Verify caller is an authenticated user.
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

  // Load the production order
  const orderResp = await admin
    .from('production_orders')
    .select('id, production_order_number, d365_prod_id, status')
    .eq('id', orderId)
    .single();
  if (orderResp.error || !orderResp.data) return json({ error: 'Production order not found' }, 404);
  const order = orderResp.data as unknown as ProductionOrderRow;

  // Only orders that originated in D365 exist there to be started. Manually
  // created orders (no d365_prod_id) are skipped — there is nothing to start.
  if (!order.d365_prod_id?.trim()) {
    await admin.from('production_orders').update({
      d365_start_status: 'skipped',
      d365_start_error: 'Order was created manually (no D365 production order) — start message not sent.',
    }).eq('id', orderId);
    return json({ success: false, skipped: true, error: 'Manual order — not started in D365' });
  }

  const prodNumber = order.production_order_number?.trim();
  if (!prodNumber) {
    await admin.from('production_orders').update({
      d365_start_status: 'failed',
      d365_start_error: 'Production order has no production_order_number.',
    }).eq('id', orderId);
    return json({ success: false, error: 'Production order has no production_order_number' }, 400);
  }

  // Load D365 config
  const cfgResp = await admin.from('d365_config').select('*').single();
  if (cfgResp.error || !cfgResp.data) return json({ error: 'D365 config not found' }, 500);
  const cfg = cfgResp.data as unknown as D365Config;

  if (!cfg.enabled) {
    await admin.from('production_orders').update({
      d365_start_status: 'skipped',
      d365_start_error: 'D365 integration disabled in d365_config.',
    }).eq('id', orderId);
    return json({ success: false, skipped: true, error: 'D365 integration disabled' });
  }

  const clientSecret = Deno.env.get('D365_CLIENT_SECRET');
  if (!clientSecret) {
    await admin.from('production_orders').update({
      d365_start_status: 'failed',
      d365_start_error: 'D365_CLIENT_SECRET secret is not set on the function.',
    }).eq('id', orderId);
    return json({ success: false, error: 'D365_CLIENT_SECRET secret is not set' }, 500);
  }

  const company      = (cfg.company ?? '').trim();
  const messageQueue = (cfg.mes_message_queue ?? '').trim();
  const bomRule      = (cfg.prod_start_bom_consumption ?? 'Never').trim() || 'Never';
  const routeRule    = (cfg.prod_start_route_consumption ?? 'Never').trim() || 'Never';

  if (!company) {
    await admin.from('production_orders').update({
      d365_start_status: 'failed',
      d365_start_error: 'No company (legal entity) set in d365_config — required for _companyId.',
    }).eq('id', orderId);
    return json({ success: false, error: 'd365_config.company is required for _companyId' }, 400);
  }
  if (!messageQueue) {
    await admin.from('production_orders').update({
      d365_start_status: 'failed',
      d365_start_error: 'No mes_message_queue set in d365_config.',
    }).eq('id', orderId);
    return json({ success: false, error: 'd365_config.mes_message_queue is required' }, 400);
  }

  try {
    const base  = cfg.d365_url.replace(/\/$/, '');
    const token = await getD365Token(cfg.tenant_id, cfg.client_id, clientSecret, cfg.d365_url);

    // _messageContent is itself a JSON STRING (escaped) per the framework contract.
    const messageContent = JSON.stringify({
      ProductionOrderNumber: prodNumber,
      AutomaticBomConsumptionRule: bomRule,
      AutomaticRouteConsumptionRule: routeRule,
    });

    const payload = {
      _companyId: company,
      _messageQueue: messageQueue,
      _messageType: 'ProdProductionOrderStart',
      _messageContent: messageContent,
    };

    const url = `${base}/api/services/SysMessageServices/SysMessageService/SendMessage`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const respText = await resp.text();
    if (!resp.ok) {
      const detail = `SendMessage failed (${resp.status}): ${respText.slice(0, 1000)}`;
      await admin.from('production_orders').update({
        d365_start_status: 'failed',
        d365_start_error: detail,
        d365_start_sent_at: new Date().toISOString(),
      }).eq('id', orderId);
      return json({
        success: false,
        error: detail,
        d365_status: resp.status,
        d365_response: respText.slice(0, 2000),
      }, 500);
    }

    await admin.from('production_orders').update({
      d365_start_status: 'sent',
      d365_start_error: null,
      d365_start_sent_at: new Date().toISOString(),
    }).eq('id', orderId);

    return json({
      success: true,
      production_order_number: prodNumber,
      message_queue: messageQueue,
      message_type: 'ProdProductionOrderStart',
      d365_status: resp.status,
      d365_response: respText.slice(0, 2000),
    });

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from('production_orders').update({
      d365_start_status: 'failed',
      d365_start_error: msg.slice(0, 1500),
    }).eq('id', orderId);
    return json({ success: false, error: msg }, 500);
  }
});
