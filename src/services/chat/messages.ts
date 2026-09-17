import type { Message } from "./types";
export const MAX_MESSAGE_LENGTH = 4000;
export function validateMessageBody(body: string) {
  const value = body.trim();
  if (!value) return { value, error: "Write a message before sending." };
  if (value.length > MAX_MESSAGE_LENGTH)
    return {
      value,
      error: `Messages are limited to ${MAX_MESSAGE_LENGTH} characters.`,
    };
  return { value, error: null };
}
export type PendingMessage = Message & {
  client_event_id: string;
  pending?: boolean;
};
export type MessageGroup = { sender_id: string; messages: PendingMessage[] };
export function groupMessages(messages: PendingMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  for (const message of messages) {
    const last = groups[groups.length - 1];
    if (last && last.sender_id === message.sender_id)
      last.messages.push(message);
    else groups.push({ sender_id: message.sender_id, messages: [message] });
  }
  return groups;
}
/** Replaces a local optimistic event with its persisted counterpart exactly once. */
export function reconcileMessage(
  messages: PendingMessage[],
  incoming: PendingMessage,
) {
  const localIndex = messages.findIndex(
    (message) => message.client_event_id === incoming.client_event_id,
  );
  if (localIndex >= 0)
    return messages.map((message, index) =>
      index === localIndex ? { ...incoming, pending: false } : message,
    );
  if (messages.some((message) => message.id === incoming.id)) return messages;
  return [...messages, { ...incoming, pending: false }];
}
/** Reconcile an incoming UPDATE event (edit or soft-delete). */
export function reconcileUpdate(
  messages: PendingMessage[],
  incoming: PendingMessage,
) {
  return messages.map((message) =>
    message.id === incoming.id ? { ...incoming, pending: false } : message,
  );
}
/** Reconcile an incoming DELETE event (hard delete). */
export function reconcileDelete(
  messages: PendingMessage[],
  incomingId: string,
) {
  return messages.filter((message) => message.id !== incomingId);
}
/** Date separator label for two timestamps. */
function toDateKey(ts: string): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
export type DateSeparator = { kind: "date"; label: string; key: string };
export type BubbleMessage = {
  kind: "message";
  message: PendingMessage;
  first: boolean;
  replyBody?: string | null;
};
export type RenderItem = DateSeparator | BubbleMessage;
/** Build a flat list of date separators + messages for rendering. */
export function buildRenderList(
  messages: PendingMessage[],
  replyMap: Map<string, string>,
): RenderItem[] {
  const items: RenderItem[] = [];
  let lastDateKey = "";
  let lastSenderId = "";
  for (const message of messages) {
    const dateKey = toDateKey(message.created_at);
    if (dateKey !== lastDateKey) {
      const d = new Date(message.created_at);
      const now = new Date();
      const todayKey = toDateKey(now.toISOString());
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayKey = toDateKey(yesterday.toISOString());
      let label: string;
      if (dateKey === todayKey) label = "Today";
      else if (dateKey === yesterdayKey) label = "Yesterday";
      else
        label = d.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
        });
      items.push({ kind: "date", label, key: dateKey });
      lastSenderId = "";
    }
    const first = message.sender_id !== lastSenderId;
    const replyBody = message.reply_to
      ? replyMap.get(message.reply_to) ?? null
      : null;
    items.push({ kind: "message", message, first, replyBody });
    lastDateKey = dateKey;
    lastSenderId = message.sender_id;
  }
  return items;
}
/** Format a timestamp as short time (HH:MM, 24-hour for consistency). */
export function shortTime(ts: string): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
/** Format a timestamp as relative (e.g. "2m", "3h", "Mon"). */
export function relativeTime(ts: string): string {
  const now = Date.now();
  const then = new Date(ts).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "now";
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7)
    return new Date(ts).toLocaleDateString(undefined, { weekday: "short" });
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
