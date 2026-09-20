import { supabase } from "../../integrations/supabase/client";

export type MessagingFeatures = {
  /** Whether the dm-request RPC family (send_dm_request, block_user, …) exists on the host. */
  dmRequests: boolean;
  /** Whether resolve_sender_names is callable (it 404s on the stale hosted backend). */
  resolveSenderNames: boolean;
};

let cached: MessagingFeatures | null = null;

/**
 * Cheap read-only probe: resolve_sender_names exists only on updated hosts.
 * On the stale hosted backend it raises PGRST202 (function not found), which
 * tells us the whole dm-request family is missing as well.
 */
export async function probeMessagingFeatures(): Promise<MessagingFeatures> {
  if (cached) return cached;
  const result: MessagingFeatures = { dmRequests: false, resolveSenderNames: false };
  if (supabase) {
    const { error } = await supabase.rpc("resolve_sender_names", { p_ids: [] });
    result.resolveSenderNames = !error;
    result.dmRequests = result.resolveSenderNames;
  }
  cached = result;
  return result;
}

export function messagingFeaturesCached(): MessagingFeatures | null {
  return cached;
}