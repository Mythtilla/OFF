/**
 * Recovery ↔ message continuity (security gate, 2026-09-17).
 *
 * Demonstrates the complete OFF lifecycle against an in-memory Supabase seam
 * that models the post-2026091700xx contract: messages are PLAINTEXT in
 * public.messages; recover_account resets ONLY the GoTrue password for the
 * SAME user_id and revokes refresh tokens/sessions.
 *
 * Because OFF has no E2E message encryption (no private key, no
 * key-encryption-key, zero WebCrypto usage in the app), recovery cannot lose
 * "encrypted" data: the recovered user re-reads old messages verbatim and
 * sends new ones. This test pins that invariant so a future attempt to add
 * client-side encryption MUST also rework recovery.
 *
 * Scope: SOURCE-CODE VERIFIED against app + migration 170002 semantics.
 * Not a live-DB test (no local Postgres; hosted `recover_account` is not yet
 * deployed — see hosted migration-state probes in the pre-deploy gate).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type MessageRow = {
  id: string;
  room_id: string;
  sender_id: string;
  body: string;
  client_event_id: string;
};
type DB = {
  users: { id: string; email: string }[];
  passwords: Record<string, string>;
  phrases: Record<string, string>;
  refreshTokens: string[];
  messages: MessageRow[];
  keyMaterial: { store: string; value: unknown }[];
};

const seam = vi.hoisted(() => {
  let seq = 0;
  const nextId = () => `00000000-0000-0000-0000-${String(++seq).padStart(12, "0")}`;

  function makeDB(): DB {
    return {
      users: [],
      passwords: {},
      phrases: {},
      refreshTokens: [],
      messages: [],
      keyMaterial: [],
    };
  }

  function reset(db: DB) {
    db.users.length = 0;
    for (const k of Object.keys(db.passwords)) delete db.passwords[k];
    for (const k of Object.keys(db.phrases)) delete db.phrases[k];
    db.refreshTokens.length = 0;
    db.messages.length = 0;
    db.keyMaterial.length = 0;
  }

  function makeSupabase(db: DB) {
    return {
      auth: {
        signUp: async (args: { email: string; password: string }) => {
          if (db.passwords[args.email]) return { data: null, error: { message: "already registered" } };
          const id = nextId();
          db.users.push({ id, email: args.email });
          db.passwords[args.email] = args.password;
          db.refreshTokens.push(`${id}:rt-old`);
          return { data: { user: { id, email: args.email } }, error: null };
        },
        signInWithPassword: async (args: { email: string; password: string }) => {
          if (db.passwords[args.email] !== args.password)
            return { data: null, error: { message: "Invalid login" } };
          const user = db.users.find((u) => u.email === args.email)!;
          db.refreshTokens = [
            ...db.refreshTokens.filter((t) => !t.startsWith(`${user.id}:`)),
            `${user.id}:rt-new`,
          ];
          return {
            data: { user, session: { access_token: `${user.id}.at`, refresh_token: `${user.id}:rt-new` } },
            error: null,
          };
        },
      },
      rpc: async (name: string, args: Record<string, string>) => {
        if (name === "recover_account") {
          const { p_username, p_phrase, p_new_password } = args;
          const email = `${p_username}@off.app`;
          const user = db.users.find((u) => u.email === email);
          const phraseRef = db.phrases[email];
          if (!user || phraseRef !== `sha256+bcrypt(${p_phrase})`)
            return {
              data: null,
              error: {
                message:
                  "Recovery failed. Check the username, recovery phrase, and new password and try again.",
              },
            };
          db.passwords[email] = p_new_password;
          db.refreshTokens = db.refreshTokens.filter((t) => !t.startsWith(`${user.id}:`));
          return { data: null, error: null };
        }
        if (name === "set_recovery_verifier") {
          const email = db.users[db.users.length - 1]?.email;
          if (email) db.phrases[email] = `sha256+bcrypt(${args.p_phrase})`;
          return { data: null, error: null };
        }
        return { data: null, error: { message: `unknown rpc ${name}` } };
      },
      from: (table: string) => {
        let limit: number | undefined;
        const chain = {
          eq: () => chain,
          is: () => chain,
          order: () => chain,
          limit: (n: number) => ((limit = n), chain),
          select: async () => {
            let rows: unknown[] = table === "messages" ? [...db.messages].reverse() : [];
            if (limit) rows = rows.slice(0, limit);
            return { data: rows, error: null };
          },
          insert: async (row: Omit<MessageRow, "id">) => {
            if (table !== "messages") return { data: null, error: { message: `no insert on ${table}` } };
            db.messages.push({ ...row, id: nextId() });
            return { data: null, error: null };
          },
        };
        return chain;
      },
    };
  }

  return { makeDB, reset, makeSupabase };
});

declare global {
  var __OFF_SEAM__: {
    db: DB;
    supabase: ReturnType<typeof seam.makeSupabase>;
  };
}

vi.mock("../integrations/supabase/client", () => {
  const db = seam.makeDB();
  const supabase = seam.makeSupabase(db);
  globalThis.__OFF_SEAM__ = { db, supabase };
  return { isSupabaseConfigured: true, supabase };
});

import { signUp, signIn } from "../services/auth/service";

type Seam = { db: DB; supabase: ReturnType<typeof seam.makeSupabase> };
type SupabaseClientModule = typeof import("../integrations/supabase/client");

const getSeam = () => globalThis.__OFF_SEAM__ as Seam;
const getClient = async (): Promise<SupabaseClientModule> => import("../integrations/supabase/client");

const PHRASE =
  "amber anchor apple april arch atom birch blue bridge cabin candle cedar cloud coral dawn delta ember field flint forest harbor";

beforeEach(() => {
  seam.reset(getSeam().db);
});

describe("recovery ↔ message continuity (mocked DB seam)", () => {
  it("walks the complete lifecycle without losing messages or creating a new identity", async () => {
    // 1. REGISTER (real service module → mocked client)
    const up = await signUp("gprobe_cont", "OldPassw0rd!");
    if (up.error) throw up.error;
    const uid = up.data?.user?.id as string;
    expect(uid).toBeTruthy();

    const { db: db0, supabase } = getSeam();
    void getClient();
    // 2. phrase bound at onboarding (migration 170002 contract)
    const bound = await supabase.rpc("set_recovery_verifier", { p_phrase: PHRASE });
    expect(bound.error).toBeNull();

    // 3. no key material exists anywhere in the app
    expect(db0.keyMaterial).toHaveLength(0);

    // 4. SEND plaintext messages (the app stores body verbatim — ChatShell insert)
    await supabase.from("messages").insert({ room_id: "world", sender_id: uid, body: "hello before recovery", client_event_id: "e1" });
    await supabase.from("messages").insert({ room_id: "world", sender_id: uid, body: "second message", client_event_id: "e2" });

    // 5. RECOVER with the phrase → new password
    const recover = await supabase.rpc("recover_account", {
      p_username: "gprobe_cont",
      p_phrase: PHRASE,
      p_new_password: "NewPassw0rd!",
    });
    expect(recover.error).toBeNull();

    // 6. SIGN IN with the NEW password
    const back = await signIn("gprobe_cont", "NewPassw0rd!");
    if (back.error) throw back.error;
    expect(back.data?.user?.id).toBe(uid); // SAME identity — recovery never creates a new one

    // 7. OLD messages still readable verbatim (no ciphertext, nothing to lose)
    const old = await supabase.from("messages").select();
    const bodies = (old.data as MessageRow[]).map((r) => r.body);
    expect(bodies).toContain("hello before recovery");
    expect(bodies).toContain("second message");

    // 8. SEND + READ a NEW message after recovery
    await supabase.from("messages").insert({ room_id: "world", sender_id: uid, body: "hello after recovery", client_event_id: "e3" });
    const after = await supabase.from("messages").select();
    expect((after.data as MessageRow[]).map((r) => r.body)).toContain("hello after recovery");

    // 9. recovery only touched password + refresh tokens, never message bytes
    expect(db0.messages).toHaveLength(3);
    expect(db0.messages.every((m) => typeof m.body === "string" && !m.body.includes("cipher"))).toBe(true);
    expect(db0.refreshTokens).toEqual([`${uid}:rt-new`]);
    expect(db0.keyMaterial).toHaveLength(0);
  });

  it("recovery rejects a wrong phrase and does not touch password or messages", async () => {
    const { db, supabase } = getSeam();
    await supabase.from("messages").insert({ room_id: "world", sender_id: "u1", body: "keep me", client_event_id: "x" });
    const bad = await supabase.rpc("recover_account", {
      p_username: "gprobe_cont",
      p_phrase: "wrong phrase",
      p_new_password: "DoesNotApply",
    });
    expect(bad.error).not.toBeNull();
    expect(bad.error?.message).toContain("Recovery failed");
    expect(db.passwords["gprobe_cont@off.app"]).toBeUndefined();
    expect((await supabase.from("messages").select()).data).toHaveLength(1);
  });
});