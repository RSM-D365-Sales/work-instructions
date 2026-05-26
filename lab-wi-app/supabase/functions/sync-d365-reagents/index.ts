// Supabase Edge Function: sync-d365-reagents
// Pulls ReleasedProductsV2 from D365 Finance & Supply Chain (filtered by BuyerGroupId),
// then upserts into the reagent_items table.
//
// Required Supabase secret (set once via CLI or dashboard):
//   supabase secrets set D365_CLIENT_SECRET=<your_entra_app_client_secret>
//
// Auto-provided by Supabase runtime:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ─── D365 → reagent_items field mapping ──────────────────────────────────────
// D365 ReleasedProductsV2 entity fields used:
//   ItemNumber          → item_number          (unique key)
//   ProductNumber       → d365_product_id
//   ProductSearchName   → product_name         (editable after sync)
//   InventoryUnitSymbol → unit_of_measure
//   NetWeight           → (not stored — available if needed)
//   BuyerGroupId        → (filter only)

interface D365Product {
  ItemNumber: string;
  ProductNumber: string;
  ProductName: string;         // display name on ReleasedProductsV2
  SearchName: string;          // shorter search name
  InventoryUnitSymbol: string;
  BuyerGroupId?: string;
}

interface D365ODataResponse {
  value: D365Product[];
  '@odata.nextLink'?: string;
}

// ─── Fetch an OAuth2 client-credentials token from Entra ID ──────────────────
async function getD365Token(tenantId: string, clientId: string, clientSecret: string, d365Url: string): Promise<string> {
  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  // D365 resource scope is the base URL with /.default
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

// ─── Fetch all pages from D365 OData ─────────────────────────────────────────
async function fetchAllProducts(
  d365Url: string,
  token: string,
  buyerGroup: string,
  company: string,
): Promise<{ products: D365Product[]; queryUrl: string }> {
  const base = d365Url.replace(/\/$/, '');
  // Include all fields used in the upsert mapping
  const fields = 'ItemNumber,SearchName,InventoryUnitSymbol,BuyerGroupId';

  // Build $filter — do NOT encodeURIComponent the whole thing; D365 expects plain OData syntax
  const filterParts: string[] = [];
  if (buyerGroup?.trim()) {
    filterParts.push(`BuyerGroupId eq '${buyerGroup.trim()}'`);
  }
  const filter = filterParts.join(' and ');

  // If a specific legal entity code is set (e.g. USP2), use ?company=<code>.
  // Otherwise fall back to cross-company=true to query the environment default.
  const companyParam = company?.trim()
    ? `company=${encodeURIComponent(company.trim())}`
    : `cross-company=true`;

  const firstUrl =
    `${base}/data/ReleasedProductsV2` +
    `?${companyParam}` +
    `&$select=${fields}` +
    (filter ? `&$filter=${encodeURIComponent(filter)}` : '') +
    `&$top=1000`;

  const products: D365Product[] = [];
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
      throw new Error(`Unexpected D365 response — "value" is not an array. Keys: ${Object.keys(data).join(', ')}. First 500 chars: ${JSON.stringify(data).slice(0, 500)}`);
    }
    products.push(...data.value);
    nextUrl = data['@odata.nextLink'];
  }

  return { products, queryUrl: firstUrl };
}

// ─── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  // Supabase admin client — bypasses RLS to read config + upsert items
  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Verify the calling user is authenticated and is an admin
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

  // Read D365 config from DB
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
    return new Response(JSON.stringify({ error: 'D365_CLIENT_SECRET secret is not set. Run: supabase secrets set D365_CLIENT_SECRET=<secret>' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    // Step 1: get token
    const token = await getD365Token(cfg.tenant_id, cfg.client_id, clientSecret, cfg.d365_url);

    if (testOnly) {
      // Just verify auth works
      return new Response(JSON.stringify({ success: true, message: 'D365 connection successful — authentication OK.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Step 2: fetch all products
    const companyUsed = cfg.company?.trim() || '(none — cross-company=true)';
    const { products, queryUrl } = await fetchAllProducts(cfg.d365_url, token, cfg.buyer_group ?? '', cfg.company ?? '');

    if (products.length === 0) {
      await supabaseAdmin.from('d365_config').update({
        last_sync_at: new Date().toISOString(),
        last_sync_status: 'success',
        last_sync_count: 0,
        last_sync_error: null,
      }).eq('id', cfg.id);

      return new Response(JSON.stringify({
        success: true,
        synced: 0,
        message: `No products returned from D365 (company: ${companyUsed}, buyer group: "${cfg.buyer_group ?? ''}"). Check these values match the D365 environment.`,
        debug_query_url: queryUrl,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Step 3: map D365 fields → reagent_items
    const upsertPayload = products.map((p: D365Product) => ({
      item_number: p.ItemNumber,
      d365_product_id: p.ProductNumber !== p.ItemNumber ? p.ProductNumber : null,
      // Prefer ProductName (full name); fall back to SearchName then ItemNumber
      product_name: p.ProductName || p.SearchName || p.ItemNumber,
      unit_of_measure: p.InventoryUnitSymbol ?? 'g',
      d365_synced_at: new Date().toISOString(),
      is_active: true,
      // Chemistry fields (CAS, formula, MW, purity) are NOT in D365 standard —
      // admins fill those in via the edit modal after syncing.
    }));

    // Step 4: upsert (item_number is UNIQUE — existing rows are updated, new ones inserted)
    // We only overwrite the D365-owned fields; manual chemistry fields are untouched via onConflict
    const { error: upsertError } = await supabaseAdmin
      .from('reagent_items')
      .upsert(upsertPayload, {
        onConflict: 'item_number',
        ignoreDuplicates: false, // update existing rows' D365 fields
      });

    if (upsertError) throw upsertError;

    // Step 5: update sync metadata
    await supabaseAdmin.from('d365_config').update({
      last_sync_at: new Date().toISOString(),
      last_sync_status: 'success',
      last_sync_count: products.length,
      last_sync_error: null,
    }).eq('id', cfg.id);

    return new Response(JSON.stringify({
      success: true,
      synced: products.length,
      message: `Successfully synced ${products.length} item${products.length !== 1 ? 's' : ''} from D365.`,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    // Record the error in the config table
    await supabaseAdmin.from('d365_config').update({
      last_sync_at: new Date().toISOString(),
      last_sync_status: 'error',
      last_sync_error: message,
    }).eq('id', cfg.id);

    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
