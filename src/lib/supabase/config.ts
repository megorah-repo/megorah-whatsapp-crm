// Supabase runtime configuration.
// The publishable key is intentionally safe for browser use. Environment variables
// remain the preferred source; these fallbacks prevent a Vercel Preview environment
// from rendering auth unusable when the public Supabase variables were not copied
// into the Preview environment.
export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://mjkfokcjtkmkvlippbew.supabase.co";

export const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "sb_publishable_G9nd3wR28LADo-WSPxoYvw_bfYNL3IZ";
