import { useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../../integrations/supabase/client";
import { canPostToRoom } from "../../services/rooms/permissions";
import {
  buildRenderList,
  reconcileDelete,
  reconcileMessage,
  reconcileUpdate,
  shortTime,
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
import { visibleRooms } from "../../services/navigation/layout";
import type { Preview } from "../../services/chat/previews";
import { groupPreviews } from "../../services/chat/previews";
import { Avatar } from "./Avatar";
import { ProfileSettings } from "./ProfileSettings";
import ChatList from "./ChatList";

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
    [previews, setPreviews] = useState<Preview[]>([]),
    [senders, setSenders] = useState<Record<string, Profile>>({}),
    [selfProfile, setSelfProfile] = useState<Profile | null>(null),
    [draft, setDraft] = useState(""),
    [replyTarget, setReplyTarget] = useState<PendingMessage | null>(null),
    [editingMsg, setEditingMsg] = useState<PendingMessage | null>(null),
    [actionFor, setActionFor] = useState<string | null>(null),
    [roomQuery, setRoomQuery] = useState(""),
    [error, setError] = useState(""),
    [channelStatus, setChannelStatus] = useState<ChannelStatus>("Connecting"),
    [roomsOpen, setRoomsOpen] = useState(false),
    [youOpen, setYouOpen] = useState(false),
    [profileOpen, setProfileOpen] = useState(false),
    [detailsOpen, setDetailsOpen] = useState(() => {
      const mq =
        typeof window !== "undefined" && window.matchMedia
          ? window.matchMedia("(min-width: 1200px)")
          : null;
      return mq ? mq.matches : true;
    });
  const requestRef = useRef(0),
    sendersRef = useRef(senders),
    messagesEndRef = useRef<HTMLDivElement>(null);
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
      .select("id,username,display_name,avatar_url,bio,discoverable,contactable")
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
        const joinedRooms = next.filter((room) => room.is_member);
        if (joinedRooms.length) {
          client
            .from("messages")
            .select("id,room_id,body,created_at")
            .in(
              "room_id",
              joinedRooms.map((room) => room.id),
            )
            .is("deleted_at", null)
            .order("created_at", { ascending: false })
            .limit(1000)
            .then(({ data: previewRows, error: previewError }) => {
              if (previewError || !previewRows?.length) return;
              setPreviews(groupPreviews(previewRows));
            });
        }
      });
  }, [session.user.id]);

  useEffect(() => {
    const client = supabase;
    if (!client || !active) return;
    const requestId = ++requestRef.current;
    setMessages([]);
    setError("");
    setChannelStatus("Connecting");
    setReplyTarget(null);
    setEditingMsg(null);
    client
      .from("messages")
      .select(
        "id,room_id,thread_id,sender_id,body,client_event_id,created_at,edited_at,deleted_at,reply_to,profiles(id,username,display_name,avatar_url)",
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
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `room_id=eq.${active.id}`,
        },
        (payload) => {
          const row = payload.new as PendingMessage;
          setMessages((current) => reconcileUpdate(current, row));
          ensureSenders([row.sender_id]);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "messages",
          filter: `room_id=eq.${active.id}`,
        },
        (payload) => {
          const id = (payload.old as { id: string }).id;
          setMessages((current) => reconcileDelete(current, id));
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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages, active]);

  async function submitDraft(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase || !active) return;
    const checked = validateMessageBody(draft);
    if (checked.error) return setError(checked.error);
    if (editingMsg) {
      const { data, error } = await supabase
        .from("messages")
        .update({ body: checked.value, edited_at: new Date().toISOString() })
        .eq("id", editingMsg.id)
        .select(
          "id,room_id,thread_id,sender_id,body,client_event_id,created_at,edited_at,deleted_at,reply_to",
        )
        .single();
      if (error) return setError("Couldn't update message.");
      setMessages((current) =>
        reconcileUpdate(current, data as PendingMessage),
      );
      setDraft("");
      setEditingMsg(null);
      return;
    }
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
        reply_to: replyTarget?.id ?? null,
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
        reply_to:
          replyTarget && !replyTarget.id.startsWith("local-")
            ? replyTarget.id
            : null,
      })
      .select(
        "id,room_id,thread_id,sender_id,body,client_event_id,created_at,edited_at,deleted_at,reply_to",
      )
      .single();
    if (error) {
      setMessages((x) => x.filter((m) => m.client_event_id !== client_event_id));
      setError("Couldn't send message.");
    } else setMessages((x) => reconcileMessage(x, data as PendingMessage));
    if (replyTarget) setReplyTarget(null);
  }

  async function handleDelete(msg: PendingMessage) {
    setActionFor(null);
    if (!supabase || msg.id.startsWith("local-")) return;
    const deletedAt = new Date().toISOString();
    const { error } = await supabase
      .from("messages")
      .update({ deleted_at: deletedAt })
      .eq("id", msg.id);
    if (error) return setError("Couldn't delete message.");
    setMessages((current) => reconcileUpdate(current, { ...msg, deleted_at: deletedAt }));
  }

  async function handleCopy(msg: PendingMessage) {
    setActionFor(null);
    try {
      await navigator.clipboard?.writeText(msg.body);
    } catch {
      /* clipboard unavailable */
    }
  }

  function handleReply(msg: PendingMessage) {
    setActionFor(null);
    setEditingMsg(null);
    setReplyTarget(msg);
  }

  function handleEdit(msg: PendingMessage) {
    setActionFor(null);
    setReplyTarget(null);
    setEditingMsg(msg);
    setDraft(msg.body);
  }

  function cancelEdit() {
    setEditingMsg(null);
    setDraft("");
  }

  function toggleMembership() {
    if (!supabase || !active || active.kind === "world") return;
    const rpc = active.is_member ? "leave_room" : "join_public_room";
    void supabase.rpc(rpc, { target_room: active.id }).then(({ error }) => {
      if (error) {
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
    });
  }

  const memberIds = new Set(
    rooms.filter((room) => room.is_member).map((room) => room.id),
  );
  const membershipMap = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const id of memberIds) map[id] = true;
    return map;
  }, [memberIds]);
  const previewMap: Record<string, Preview> = useMemo(() => {
    const map: Record<string, Preview> = {};
    for (const preview of previews) map[preview.room_id] = preview;
    return map;
  }, [previews]);
  const world = rooms.find((room) => room.kind === "world") ?? null;
  const statusLabel = channelStatusLabel(channelStatus);

  const select = (room: Room) => {
    setActive(room);
    setRoomsOpen(false);
    setRoomQuery("");
  };

  const selectWorld = () => {
    setActive(world);
  };

  const sendDisabled = !canPostToRoom(active);

  const replyMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const message of messages) {
      if (!map.has(message.id)) map.set(message.id, message.body);
    }
    return map;
  }, [messages]);
  const renderItems = buildRenderList(messages, replyMap);
  const visibleNavRooms = visibleRooms(rooms, memberIds);

  const chatList = (
    <ChatList
      rooms={visibleNavRooms}
      active={active}
      previews={previewMap}
      members={membershipMap}
      query={roomQuery}
      onQueryChange={setRoomQuery}
      onSelect={select}
    />
  );

  const secondaryNav = (
    <>
      {visibleNavRooms.length === 0 && !active && (
        <section>
          <p>COMMUNITIES</p>
          <p className="nav-empty">Loading rooms…</p>
        </section>
      )}
      {visibleNavRooms.length === 0 && rooms.length > 0 && !active && (
        <section>
          <p>COMMUNITIES</p>
          <p className="nav-empty">You have not joined any communities yet.</p>
        </section>
      )}
    </>
  );

  const identity = (
    <>
      <div className="account">
        <Avatar
          name={selfProfile?.display_name || selfProfile?.username || "?"}
          url={selfProfile?.avatar_url}
        />
        <div>
          <b>{selfProfile?.display_name || "Member"}</b>
          <span>@{selfProfile?.username ?? session.user.user_metadata.username ?? "?"}</span>
        </div>
        <button
          aria-label={profileOpen ? "Close profile settings" : "Open profile settings"}
          aria-expanded={profileOpen}
          onClick={() => setProfileOpen((open) => !open)}
        >
          {profileOpen ? "✕" : "✎"}
        </button>
        <button onClick={() => supabase?.auth.signOut()}>Sign out</button>
      </div>
      {profileOpen && selfProfile && (
        <div className="account-profile">
          <ProfileSettings
            session={session}
            profile={selfProfile}
            onSaved={(updated) => {
              setSelfProfile(updated);
              setSenders((previous) => mergeSenderBatch(previous, [updated]));
            }}
          />
        </div>
      )}
    </>
  );

  return (
    <main className="app">
      <aside className="nav" aria-label="Communities">
        <div className="brand">
          OFF <small>OPEN FREEDOM FORUM</small>
        </div>
        <nav aria-label="Rooms">
          {chatList}
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
          <Avatar
            name={active?.name ?? "?"}
            url={active ? undefined : null}
            large={false}
          />
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
            <div className="empty">
              No messages yet. Start the conversation.
            </div>
          )}
          {renderItems.map((item) => {
            if (item.kind === "date")
              return (
                <div key={item.key} className="date-sep" role="separator">
                  <span>{item.label}</span>
                </div>
              );
            return (
              <MessageBubble
                key={item.message.id}
                message={item.message}
                first={item.first}
                replyBody={item.replyBody}
                own={item.message.sender_id === session.user.id}
                senderName={senderName(
                  item.message.sender_id,
                  senders,
                  item.message.profile,
                )}
                avatarUrl={senders[item.message.sender_id]?.avatar_url}
                actionFor={actionFor}
                onToggleAction={(id) =>
                  setActionFor((current) => (current === id ? null : id))
                }
                onReply={() => handleReply(item.message)}
                onEdit={() => handleEdit(item.message)}
                onDelete={() => void handleDelete(item.message)}
                onCopy={() => void handleCopy(item.message)}
              />
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        <form className="composer" onSubmit={submitDraft}>
          {replyTarget && (
            <div className="composer-chip">
              <div className="composer-chip-label">
                Replying to{" "}
                {senderName(
                  replyTarget.sender_id,
                  senders,
                  replyTarget.profile,
                )}
              </div>
              <div className="composer-chip-body">{replyTarget.body}</div>
              <button
                type="button"
                aria-label="Cancel reply"
                onClick={() => setReplyTarget(null)}
              >
                ✕
              </button>
            </div>
          )}
          {editingMsg && (
            <div className="composer-chip">
              <div className="composer-chip-label">Editing message</div>
              <button
                type="button"
                aria-label="Cancel edit"
                onClick={cancelEdit}
              >
                ✕
              </button>
            </div>
          )}
          <div className="composer-row">
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
              {editingMsg ? "✓" : "↑"}
            </button>
          </div>
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
              isolation.
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
          {chatList}
        </nav>
      </Sheet>

      <Sheet open={youOpen} onClose={() => setYouOpen(false)} title="You">
        <div className="you">
          <Avatar
            name={
              selfProfile?.display_name || selfProfile?.username || "?"
            }
            url={selfProfile?.avatar_url}
            large
          />
          <b>{selfProfile?.display_name || "Member"}</b>
          <span>@{selfProfile?.username ?? session.user.user_metadata.username ?? "—"}</span>
          {selfProfile && (
            <ProfileSettings
              session={session}
              profile={selfProfile}
              onSaved={(updated) => {
                setSelfProfile(updated);
                setSenders((previous) => mergeSenderBatch(previous, [updated]));
              }}
            />
          )}
          <button className="room-join" onClick={() => supabase?.auth.signOut()}>
            Sign out
          </button>
        </div>
      </Sheet>
    </main>
  );
}

function MessageBubble({
  message,
  first,
  replyBody,
  own,
  senderName,
  avatarUrl,
  actionFor,
  onToggleAction,
  onReply,
  onEdit,
  onDelete,
  onCopy,
}: {
  message: PendingMessage;
  first: boolean;
  replyBody?: string | null;
  own: boolean;
  senderName: string;
  avatarUrl?: string | null;
  actionFor: string | null;
  onToggleAction: (id: string) => void;
  onReply: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onCopy: () => void;
}) {
  const deleted = Boolean(message.deleted_at);
  const menuOpen = actionFor === message.id;
  return (
    <div className={`bubble-row ${own ? "own" : "other"}`}>
      {!own && first && (
        <Avatar name={senderName} url={avatarUrl} large={false} />
      )}
      <article className="bubble">
        {replyBody && (
          <div className="bubble-reply">
            <span>Reply</span> {replyBody}
          </div>
        )}
        {first && !own && (
          <div className="bubble-sender">{own ? "You" : senderName}</div>
        )}
        {deleted ? (
          <p className="bubble-deleted">This message was deleted</p>
        ) : (
          <p>{message.body}</p>
        )}
        <div className="bubble-meta">
          {message.edited_at ? (
            <span className="bubble-edited">edited</span>
          ) : null}
          <time dateTime={message.created_at}>
            {shortTime(message.created_at)}
          </time>
          {own ? <span className="bubble-tick">✓✓</span> : null}
        </div>
        <button
          className="bubble-action"
          type="button"
          aria-label="Message actions"
          aria-expanded={menuOpen}
          onClick={() => onToggleAction(message.id)}
        >
          ⋯
        </button>
        {menuOpen && (
          <div className="msg-menu" role="menu">
            <button type="button" onClick={onReply}>
              Reply
            </button>
            <button type="button" onClick={onCopy}>
              Copy
            </button>
            {own && !message.pending && (
              <>
                <button type="button" onClick={onEdit}>
                  Edit
                </button>
                <button type="button" onClick={onDelete}>
                  Delete
                </button>
              </>
            )}
          </div>
        )}
      </article>
    </div>
  );
}