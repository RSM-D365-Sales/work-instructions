// Supabase Edge Function: sync-d365-warehouses
// Pulls InventoryWarehouses from D365 Finance & Supply Chain (optionally
// scoped to a company / legal entity) and upserts into the local `labs` table.
//
// Re-uses the same Entra app registration & D365_CLIENT_SECRET secret as the
// reagent sync (see migration 007_d365_config + sync-d365-reagents).
//
// Auto-provided by Supabase runtime:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ─── D365 InventoryWarehouses → labs field mapping ───────────────────────────
//   WarehouseId    → warehouse_id  (unique key)
//   WarehouseName  → name
//   OperationalSiteId site_id
//   dataAreaId     → d365_company
interface D365Warehouse {
  WarehouseId: string;
  WarehouseName?: string;
  OperationalSiteId?: string;
  DefaultContainerTypeId?: string;
  dataAreaId?: string;
}

interface D365ODataResponse {
  value: D365Warehouse[];
  '@odata.nextLink'?: string;
}

async function getD365Token(tenantId: string, clientId: string, clientSecret: string, d365Url: string): Promise<string> {
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
  const data = await resp.json();
  if (!data.access_token) throw new Error('No access_token in Entra ID response');
  return data.access_token as string;
}

async function fetchAllWarehouses(
  d365Url: string,
  token: string,
  company: string,
  containerGroup: string,
): Promise<{ warehouses: D365Warehouse[]; queryUrl: string; filter: string }> {
  const base = d365Url.replace(/\/$/, '');
  const fields = 'WarehouseId,WarehouseName,OperationalSiteId,DefaultContainerTypeId,dataAreaId';
  const companyParam = company?.trim()
    ? `company=${encodeURIComponent(company.trim())}`
    : `cross-company=true`;

  // Restrict to warehouses that have a default container type populated.
  // NOTE: D365 returns "" (empty string) — not null — for unset string fields,
  // and `ne null` on Warehouses triggers a server-side NullReferenceException,
  // so we use `ne ''` only and apply a defensive client-side filter below.
  const filterParts: string[] = ["DefaultContainerTypeId ne ''"];
  if (containerGroup?.trim()) {
    filterParts.push(`DefaultContainerTypeId eq '${containerGroup.trim().replace(/'/g, "''")}'`);
  }
  const filter = filterParts.join(' and ');

  const firstUrl =
    `${base}/data/Warehouses` +
    `?${companyParam}` +
    `&$select=${fields}` +
    `&$filter=${encodeURIComponent(filter)}` +
    `&$top=1000`;

  const warehouses: D365Warehouse[] = [];
  let nextUrl: string | undefined = firstUrl;

  while (nextUrl) {
    const resp = await fetch(nextUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'OData-MaxVersion': '4.0',
        'OData-Version': '4.0',
      },
    });
    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`D365 OData request failed (${resp.status}): ${err}`);
    }
    const data: D365ODataResponse = await resp.json();
    if (!Array.isArray(data.value)) {
      throw new Error(`Unexpected D365 response — "value" is not an array. First 500 chars: ${JSON.stringify(data).slice(0, 500)}`);
    }
    warehouses.push(...data.value);
    nextUrl = data['@odata.nextLink'];
  }

  // Defensive client-side filter: drop any rows where the container type
  // came back blank/null (shouldn't happen given the server-side filter,
  // but cheap insurance against D365 quirks).
  const filtered = warehouses.filter(w => (w.DefaultContainerTypeId ?? '').trim() !== '');
  return { warehouses: filtered, queryUrl: firstUrl, filter };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // AuthN
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const supabaseUser = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user } } = await supabaseUser.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const { data: profile } = await supabaseAdmin
    .from('profiles').select('role').eq('id', user.id).single();
  if (profile?.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Forbidden: admin only' }), {
      status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Parse body
  let testOnly = false;
  try {
    const body = await req.json();
    testOnly = body?.testOnly === true;
  } catch { /* no body */ }

  // Read D365 config (shared with reagent sync)
  const { data: cfg, error: cfgErr } = await supabaseAdmin
    .from('d365_config')
    .select('*')
    .single();
  if (cfgErr || !cfg) {
    return new Response(JSON.stringify({ error: 'D365 config not found' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  if (!cfg.enabled) {
    return new Response(JSON.stringify({ error: 'D365 sync is disabled. Enable it in settings.' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  if (!cfg.d365_url || !cfg.tenant_id || !cfg.client_id) {
    return new Response(JSON.stringify({ error: 'D365 config is incomplete. Set URL, Tenant ID, and Client ID.' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const clientSecret = Deno.env.get('D365_CLIENT_SECRET');
  if (!clientSecret) {
    return new Response(JSON.stringify({ error: 'D365_CLIENT_SECRET secret is not set.' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const token = await getD365Token(cfg.tenant_id, cfg.client_id, clientSecret, cfg.d365_url);

    if (testOnly) {
      return new Response(JSON.stringify({ success: true, message: 'D365 connection successful — authentication OK.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const companyUsed = cfg.company?.trim() || '(none — cross-company=true)';
    const groupUsed = cfg.warehouse_container_group?.trim() || '(any non-empty)';
    const { warehouses, queryUrl } = await fetchAllWarehouses(
      cfg.d365_url,
      token,
      cfg.company ?? '',
      cfg.warehouse_container_group ?? '',
    );

    if (warehouses.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        synced: 0,
        message: `No warehouses returned from D365 (company: ${companyUsed}, container group: ${groupUsed}).`,
        debug_query_url: queryUrl,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Map → labs upsert payload
    const nowIso = new Date().toISOString();
    const upsertPayload = warehouses.map((w) => ({
      warehouse_id: w.WarehouseId,
      name: w.WarehouseName?.trim() || w.WarehouseId,
      site_id: w.OperationalSiteId ?? null,
      default_container_type: w.DefaultContainerTypeId ?? null,
      d365_company: w.dataAreaId ?? null,
      d365_synced_at: nowIso,
      is_active: true,
    }));

    const { error: upsertError } = await supabaseAdmin
      .from('labs')
      .upsert(upsertPayload, { onConflict: 'warehouse_id', ignoreDuplicates: false });
    if (upsertError) throw upsertError;

    return new Response(JSON.stringify({
      success: true,
      synced: warehouses.length,
      message: `Successfully synced ${warehouses.length} warehouse${warehouses.length !== 1 ? 's' : ''} from D365.`,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
