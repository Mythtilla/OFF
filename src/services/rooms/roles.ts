export type MembershipRole = "owner" | "moderator" | "member";
export function canChangeRole(
  actor: MembershipRole,
  target: MembershipRole,
  next: MembershipRole,
) {
  return actor === "owner" && target !== "owner" && next !== "owner";
}
export function canLeave(role: MembershipRole) {
  return role === "member";
}
export function validMessageTarget(
  roomId: string | null,
  threadId: string | null,
) {
  return Boolean(roomId) !== Boolean(threadId);
}
