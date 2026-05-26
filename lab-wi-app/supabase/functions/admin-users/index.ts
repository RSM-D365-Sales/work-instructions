// Supabase Edge Function: admin-users
// Admin-only CRUD over auth.users + public.profiles.
//
// The Supabase JS admin API requires the service_role key, so we run it
// here server-side. The caller's JWT is verified and we check that the
// caller's profile.role = 'admin' before performing any privileged action.
//
// Actions (POST JSON body):
//   { action: 'list' }
//   { action: 'create', email, password, full_name, role }
//   { action: 'update', user_id, full_name?, role?, password? }
//   { action: 'delete', user_id }
//
// Auto-provided by Supabase runtime:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Role = 'admin' | 'author' | 'approver' | 'operator' | 'lab';
const VALID_ROLES: Role[] = ['admin', 'author', 'approver', 'operator', 'lab'];

interface Body {
  action: 'list' | 'create' | 'update' | 'delete';
  user_id?: string;
  email?: string;
  password?: string;
  full_name?: string;
  role?: Role;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;

  // Verify caller and load their profile (uses caller's JWT)
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Missing bearer token' }, 401);
  const jwt = authHeader.slice('Bearer '.length).trim();

  // The Supabase Edge Functions gateway has already verified the JWT
  // signature (Verify JWT = ON). We just need to extract the user id (sub)
  // from the payload. We don't call /auth/v1/user because that fails when
  // the user's auth session has been revoked even though the token itself
  // is still cryptographically valid.
  let callerId: string;
  try {
    const payloadB64 = jwt.split('.')[1];
    const payloadJson = atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(payloadJson) as { sub?: string; exp?: number };
    if (!payload.sub) throw new Error('JWT missing sub claim');
    if (payload.exp && payload.exp * 1000 < Date.now()) throw new Error('JWT expired');
    callerId = payload.sub;
  } catch (e) {
    return json({ error: `Invalid token: ${e instanceof Error ? e.message : 'decode failed'}` }, 401);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: callerProfile, error: profErr } = await admin
    .from('profiles')
    .select('role')
    .eq('id', callerId)
    .single();
  if (profErr || callerProfile?.role !== 'admin') {
    return json({ error: 'Forbidden — admin role required' }, 403);
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  try {
    switch (body.action) {
      case 'list': {
        // Pull profiles (already has email column after migration 015).
        const { data, error } = await admin
          .from('profiles')
          .select('id, full_name, email, role, created_at')
          .order('created_at', { ascending: false });
        if (error) throw error;
        return json({ users: data ?? [] });
      }

      case 'create': {
        const { email, password, full_name, role } = body;
        if (!email || !password || !full_name || !role) {
          return json({ error: 'email, password, full_name and role are required' }, 400);
        }
        if (!VALID_ROLES.includes(role)) return json({ error: 'Invalid role' }, 400);
        if (password.length < 8) return json({ error: 'Password must be at least 8 characters' }, 400);

        const { data: created, error: createErr } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { full_name, role },
        });
        if (createErr) throw createErr;

        // Ensure the profile reflects the requested role + name (the trigger
        // populates from metadata, but be defensive in case the trigger lags).
        await admin.from('profiles').upsert({
          id: created.user.id,
          email,
          full_name,
          role,
        }, { onConflict: 'id' });

        return json({ user: { id: created.user.id, email, full_name, role } });
      }

      case 'update': {
        const { user_id, full_name, role, password } = body;
        if (!user_id) return json({ error: 'user_id required' }, 400);
        if (role && !VALID_ROLES.includes(role)) return json({ error: 'Invalid role' }, 400);
        if (password !== undefined && password.length < 8) {
          return json({ error: 'Password must be at least 8 characters' }, 400);
        }

        // Update auth.users metadata + (optionally) password
        const authPatch: Record<string, unknown> = {};
        if (password) authPatch.password = password;
        if (full_name || role) {
          authPatch.user_metadata = { ...(full_name ? { full_name } : {}), ...(role ? { role } : {}) };
        }
        if (Object.keys(authPatch).length > 0) {
          const { error: aErr } = await admin.auth.admin.updateUserById(user_id, authPatch);
          if (aErr) throw aErr;
        }

        // Update profile row
        const profilePatch: Record<string, unknown> = {};
        if (full_name) profilePatch.full_name = full_name;
        if (role) profilePatch.role = role;
        if (Object.keys(profilePatch).length > 0) {
          const { error: pErr } = await admin.from('profiles').update(profilePatch).eq('id', user_id);
          if (pErr) throw pErr;
        }

        return json({ ok: true });
      }

      case 'delete': {
        const { user_id } = body;
        if (!user_id) return json({ error: 'user_id required' }, 400);
        if (user_id === callerId) {
          return json({ error: 'You cannot delete your own account' }, 400);
        }
        const { error: dErr } = await admin.auth.admin.deleteUser(user_id);
        if (dErr) throw dErr;
        // The profile row may be left behind if FK relations exist — try to remove it.
        await admin.from('profiles').delete().eq('id', user_id);
        return json({ ok: true });
      }

      default:
        return json({ error: 'Unknown action' }, 400);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, 400);
  }
});
