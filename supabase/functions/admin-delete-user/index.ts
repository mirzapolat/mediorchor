// Edge function: delete an app user. Removing an auth user requires the service
// role, so this runs server-side and only lets the current owner invoke it.
// Deleting the auth user cascades to the app_users row (FK on delete cascade).
//
// Deploy:  supabase functions deploy admin-delete-user

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

  const { userId } = await req.json().catch(() => ({}));
  if (!userId) return json({ error: 'userId is required' }, 400);
  if (userId === userData.user.id) return json({ error: 'You cannot delete yourself' }, 400);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Guard against deleting another owner.
  const { data: target } = await admin
    .from('app_users')
    .select('role')
    .eq('id', userId)
    .maybeSingle();
  if (target?.role === 'owner') return json({ error: 'Cannot delete an owner' }, 400);

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return json({ error: error.message }, 400);

  return json({ ok: true });
});
