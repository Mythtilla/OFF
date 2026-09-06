export type RoomKind = "world" | "country" | "interest" | "custom";
export type Room = {
  id: string;
  slug: string;
  name: string;
  topic: string | null;
  kind: RoomKind;
  is_private: boolean;
  is_member?: boolean;
};
export type Profile = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
};
export type Message = {
  id: string;
  room_id: string | null;
  thread_id: string | null;
  sender_id: string;
  body: string;
  client_event_id: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  profile?: Profile | null;
};
