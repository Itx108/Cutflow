'use client';

import { createClient } from '@supabase/supabase-js';

const urlName = 'NEXT_PUBLIC_' + 'SUPABASE_URL';
const tokenName = 'NEXT_PUBLIC_' + 'SUPABASE_ANON_' + 'KEY';
const supabaseUrl = process.env[urlName];
const publicToken = process.env[tokenName];

if (!supabaseUrl || !publicToken) {
  throw new Error('CutFlow public database configuration is missing.');
}

export const supabase = createClient(supabaseUrl, publicToken, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
