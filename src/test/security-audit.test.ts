import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
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
    ]);
  });
  it("enables RLS on the four core tables", () => {
    const m = MIG("202609060001_off_mvp.sql");
    for (const table of ["profiles", "rooms", "room_members", "messages"]) {
      expect(m).toContain(`alter table public.${table} enable row level security`);
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

describe("frontend hygiene", () => {
  it("contains no service-role credential path or key literal", () => {
    expect(srcText).not.toMatch(/service_role/i);
    expect(srcText).not.toMatch(/eyJ[0-9A-Za-z.]{40,}/);
  });
  it("never logs to the console", () => {
    expect(srcText).not.toMatch(/console\.(log|error|debug|warn)\s*\(/);
  });
  it("has no analytics or tracking markers", () => {
    for (const needle of ["google-analytics", "gtag", "segment", "mixpanel", "amplitude", "telemetry", "session_replay", "hotjar"]) {
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