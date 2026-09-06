import { supabase } from "../../integrations/supabase/client";
import { usernameToAuthEmail } from "./username";
export async function signIn(username: string, password: string) {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase.auth.signInWithPassword({
    email: usernameToAuthEmail(username),
    password,
  });
}
export async function signUp(username: string, password: string) {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase.auth.signUp({
    email: usernameToAuthEmail(username),
    password,
    options: { data: { username: username.trim() } },
  });
}
