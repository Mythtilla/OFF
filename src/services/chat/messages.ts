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
