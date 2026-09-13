export type ChannelStatus =
  | "SUBSCRIBED"
  | "CHANNEL_ERROR"
  | "TIMED_OUT"
  | "CLOSED"
  | "Connecting";

export function channelStatusLabel(status: ChannelStatus) {
  switch (status) {
    case "SUBSCRIBED":
      return "● Live";
    case "Connecting":
      return "○ Connecting…";
    case "CHANNEL_ERROR":
      return "● Error";
    case "TIMED_OUT":
      return "● Timed out";
    case "CLOSED":
      return "● Disconnected";
  }
}