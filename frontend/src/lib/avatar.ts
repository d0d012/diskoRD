/** Stable color derived from the first letter, matching the rest of the app. */
export function avatarColor(name: string): string {
  return `hsl(${((name.charCodeAt(0) || 0) * 37) % 360}, 55%, 45%)`;
}

export function statusLabel(status: string | undefined): string {
  switch (status) {
    case "online": return "Online";
    case "idle": return "Idle";
    case "dnd": return "Do Not Disturb";
    default: return "Offline";
  }
}
