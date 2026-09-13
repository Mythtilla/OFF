import { supabase } from "../../integrations/supabase/client";
import { canonicalizeUsername, validateUsername } from "./username";

export type UsernameCheck = {
  status: "idle" | "checking" | "available" | "unavailable" | "invalid";
  suggestions: string[];
};

type Lookup = (
  name: string,
) => Promise<{ available: boolean; suggestions: string[] }>;

async function defaultLookup(name: string) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.rpc("username_status", {
    p_username: name,
  });
  if (error || !data?.[0]) throw new Error("Username lookup failed.");
  return {
    available: data[0].available,
    suggestions: data[0].suggestions as string[],
  };
}

export async function checkUsername(
  raw: string,
  lookup: Lookup = defaultLookup,
): Promise<UsernameCheck> {
  const name = canonicalizeUsername(raw);
  if (!name) return { status: "idle", suggestions: [] };
  if (validateUsername(name)) return { status: "invalid", suggestions: [] };
  try {
    const result = await lookup(name);
    return result.available
      ? { status: "available", suggestions: [] }
      : { status: "unavailable", suggestions: result.suggestions };
  } catch {
    return { status: "idle", suggestions: [] };
  }
}