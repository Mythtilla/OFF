import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve, sep } from "node:path";

const ROOT = process.cwd();
const MIG = (name: string) =>
  readFileSync(resolve(ROOT, "supabase/migrations", name), "utf8");
const isProdSource = (f: string) => !f.includes(`${sep}test${sep}`);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const migrationNames: string[] = [];
let srcFiles: string[] = [];
let srcText = "";
let indexHtml = "";

beforeAll(() => {
  const dir = join(ROOT, "supabase/migrations");
  migrationNames.push(
    ...readdirSync(dir).filter((n) => n.endsWith(".sql")).sort(),
  );
  srcFiles = walk(join(ROOT, "src")).filter(isProdSource);
  srcText = srcFiles.map((f) => readFileSync(f, "utf8")).join("\n");
  indexHtml = readFileSync(resolve(ROOT, "index.html"), "utf8");
});

describe("migration chain integrity", () => {
  it("starts at 202609060001 and stays sequential", () => {
    expect(migrationNames).toEqual([
      "202609060001_off_mvp.sql",
      "202609060002_phase1_hardening.sql",
      "202609060003_phase15_schema_and_membership.sql",
      "202609060004_rooms_rpc.sql",
      "202609060005_authoritative_rls.sql",
      "202609060006_integrity_constraints.sql",
      "202609060007_owner_invariant.sql",
      "202609060008_onboarding_interests.sql",
      "202609060009_onboarding_state.sql",
      "202609060010_onboarding_completion.sql",
      "202609060011_onboarding_trusted_state.sql",
      "202609060012_username_identity_integrity.sql",
      "202609060013_onboarding_transitions.sql",
      "202609060014_message_integrity_guard.sql",
      "202609060015_profile_field_guard.sql",
      "202609070001_username_status.sql",
      "202609160001_dm_requests.sql",
      "202609160002_blocks.sql",
      "202609160003_privacy_flags.sql",
      "202609160004_rls_privacy_policies.sql",
      "202609160005_requests_blocks_rpc.sql",
      "202609160006_onboarding_slim.sql",
      "202609170001_rate_limits.sql",
      "202609170002_recovery.sql",
      "202609170003_avatar_scheme_guard.sql",
      "202609170004_profile_extras.sql",
    ]);
  });
  it("enables RLS on every application table in the chain", () => {
    const chain = migrationNames.map((n) => MIG(n)).join("\n");
    for (const table of ["profiles", "rooms", "room_members", "messages", "dm_threads", "user_interests", "dm_requests", "blocks", "rate_counters", "recovery_verifiers", "profile_private", "profile_links"]) {
      expect(chain, `${table} must enable RLS`).toContain(
        `alter table public.${table} enable row level security`,
      );
    }
  });
  it("caps message body length on the server", () => {
    const m = MIG("202609060001_off_mvp.sql");
    expect(m).toMatch(/check\(char_length\(body\) between 1 and 4000\)/);
  });
  it("seeds the world room", () => {
    const m = MIG("202609060001_off_mvp.sql");
    expect(m).toMatch(/'world','World',/);
  });
  it("creates the profile trigger with SECURITY DEFINER and search_path", () => {
    const m = MIG("202609060001_off_mvp.sql");
    expect(m).toMatch(/handle_new_user/);
    expect(m).toMatch(/security definer set search_path=public/);
    expect(m).toMatch(/on_auth_user_created/);
  });
});

describe("helper authorization functions", () => {
  it("function helpers are SECURITY DEFINER and scoped to public", () => {
    for (const fn of ["is_room_member", "is_room_moderator", "can_access_thread", "is_room_owner", "require_authenticated"]) {
      const found = migrationNames.find((n) => MIG(n).includes(`function public.${fn}`));
      expect(found, `${fn} must be defined`).toBeTruthy();
      expect(MIG(found!).toLowerCase()).toMatch(/security definer set search_path\s*=\s*public/);
    }
  });
  it("every helper that mutates is revoked from public and granted only to authenticated", () => {
    const m = MIG("202609060004_rooms_rpc.sql");
    expect(m).toMatch(/revoke all on function public.join_public_room/);
    expect(m).toMatch(/grant execute on function public.join_public_room/);
    expect(m.match(/to anon/g)).toBeNull();
  });
});

describe("authoritative RLS (migration 005)", () => {
  const m = MIG("202609060005_authoritative_rls.sql");
  it("drops all previous application policies first", () => {
    expect(m).toMatch(/drop policy if exists %I on %I\.%I/);
  });
  it("profiles: read-only visibility, self-only updates", () => {
    expect(m).toMatch(/profiles_read on profiles for select to authenticated using \(true\)/);
    expect(m).toMatch(/profiles_update_self on profiles for update to authenticated using\(id=auth\.uid\(\)\) with check\(id=auth\.uid\(\)\)/);
  });
  it("rooms: world/interest public, custom non-private, member-only private", () => {
    expect(m).toMatch(/rooms_read on rooms for select to authenticated using \(kind in \('world','interest'\) or \(kind='custom' and not is_private\) or is_room_member\(id\)\)/);
  });
  it("membership inserts never accept roles outside member/moderator", () => {
    expect(m).toMatch(/membership_owner_insert on room_members for insert to authenticated with check \(is_room_owner\(room_id\) and role in \('member','moderator'\)\)/);
    expect(m).toMatch(/membership_join_public on room_members for insert to authenticated with check \(user_id=auth\.uid\(\) and role='member'/);
  });
  it("messages: sender-forced and destination-authorized", () => {
    expect(m).toMatch(/messages_insert on messages for insert to authenticated with check \(sender_id=auth\.uid\(\)/);
    expect(m).toMatch(/messages_update_author on messages for update to authenticated using\(sender_id=auth\.uid\(\)\) with check\(sender_id=auth\.uid\(\)\)/);
    expect(m).toMatch(/messages_delete_author on messages for delete to authenticated using\(sender_id=auth\.uid\(\)\)/);
  });
  it("private DMs read only by participants", () => {
    expect(m).toMatch(/dm_threads_participant_read on dm_threads for select to authenticated using\(auth\.uid\(\) in \(participant_low,participant_high\)\)/);
  });
  it("dm creation blocks self-messaging and canonicalizes order", () => {
    expect(m).toMatch(/Cannot message yourself/);
    expect(m).toMatch(/least\(auth\.uid\(\),target_user\)/);
    expect(m).toMatch(/greatest\(auth\.uid\(\),target_user\)/);
  });
});

describe("ownership and immutability invariants", () => {
  it("owner deletion/demotion is blocked by a trigger", () => {
    const m = MIG("202609060007_owner_invariant.sql");
    expect(m).toMatch(/old\.role='owner'/);
    expect(m).toMatch(/Ownership transfer is required/);
    expect(m).toMatch(/protect_room_owner_trigger/);
  });
  it("room creation serializes slug collisions with an advisory lock", () => {
    const m = MIG("202609060007_owner_invariant.sql");
    expect(m).toMatch(/pg_advisory_xact_lock\(hashtext\(base_slug\)\)/);
  });
  it("username identity is immutable and lowercase-only", () => {
    const m = MIG("202609060012_username_identity_integrity.sql");
    expect(m).toMatch(/\^\[a-z0-9_\]\{3,32\}\$/);
    expect(m).toMatch(/Username cannot be changed/);
    expect(m).toMatch(/profiles_username_lower_unique/);
  });
  it("message identity and destination are immutable", () => {
    const m = MIG("202609060014_message_integrity_guard.sql");
    for (const field of ["sender_id", "created_at", "client_event_id", "room_id", "thread_id"])
      expect(m).toMatch(new RegExp(`new\\.${field} is distinct from old\\.${field}`));
    expect(m).toMatch(/Message identity and destination are immutable/);
  });
  it("country fields are managed server-side only", () => {
    const m = MIG("202609060015_profile_field_guard.sql");
    expect(m).toMatch(/country_code is managed server-side/);
    expect(m).toMatch(/guard_profile_trusted_fields_trigger/);
  });
});

describe("onboarding trust boundaries", () => {
  const transitions = MIG("202609060013_onboarding_transitions.sql");
  it("all transition RPCs require authentication", () => {
    const m = MIG("202609060011_onboarding_trusted_state.sql") + transitions;
    expect((m.match(/perform require_authenticated\(\)/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
  it("trusted columns change only when the onboarding RPC marker is set", () => {
    const m = MIG("202609060011_onboarding_trusted_state.sql");
    expect(m).toMatch(/app\.onboarding_rpc/);
    expect(m).toMatch(/guard_onboarding_state_trigger/);
  });
  it("complete_profile constrains name and bio length", () => {
    expect(transitions).toMatch(/new_display_name,''\)\)>80/);
    expect(transitions).toMatch(/new_bio,''\)\)>500/);
  });
  it("set_onboarding_interests whitelists slugs and is idempotent", () => {
    expect(transitions).toMatch(/selected_slugs\) s where s not in \('cybersecurity','linux','programming','ai','ctf','science','hardware'\)/);
    expect(transitions).toMatch(/on conflict do nothing/);
  });
  it("completion requires every step plus world (and country) membership", () => {
    const m = MIG("202609060010_onboarding_completion.sql");
    expect(m).toMatch(/World membership is required/);
    expect(m).toMatch(/Country membership is required/);
    expect(m).toMatch(/Onboarding steps are incomplete/);
  });
});

describe("username availability RPC (migration 016)", () => {
  const m = MIG("202609070001_username_status.sql");
  it("is SECURITY DEFINER with search_path=public", () => {
    expect(m.toLowerCase()).toMatch(/security definer set search_path = public/);
  });
  it("validates the canonical username pattern", () => {
    expect(m).toMatch(/\^\[a-z0-9_\]\{3,32\}\$/);
  });
  it("caps suggestions at 4 and never exceeds 32 chars", () => {
    expect(m).toMatch(/char_length\(base \|\| suffix\) <= 32/);
    expect(m).toMatch(/pool\[1:4\]/);
  });
  it("only the fixed suffix pool can be suggested", () => {
    expect(m).toMatch(/\['1','2','3','_off','20','_1','_2','_99'\]/);
  });
  it("is revoked from public and granted only to anon+authenticated", () => {
    expect(m).toMatch(/revoke all on function public\.username_status\(text\) from public;/);
    expect(m).toMatch(/grant execute on function public\.username_status\(text\) to anon, authenticated;/);
    expect(m).not.toMatch(/service_role/);
  });
});

describe("requests, blocks, and privacy flags (migrations 160001-160005)", () => {
  const requests = MIG("202609160001_dm_requests.sql");
  const blocks = MIG("202609160002_blocks.sql");
  const flags = MIG("202609160003_privacy_flags.sql");
  const privacyPolicies = MIG("202609160004_rls_privacy_policies.sql");
  const rpc = MIG("202609160005_requests_blocks_rpc.sql");
  const rpcNames = [
    "send_dm_request",
    "accept_dm_request",
    "reject_dm_request",
    "block_user",
    "unblock_user",
  ];

  it("dm_requests enables RLS and grants only scoped SELECT readers", () => {
    expect(requests).toMatch(/alter table public\.dm_requests enable row level security/);
    expect(requests).toMatch(/dm_requests_select on dm_requests for select to authenticated/);
    expect(requests).toMatch(/recipient_id = auth\.uid\(\) or sender_id = auth\.uid\(\)/);
    expect(requests).toMatch(/revoke all on table public\.dm_requests from anon/);
    expect(requests).not.toMatch(/for insert|for update|for delete/);
  });
  it("blocks enables RLS and is readable only by the blocker", () => {
    expect(blocks).toMatch(/alter table public\.blocks enable row level security/);
    expect(blocks).toMatch(/blocks_select_own on blocks for select to authenticated/);
    expect(blocks).toMatch(/using \(blocker_id = auth\.uid\(\)\)/);
    expect(blocks).not.toMatch(/for insert|for update|for delete/);
  });
  it("privacy flags default to private", () => {
    expect(flags).toMatch(/discoverable boolean not null default false/);
    expect(flags).toMatch(/contactable boolean not null default false/);
  });
  it("privacy policies never reference a non-existent user_id column", () => {
    expect(privacyPolicies).toMatch(/using \(id = auth\.uid\(\) or discoverable\)/);
    expect(privacyPolicies).not.toMatch(/user_id = auth\.uid\(\)/);
  });
  it("provides the sender-label carve-out RPC, scoped like the helper RPCs", () => {
    expect(privacyPolicies).toMatch(/function public\.resolve_sender_names\(uuid\[\]\)/);
    expect(privacyPolicies).toMatch(/returns table \(id uuid, username text, display_name text, avatar_url text\)/);
    expect(privacyPolicies).toMatch(/security definer set search_path = public/);
    expect(privacyPolicies).toMatch(/revoke all on function public\.resolve_sender_names\(uuid\[\]\) from public/);
    expect(privacyPolicies).toMatch(/grant execute on function public\.resolve_sender_names\(uuid\[\]\) to authenticated/);
  });
  it("the full request/block lifecycle lives in SECURITY DEFINER RPCs", () => {
    for (const fn of rpcNames) {
      expect(rpc, fn).toMatch(new RegExp(`function public\\.${fn}\\(`));
      expect(rpc, fn).toMatch(/security definer set search_path = public/);
    }
  });
  it("every new mutation RPC is revoked from public and granted to authenticated", () => {
    for (const fn of rpcNames) {
      expect(rpc, fn).toMatch(new RegExp(`revoke all on function public\\.${fn}\\(uuid\\) from public`));
      expect(rpc, fn).toMatch(new RegExp(`grant execute on function public\\.${fn}\\(uuid\\) to authenticated`));
    }
  });
  it("dm_requests and blocks are part of the realtime publication only as scoped rows", () => {
    const publication = migrationNames.map((n) => MIG(n)).join("\n");
    expect(publication).toMatch(/alter publication supabase_realtime add table public\.dm_requests/);
  });
  it("request/thread boundaries enforce blocks server-side", () => {
    expect(rpc).toMatch(/is_blocked\(auth\.uid\(\), target_user\) or public\.is_blocked\(target_user, auth\.uid\(\)\)/);
  });
  it("thread creation requires an accepted request or an existing thread", () => {
    expect(rpc).toMatch(/A mutual message request is required before you can start a conversation/);
  });
  it("re-sending a request reopens a previously rejected one, never re-accepts", () => {
    expect(rpc).toMatch(/on conflict \(sender_id, recipient_id\)/);
    expect(rpc).toMatch(/do update set status = 'pending'/);
    expect(rpc).toMatch(/where dm_requests\.status <> 'accepted'/);
  });
  it("existing tables still satisfy the universal RLS requirement", () => {
    const chain = migrationNames.map((n) => MIG(n)).join("\n");
    expect(chain, "profiles").toContain("alter table public.profiles enable row level security");
    expect(chain, "rooms").toContain("alter table public.rooms enable row level security");
    expect(chain, "room_members").toContain("alter table public.room_members enable row level security");
    expect(chain, "messages").toContain("alter table public.messages enable row level security");
    expect(chain, "dm_threads").toContain("alter table public.dm_threads enable row level security");
    expect(chain, "user_interests").toContain("alter table public.user_interests enable row level security");
  });
});

describe("frontend hygiene", () => {
  it("contains no service-role credential path or key literal", () => {
    expect(srcText).not.toMatch(/service_role/i);
    expect(srcText).not.toMatch(/eyJ[0-9A-Za-z.]{40,}/);
  });
  it("never logs to the console", () => {
    expect(srcText).not.toMatch(/console\.(log|error|debug|warn)\s*\(/);
  });
  it("has no analytics or tracking markers", () => {
    for (const needle of ["google-analytics", "gtag", "segment.io", "mixpanel", "amplitude", "telemetry", "session_replay", "hotjar"]) {
      expect(indexHtml + srcText, needle).not.toContain(needle);
    }
  });
  it("uses only the two documented env vars", () => {
    const matched = srcText.match(/import\.meta\.env\.[A-Z_]+/g) ?? [];
    expect([...new Set(matched)].sort()).toEqual([
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY",
      "import.meta.env.VITE_SUPABASE_URL",
    ]);
  });
  it("falls back to an unconfigured client instead of a fake key", () => {
    const c = readFileSync(resolve(ROOT, "src/integrations/supabase/client.ts"), "utf8");
    expect(c).toMatch(/supabase = isSupabaseConfigured\s*\?\s*createClient\(url,\s*key,/);
    expect(c).toMatch(/: null;/);
  });
});

describe("frontend/server policy parity", () => {
  const f = (name: string) => readFileSync(resolve(ROOT, "src", name), "utf8");
  it("username pattern matches the database constraint", () => {
    const client = f("services/auth/username.ts");
    const db = MIG("202609060012_username_identity_integrity.sql");
    expect(client).toMatch(/\^\[a-z0-9_\]\{3,32\}\$/);
    expect(db).toMatch(/\^\[a-z0-9_\]\{3,32\}\$/);
  });
  it("message length constant matches the database check", () => {
    const client = f("services/chat/messages.ts");
    const db = MIG("202609060002_phase1_hardening.sql");
    expect(client).toMatch(/4000/);
    expect(db).toMatch(/between 1 and 4000/);
  });
  it("interest slugs match the onboarding whitelist", () => {
    const client = f("services/onboarding/interests.ts");
    const db = MIG("202609060013_onboarding_transitions.sql");
    for (const slug of ["cybersecurity", "linux", "programming", "ai", "ctf", "science", "hardware"]) {
      expect(client, slug).toContain(`"${slug}"`);
      expect(db, slug).toContain(`'${slug}'`);
    }
  });
  it("password minimum matches the server minimum", () => {
    const config = readFileSync(resolve(ROOT, "supabase/config.toml"), "utf8");
    const match = config.match(/^\s*minimum_password_length\s*=\s*(\d+)/m);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBe(6);
  });
});

describe("rate limits and anti-enumeration (migration 170001)", () => {
  const m = MIG("202609170001_rate_limits.sql");
  it("rate_counters is not readable by any client role", () => {
    expect(m).toMatch(/alter table public\.rate_counters enable row level security/);
    expect(m).toMatch(/revoke all on table public\.rate_counters from anon/);
    expect(m).toMatch(/revoke all on table public\.rate_counters from authenticated/);
    expect(m).toMatch(/revoke all on table public\.rate_counters from public/);
  });
  it("rate_limited helper is SECURITY DEFINER and client-revoked", () => {
    expect(m).toMatch(/function public\.rate_limited\(text, integer, interval\)/);
    expect(m).toMatch(/security definer set search_path = public/);
    for (const role of ["anon", "authenticated", "public"])
      expect(m).toMatch(new RegExp(`revoke all on function public\\.rate_limited\\(text, integer, interval\\) from ${role}`));
  });
  it("username_status rewrite keeps the contract and grants while throttling", () => {
    expect(m).toMatch(/function public\.username_status\(p_username text\)/);
    expect(m).toMatch(/security definer set search_path = public/);
    expect(m).toMatch(/revoke all on function public\.username_status\(text\) from public/);
    expect(m).toMatch(/grant execute on function public\.username_status\(text\) to anon, authenticated/);
    expect(m).toMatch(/\^\[a-z0-9_\]\{3,32\}\$/);
  });
  it("anonymous probes are throttled per source and globally", () => {
    expect(m).toMatch(/x-forwarded-for/);
    expect(m).toMatch(/username_status:anon:global/);
    expect(m).toMatch(/public\.rate_limited\(/);
  });
  it("rate_limited opportunistically sweeps expired windows", () => {
    expect(m).toMatch(/interval '1 day'/);
    expect(m).toMatch(/window_start < now\(\)/);
  });
});

describe("password recovery (migration 170002)", () => {
  const m = MIG("202609170002_recovery.sql");
  it("enables pgcrypto for the one-way verifier", () => {
    expect(m).toMatch(/create extension if not exists pgcrypto/);
    expect(m).toMatch(/digest\(p_phrase, 'sha256'\)/);
  });
  it("recovery_verifiers has RLS and no policies for any client role", () => {
    expect(m).toMatch(/alter table public\.recovery_verifiers enable row level security/);
    for (const role of ["anon", "authenticated", "public"])
      expect(m).toMatch(new RegExp(`revoke all on table public\\.recovery_verifiers from ${role}`));
    expect(m).not.toMatch(/create policy/);
  });
  it("set_recovery_verifier is self-scoped and marks onboarding done", () => {
    expect(m).toMatch(/function public\.set_recovery_verifier\(p_phrase text\)/);
    expect(m).toMatch(/security definer set search_path = public/);
    expect(m).toMatch(/perform require_authenticated\(\)/);
    expect(m).toMatch(/revoke all on function public\.set_recovery_verifier\(text\) from public/);
    expect(m).toMatch(/grant execute on function public\.set_recovery_verifier\(text\) to authenticated/);
    expect(m).toMatch(/recovery_acknowledged_at = coalesce\(recovery_acknowledged_at, now\(\)\)/);
  });
  it("recover_account is a non-enumerating, locked, session-revoking reset", () => {
    expect(m).toMatch(/function public\.recover_account\(/);
    expect(m).toMatch(/security definer set search_path = public/);
    expect(m).toMatch(/revoke all on function public\.recover_account\(text, text, text\) from public/);
    expect(m).toMatch(/grant execute on function public\.recover_account\(text, text, text\) to anon, authenticated/);
    expect(m).toMatch(/Recovery failed\. Check the username, recovery phrase, and new password and try again\./);
    expect(m).toMatch(/Too many recovery attempts\. Try again later\./);
    expect(m).toMatch(/v_attempts >= 5/);
    expect(m).toMatch(/locked_until = now\(\) \+ interval '5 minutes'/);
  });
  it("password reset rehashes the GoTrue password and drops all sessions", () => {
    expect(m).toMatch(/encrypted_password = crypt\(p_new_password, gen_salt\('bf', 10\)\)/);
    expect(m).toMatch(/delete from auth\.refresh_tokens where user_id = v_user_id/);
    expect(m).toMatch(/to_regclass\('auth\.sessions'\)/);
  });
  it("recovery phrase validation enforces exactly 24 lowercase wordlist tokens", () => {
    expect(m).toMatch(/\^\[a-z\]\{2,10\}\$/);
    expect(m).toMatch(/count\(\*\) filter/);
  });
it("internal crypto helpers are revoked from all client roles", () => {
    for (const fn of [
      "recovery_hash(text)",
      "recovery_matches(text, text)",
      "recovery_phrase_valid(text)",
    ]) {
      const expected = `revoke all on function public.${fn} from anon;\nrevoke all on function public.${fn} from authenticated;\nrevoke all on function public.${fn} from public;`;
      expect(m, fn).toContain(expected);
    }
  });
});

describe("CSP pins exactly the scripts in the built page (no stale hashes)", () => {
  const normalize = (hash: string) => hash.replace(/=+$/g, "");
  function cspHeader(): string {
    const line = readFileSync(resolve(ROOT, "public/_headers"), "utf8")
      .split("\n")
      .find((l) => l.includes("Content-Security-Policy:"));
    expect(line, "CSP header must exist").toBeTruthy();
    const match = line!.match(/Content-Security-Policy:\s*(.+)$/);
    expect(match).toBeTruthy();
    return match![1];
  }
  function inlineScripts(html: string): string[] {
    const out: string[] = [];
    const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      if (!/\bsrc\s*=/.test(m[0])) out.push(m[1]);
    }
    return out;
  }
  it("every sha256 pinned in the CSP matches an inline script in the built page", () => {
    const pinned = [...cspHeader().matchAll(/'sha256-([A-Za-z0-9+/=]+)'/g)].map((x) =>
      normalize(x[1]),
    );
    let html: string;
    try {
      html = readFileSync(resolve(ROOT, "dist/index.html"), "utf8");
    } catch {
      html = readFileSync(resolve(ROOT, "index.html"), "utf8");
    }
    const computed = inlineScripts(html).map((s) =>
      normalize(createHash("sha256").update(s, "utf8").digest("base64")),
    );
    expect(pinned.sort()).toEqual(computed.sort());
  });
  it("script-src never allows unsafe-inline", () => {
    const match = cspHeader().match(/script-src\s+([^;]*)/);
    expect(match).toBeTruthy();
    const scriptSrc = match![1];
    expect(scriptSrc).toContain("'self'");
    expect(scriptSrc).not.toContain("unsafe-inline");
  });
});

describe("avatar scheme guard (migration 170003)", () => {
  const m = MIG("202609170003_avatar_scheme_guard.sql");
  it("sanitizes existing out-of-scheme rows to NULL", () => {
    expect(m).toMatch(/update public\.profiles\s+set avatar_url = null/);
    expect(m).toMatch(/\^https:\/\//i);
    expect(m).toMatch(/\^data:image\//i);
  });
  it("adds a CHECK that only permits https or inline images", () => {
    expect(m).toMatch(/add constraint profiles_avatar_url_scheme/);
    expect(m).toMatch(/avatar_url is null/);
    expect(m).toMatch(/or avatar_url ~\* '\^https:\/\/'/i);
    expect(m).toMatch(/or avatar_url ~\* '\^data:image\/'/i);
  });
});