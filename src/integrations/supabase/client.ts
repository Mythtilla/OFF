import { createClient } from "@supabase/supabase-js";
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const isSupabaseConfigured = Boolean(url && key);
// Session persistence (F8, audit): persistSession: true keeps the session in
// localStorage so a refresh doesn't log the user out — the trade-off is that
// the (revocable) refresh token lives in browser storage. OFF is a static
// Workers SPA with no server-side rendering context, so there is no safe
// separate storage to move it to; the exposure is mitigated by short token
// lifetimes, server-side logout (refresh-token and session deletion on
// password reset / block, see migration 202609170002), and the fact that the
// refresh token can only be used against this project's auth endpoint. Do not
// move to sessionStorage or memory persistence: it would log users out on
// every tab/task switch without improving security.
export const supabase = isSupabaseConfigured
  ? createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null;
