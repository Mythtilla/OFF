import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../../integrations/supabase/client";
import { canPostToRoom } from "../../services/rooms/permissions";
import {
  groupMessages,
  reconcileMessage,
  validateMessageBody,
  type PendingMessage,
} from "../../services/chat/messages";
import type { Profile, Room } from "../../services/chat/types";
import { senderName } from "../../services/profiles/map";
import {
  missingSenderIds,
  mergeSenderBatch,
} from "../../services/chat/senders";
import {
  channelStatusLabel,
  type ChannelStatus,
} from "../../services/chat/status";
import {
  groupRooms,
  visibleRooms,
} from "../../services/navigation/layout";

function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <>
      {open && (
        <button
          className="scrim sheet-scrim"
          aria-label={`Close ${title}`}
          onClick={onClose}
        />
      )}
      <aside
        className={open ? "sheet open" : "sheet"}
        aria-hidden={!open}
        aria-label={title}
      >
        <header className="sheet-head">
          <b>{title}</b>
          <button onClick={onClose} aria-label={`Close ${title}`}>
            ✕
          </button>
        </header>
        {children}
      </aside>
    </>
  );
}

export function ChatShell({ session }: { session: Session }) {
  const [rooms, setRooms] = useState<Room[]>([]),
    [active, setActive] = useState<Room | null>(null),
    [messages, setMessages] = useState<PendingMessage[]>([]),
    [senders, setSenders] = useState<Record<string, Profile>>({}),
    [selfProfile, setSelfProfile] = useState<Profile | null>(null),
    [draft, setDraft] = useState(""),
    [error, setError] = useState(""),
    [channelStatus, setChannelStatus] = useState<ChannelStatus>("Connecting"),
    [roomsOpen, setRoomsOpen] = useState(false),
    [youOpen, setYouOpen] = useState(false),
    [detailsOpen, setDetailsOpen] = useState(() => {
      const mq =
        typeof window !== "undefined" && window.matchMedia
          ? window.matchMedia("(min-width: 1200px)")
          : null;
      return mq ? mq.matches : true;
    });
  const requestRef = useRef(0),
    sendersRef = useRef(senders);
  sendersRef.current = senders;

  function ensureSenders(ids: string[]) {
    const client = supabase;
    if (!client) return;
    const missing = missingSenderIds(ids, sendersRef.current);
    if (!missing.length) return;
    client
      .from("profiles")
      .select("id,username,display_name,avatar_url")
      .in("id", missing)
      .then(({ data, error }) => {
        if (error || !data?.length) return;
        setSenders((previous) => mergeSenderBatch(previous, data));
      });
  }

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    client
      .from("profiles")
      .select("id,username,display_name,avatar_url")
      .eq("id", session.user.id)
      .single()
      .then(({ data, error }) => {
        if (error || !data) return;
        setSelfProfile(data);
        setSenders((previous) => mergeSenderBatch(previous, [data]));
      });
    client
      .from("rooms")
      .select("id,slug,name,topic,kind,is_private")
      .order("name")
      .then(async ({ data, error }) => {
        if (error) {
          setError("Couldn't load rooms.");
          return;
        }
        const base = (data ?? []) as Room[];
        const { data: memberships, error: membershipError } = await client
          .from("room_members")
          .select("room_id")
          .eq("user_id", session.user.id);
        if (membershipError) {
          setError("Couldn't load your room memberships.");
          return;
        }
        const joined = new Set((memberships ?? []).map((row) => row.room_id));
        const next = base.map((room) => ({
          ...room,
          is_member: joined.has(room.id),
        }));
        setRooms(next);
        const worldRoom = next.find((r) => r.kind === "world");
        setActive(worldRoom ?? next[0] ?? null);
      });
  }, [session.user.id]);

  useEffect(() => {
    const client = supabase;
    if (!client || !active) return;
    const requestId = ++requestRef.current;
    setMessages([]);
    setError("");
    setChannelStatus("Connecting");
    client
      .from("messages")
      .select(
        "id,room_id,thread_id,sender_id,body,client_event_id,created_at,edited_at,deleted_at,profiles(id,username,display_name,avatar_url)",
      )
      .eq("room_id", active.id)
      .is("deleted_at", null)
      .order("created_at")
      .then(({ data, error }) => {
        if (requestId !== requestRef.current) return;
        if (error) setError("Couldn't load messages.");
        else {
          const rows = (data ?? []) as PendingMessage[];
          setMessages(rows);
          ensureSenders(rows.map((message) => message.sender_id));
        }
      });
    const channel = client
      .channel(`room:${active.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `room_id=eq.${active.id}`,
        },
        (payload) => {
          const row = payload.new as PendingMessage;
          setMessages((current) => reconcileMessage(current, row));
          ensureSenders([row.sender_id]);
        },
      )
      .subscribe((status) => {
        if (requestId !== requestRef.current) return;
        setChannelStatus(status as ChannelStatus);
      });
    return () => {
      client.removeChannel(channel);
    };
  }, [active]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase || !active) return;
    const checked = validateMessageBody(draft);
    if (checked.error) return setError(checked.error);
    const client_event_id = crypto.randomUUID(),
      optimistic: PendingMessage = {
        id: `local-${client_event_id}`,
        room_id: active.id,
        thread_id: null,
        sender_id: session.user.id,
        body: checked.value,
        client_event_id,
        created_at: new Date().toISOString(),
        edited_at: null,
        deleted_at: null,
        pending: true,
      };
    setDraft("");
    setError("");
    setMessages((x) => [...x, optimistic]);
    const { data, error } = await supabase
      .from("messages")
      .insert({
        room_id: active.id,
        sender_id: session.user.id,
        body: checked.value,
        client_event_id,
      })
      .select(
        "id,room_id,thread_id,sender_id,body,client_event_id,created_at,edited_at,deleted_at",
      )
      .single();
    if (error) {
      setMessages((x) => x.filter((m) => m.client_event_id !== client_event_id));
      setError("Couldn't send message.");
    } else setMessages((x) => reconcileMessage(x, data as PendingMessage));
  }

  async function toggleMembership() {
    if (!supabase || !active || active.kind === "world") return;
    const rpc = active.is_member ? "leave_room" : "join_public_room";
    const { error: membershipError } = await supabase.rpc(rpc, {
      target_room: active.id,
    });
    if (membershipError) {
      setError("Couldn't update membership.");
      return;
    }
    setRooms((current) =>
      current.map((room) =>
        room.id === active.id ? { ...room, is_member: !room.is_member } : room,
      ),
    );
    setActive((current) =>
      current ? { ...current, is_member: !current.is_member } : current,
    );
  }

  const memberIds = new Set(
    rooms.filter((room) => room.is_member).map((room) => room.id),
  );
  const sections = groupRooms(visibleRooms(rooms, memberIds));
  const world = rooms.find((room) => room.kind === "world") ?? null;
  const statusLabel = channelStatusLabel(channelStatus);

  const select = (room: Room) => {
    setActive(room);
    setRoomsOpen(false);
  };

  const selectWorld = () => {
    setActive(world);
  };

  const sendDisabled = !canPostToRoom(active);

  const secondaryNav = (
    <>
      {sections.map((section) => (
        <section key={section.id}>
          <p>
            {section.title}
            {section.id === "custom" && (
              <span
                className="priv-count"
                title="Private rooms are visible only to members"
              >
                {section.rooms.filter((r) => r.is_private).length > 0
                  ? "🔒"
                  : ""}
              </span>
            )}
          </p>
          {section.rooms.map((room) => (
            <button
              className={active?.id === room.id ? "selected" : ""}
              key={room.id}
              onClick={() => select(room)}
            >
              <span className="hash">#</span>
              <span className="room-name">{room.name}</span>
              {room.is_private && (
                <span className="lock" aria-label="Private room">
                  🔒
                </span>
              )}
            </button>
          ))}
        </section>
      ))}
      {!active && (
        <section>
          <p>COMMUNITIES</p>
          <p className="nav-empty">Loading rooms…</p>
        </section>
      )}
      {sections.length === 0 && rooms.length > 0 && (
        <section>
          <p>COMMUNITIES</p>
          <p className="nav-empty">You have not joined any communities yet.</p>
        </section>
      )}
    </>
  );

  const identity = (
    <div className="account">
      <div className="avatar">
        {(selfProfile?.display_name ||
          selfProfile?.username ||
          "?").slice(0, 1)[0]?.toUpperCase() ?? "?"}
      </div>
      <div>
        <b>{selfProfile?.display_name || "Member"}</b>
        <span>@{selfProfile?.username ?? session.user.user_metadata.username ?? "?"}</span>
      </div>
      <button onClick={() => supabase?.auth.signOut()}>Sign out</button>
    </div>
  );

  return (
    <main className="app">
      <aside className="nav" aria-label="Communities">
        <div className="brand">
          OFF <small>OPEN FREEDOM FORUM</small>
        </div>
        <nav aria-label="Rooms">
          <button
            className={active?.kind === "world" ? "world selected" : "world"}
            onClick={selectWorld}
          >
            <span className="hash">#</span> World
          </button>
          {secondaryNav}
        </nav>
        {identity}
      </aside>

      <section className="conversation">
        <header>
          <button
            className="rooms-toggle"
            onClick={() => setRoomsOpen(true)}
            aria-label="Open communities"
          >
            #
          </button>
          <div className="room-id">
            <p className="eyebrow">
              {active?.kind === "world"
                ? "WORLD"
                : active?.kind === "interest"
                  ? "INTEREST"
                  : active?.kind === "country"
                    ? "COUNTRY"
                    : active?.kind === "custom"
                      ? active?.is_private
                        ? "PRIVATE COMMUNITY"
                        : "COMMUNITY"
                      : "ROOM"}
            </p>
            <h1>{active ? `# ${active.name}` : "Loading rooms…"}</h1>
            {active?.topic && <p className="topic">{active.topic}</p>}
          </div>
          <div className="head-actions">
            {active && active.kind !== "world" && (
              <button className="room-join" onClick={toggleMembership}>
                {active.is_member ? "Leave room" : "Join room"}
              </button>
            )}
            <span
              className={
                "presence" +
                (channelStatus === "SUBSCRIBED" ? " live" : "")
              }
            >
              {statusLabel}
            </span>
            <button
              className={
                "details-toggle" + (detailsOpen ? " active" : "")
              }
              onClick={() => setDetailsOpen((open) => !open)}
              aria-label="Room details"
              aria-expanded={detailsOpen}
            >
              i
            </button>
          </div>
        </header>

        <div className="messages" aria-live="polite">
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {messages.length === 0 && active && !error && (
            <div className="empty">No messages yet. Start the conversation.</div>
          )}
          {groupMessages(messages).map((group) => (
            <div className="group" key={group.messages[0].id}>
              {group.messages.map((message, index) => {
                const first = index === 0;
                const name = senderName(
                  message.sender_id,
                  senders,
                  message.profile,
                );
                return (
                  <article
                    className={first ? "message" : "message tucked"}
                    key={message.id}
                  >
                    {first && (
                      <div className="avatar">
                        {name.slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    <div className="body">
                      {first && (
                        <div className="meta">
                          <b>
                            {message.sender_id === session.user.id
                              ? "You"
                              : name}
                          </b>
                          <time dateTime={message.created_at}>
                            {new Intl.DateTimeFormat(undefined, {
                              hour: "2-digit",
                              minute: "2-digit",
                            }).format(new Date(message.created_at))}
                          </time>
                        </div>
                      )}
                      <p>{message.body}</p>
                    </div>
                  </article>
                );
              })}
            </div>
          ))}
        </div>

        <form className="composer" onSubmit={send}>
          <label className="sr-only" htmlFor="message">
            Message
          </label>
          <input
            id="message"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={active ? "Write a message…" : "Choose a room"}
            disabled={sendDisabled}
          />
          <button aria-label="Send message" disabled={sendDisabled}>
            ↑
          </button>
        </form>
      </section>

      <aside
        className={detailsOpen ? "details-panel open" : "details-panel"}
        aria-label="Room details"
      >
        <button
          className="details-close"
          onClick={() => setDetailsOpen(false)}
          aria-label="Close room details"
        >
          ✕
        </button>
        {active ? (
          <>
            <p className="eyebrow">ROOM NOTES</p>
            <h2>{active.name}</h2>
            {active.topic ? <p>{active.topic}</p> : <p>No notes yet.</p>}
            <hr />
            <p className="eyebrow">PRIVACY</p>
            <p>
              {active.is_private
                ? "This community is access-controlled. Only members can read or post."
                : "This community is open to the public. Messages are accessible to any signed-in member."}
            </p>
            {active.kind !== "world" && (
              <>
                <hr />
                <p className="eyebrow">MEMBERSHIP</p>
                <p>
                  {active.is_member
                    ? "You are a member of this community."
                    : "You have not joined this community."}
                </p>
                {active.kind === "custom" && active.is_member && (
                  <button className="room-join" onClick={toggleMembership}>
                    Leave room
                  </button>
                )}
              </>
            )}
            <hr />
            <p className="eyebrow">PRIVACY NOTE</p>
            <p>
              OFF stores only the information needed to operate the service.
              Conversations are protected by access controls, not end-to-end
              encryption.
            </p>
          </>
        ) : (
          <p>Select a room to see its details.</p>
        )}
      </aside>

      <div className="bottom-nav" role="tablist" aria-label="Primary">
        <button
          role="tab"
          aria-selected={active?.kind === "world"}
          onClick={selectWorld}
        >
          <span>⌂</span>
          Home
        </button>
        <button
          role="tab"
          aria-selected={roomsOpen}
          onClick={() => setRoomsOpen(true)}
        >
          <span>☷</span>
          Communities
        </button>
        <button
          role="tab"
          aria-selected={youOpen}
          onClick={() => setYouOpen(true)}
        >
          <span>{selfProfile?.username?.slice(0, 1).toUpperCase() ?? "›"}</span>
          You
        </button>
      </div>

      <Sheet open={roomsOpen} onClose={() => setRoomsOpen(false)} title="Communities">
        <nav className="sheet-rooms" aria-label="Rooms">
          <button
            className={active?.kind === "world" ? "world selected" : "world"}
            onClick={selectWorld}
          >
            <span className="hash">#</span> World
          </button>
          {secondaryNav}
        </nav>
      </Sheet>

      <Sheet open={youOpen} onClose={() => setYouOpen(false)} title="You">
        <div className="you">
          <div className="avatar large">
            {(selfProfile?.display_name || selfProfile?.username || "?").slice(0, 1).toUpperCase()}
          </div>
          <b>{selfProfile?.display_name || "Member"}</b>
          <span>@{selfProfile?.username ?? session.user.user_metadata.username ?? "—"}</span>
          <button className="room-join" onClick={() => supabase?.auth.signOut()}>
            Sign out
          </button>
        </div>
      </Sheet>
    </main>
  );
}