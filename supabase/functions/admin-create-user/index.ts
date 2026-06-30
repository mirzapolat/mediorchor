// Edge function: create a new app user. Creating an auth user requires the
// service role, which must never live in the browser — so this runs server-side
// and only lets the current owner invoke it.
//
// Deploy:  supabase functions deploy admin-create-user
// Secrets: SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are
//          provided automatically by the Supabase runtime.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });

  // Verify the caller is the owner using their bearer token.
  const authHeader = req.headers.get('Authorization') ?? '';
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData } = await caller.auth.getUser();
  if (!userData.user) return json({ error: 'Unauthorized' }, 401);

  const { data: me } = await caller
    .from('app_users')
    .select('role')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (me?.role !== 'owner') return json({ error: 'Forbidden: owner only' }, 403);

  const { name, email, password } = await req.json().catch(() => ({}));
  if (!email || !password) return json({ error: 'email and password are required' }, 400);

  // Create the auth user + app_users profile with the service role.
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: name ?? '' },
  });
  if (createErr) return json({ error: createErr.message }, 400);

  const { error: profileErr } = await admin.from('app_users').insert({
    id: created.user.id,
    email,
    name: name ?? '',
    role: 'member',
  });
  if (profileErr) {
    // Roll back the auth user if the profile insert failed.
    await admin.auth.admin.deleteUser(created.user.id);
    return json({ error: profileErr.message }, 400);
  }

  return json({ id: created.user.id });
});
