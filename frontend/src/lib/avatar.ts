/** Stable color derived from the first letter, matching the rest of the app. */
export function avatarColor(name: string): string {
  return `hsl(${((name.charCodeAt(0) || 0) * 37) % 360}, 55%, 45%)`;
}

/**
 * Human label for a status. `idle` is shown as "Away" — the wire value stays
 * `idle` everywhere.
 */
export function statusLabel(status: string | undefined): string {
  switch (status) {
    case "online": return "Online";
    case "idle": return "Away";
    case "dnd": return "Do Not Disturb";
    case "invisible": return "Invisible";
    default: return "Offline";
  }
}

/** CSS color token for a status, shared by dots, pills and the picker. */
export function statusColor(status: string | undefined): string {
  switch (status) {
    case "online": return "var(--color-dc-online, #23a55a)";
    case "idle": return "var(--color-dc-idle, #f0b232)";
    case "dnd": return "var(--color-dc-dnd, #ed4245)";
    case "invisible": return "var(--color-dc-offline, #80848e)";
    default: return "var(--color-dc-offline, #80848e)";
  }
}
