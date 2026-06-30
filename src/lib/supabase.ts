import { createClient } from '@supabase/supabase-js';
import { config, isSupabaseConfigured } from './config';

// Supabase client is initialised once and reused everywhere. When the app is
// not yet configured (missing env vars) we still create a client against a
// harmless placeholder so imports don't throw; UI guards on isSupabaseConfigured.
export const supabase = createClient(
  config.supabaseUrl ?? 'http://localhost:54321',
  config.supabaseAnonKey ?? 'public-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);

export { isSupabaseConfigured };
