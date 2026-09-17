import { type Room } from "../../services/chat/types";
import { relativeTime } from "../../services/chat/messages";

type ChatListProps = {
  rooms: Room[];
  active: Room | null;
  previews: Record<string, { body: string; created_at: string }>;
  members: Record<string, boolean>;
  query: string;
  onQueryChange: (value: string) => void;
  onSelect: (room: Room) => void;
};

export default function ChatList({
  rooms,
  active,
  previews,
  members,
  query,
  onQueryChange,
  onSelect,
}: ChatListProps) {
  const visible = rooms
    .filter((room) => members[room.id])
    .filter(
      (room) =>
        !query ||
        room.name.toLowerCase().includes(query.toLowerCase()) ||
        (room.topic ?? "").toLowerCase().includes(query.toLowerCase()),
    );
  const worldRoom = visible.find((room) => room.kind === "world") ?? null;
  const communities = visible.filter((room) => room.kind !== "world");

  return (
    <>
      <input
        className="chat-search"
        type="search"
        placeholder="Search rooms..."
        value={query}
        onInput={(event) =>
          onQueryChange((event.target as HTMLInputElement).value)
        }
        aria-label="Search rooms"
      />
      {worldRoom && (
        <section>
          <p>WORLD</p>
          <ChatRoomRow
            room={worldRoom}
            preview={previews[worldRoom.id]}
            selected={active?.id === worldRoom.id}
            onSelect={onSelect}
          />
        </section>
      )}
      {communities.length > 0 && (
        <section>
          <p>COMMUNITIES</p>
          {communities.map((room) => (
            <ChatRoomRow
              key={room.id}
              room={room}
              preview={previews[room.id]}
              selected={active?.id === room.id}
              onSelect={onSelect}
            />
          ))}
        </section>
      )}
    </>
  );
}

function ChatRoomRow({
  room,
  preview,
  selected,
  onSelect,
}: {
  room: Room;
  preview?: { body: string; created_at: string };
  selected: boolean;
  onSelect: (room: Room) => void;
}) {
  return (
    <button
      className={`chat-list-room${selected ? " selected" : ""}`}
      type="button"
      onClick={() => onSelect(room)}
      aria-current={selected ? "true" : undefined}
    >
      <span className="avatar">{room.name.slice(0, 1)}</span>
      <span className="chat-list-info">
        <span className="chat-list-name">
          {room.kind === "world" ? <span className="hash">#</span> : null}
          {room.name}
          {room.is_private ? (
            <span className="lock" aria-label="Private room">
              🔒
            </span>
          ) : null}
        </span>
        {preview ? (
          <span className="chat-list-preview">{preview.body}</span>
        ) : null}
      </span>
      {preview ? (
        <span className="chat-list-time">
          {relativeTime(preview.created_at)}
        </span>
      ) : null}
    </button>
  );
}