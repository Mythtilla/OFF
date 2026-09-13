export function safeAuthError(message: string) {
  if (message.includes("Invalid login credentials"))
    return "Username or password is incorrect.";
  if (message.includes("User already registered"))
    return "This username is already taken.";
  if (message.includes("Password")) return "Choose a stronger password.";
  return "Something went wrong. Please try again.";
}