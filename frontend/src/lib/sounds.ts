export type SoundName =
  | "notification"
  | "mention"
  | "join"
  | "leave"
  | "disconnect"
  | "mute"
  | "unmute";

const SOUND_FILES: Record<SoundName, string> = {
  notification: "/sounds/discord-notification.mp3",
  mention:      "/sounds/discord-notification.mp3", // reuse notification for mentions
  join:         "/sounds/discord-join.mp3",
  leave:        "/sounds/discord_leave.mp3",
  disconnect:   "/sounds/discord_disconnect.mp3",
  mute:         "/sounds/discord_mute.mp3",
  unmute:       "/sounds/discord-unmute.mp3",
};

const cache: Partial<Record<SoundName, HTMLAudioElement>> = {};

export function playSound(name: SoundName, volume = 1.0): void {
  try {
    let audio = cache[name];
    if (!audio) {
      audio = new Audio(SOUND_FILES[name]);
      cache[name] = audio;
    }
    audio.currentTime = 0;
    audio.volume = Math.min(1, Math.max(0, volume));
    audio.play().catch(() => { /* autoplay policy — ignored */ });
  } catch {
    // Missing file or browser restriction — silent fail
  }
}
