import { ConnectionState, Room, RoomEvent, type RemoteParticipant } from "livekit-client";
import { api } from "./api";
import { useVoiceStore } from "../stores/voiceStore";
import { useSoundboardStore, type SoundboardSession } from "../stores/soundboardStore";
import { useSettingsStore } from "../stores/settingsStore";
import { MAX_SOUND_SECONDS, MAX_SOUND_WAV_BYTES } from "./soundboardUpload";

export const SOUNDBOARD_SOUNDS = [
  { id: "airhorn", name: "Air horn", emoji: "📣", file: "/sounds/soundboard/airhorn.wav" },
  { id: "cheer", name: "Level up", emoji: "🎉", file: "/sounds/soundboard/cheer.wav" },
  { id: "sad", name: "Sad trombone", emoji: "🎺", file: "/sounds/soundboard/sad.wav" },
  { id: "drum", name: "Ba dum tss", emoji: "🥁", file: "/sounds/soundboard/drum.wav" },
  { id: "magic", name: "Magic", emoji: "✨", file: "/sounds/soundboard/magic.wav" },
  { id: "beep", name: "Boop", emoji: "🤖", file: "/sounds/soundboard/beep.wav" },
] as const;
const TOPIC = "diskord.soundboard.v2";
const MAX_VOICES = 16;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Base64 length of the largest custom sound (see MAX_SOUND_WAV_BYTES).
const MAX_SOUND_BASE64 = Math.ceil(MAX_SOUND_WAV_BYTES / 3) * 4;
const MAX_PACKET_DELAY_MS = 5000;
interface Packet { id: string; at: number; event: string }
/** Validates shape only. Freshness is judged per sender by createFreshnessFilter. */
export function decodeSoundboardPacket(data: Uint8Array): Packet | null {
  if (data.byteLength > 256) return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(data));
    if (!p || typeof p.id !== "string" || (!SOUNDBOARD_SOUNDS.some((s) => s.id === p.id) && !UUID.test(p.id)) ||
        typeof p.event !== "string" || !UUID.test(p.event) || !Number.isFinite(p.at)) return null;
    return { id: p.id, at: p.at, event: p.event };
  } catch { return null; }
}

/**
 * Drops packets that arrived late without trusting the sender's clock: a sender
 * whose PC clock is off by minutes would otherwise be silenced in both
 * directions. The smallest observed (receivedAt - sentAt) per sender is that
 * sender's clock offset plus the fastest delivery; a packet is late when it
 * exceeds that baseline by more than MAX_PACKET_DELAY_MS. Repeated rejections
 * mean the sender's clock jumped backwards, so the baseline is reset.
 */
export function createFreshnessFilter() {
  const senders = new Map<string, { baseline: number; rejected: number }>();
  return (identity: string, sentAt: number, receivedAt = Date.now()) => {
    const delta = receivedAt - sentAt;
    const sender = senders.get(identity);
    if (!sender || delta < sender.baseline) {
      senders.set(identity, { baseline: delta, rejected: 0 });
      return true;
    }
    if (delta - sender.baseline <= MAX_PACKET_DELAY_MS) {
      sender.rejected = 0;
      return true;
    }
    if (++sender.rejected >= 3) {
      senders.set(identity, { baseline: delta, rejected: 0 });
      return true;
    }
    return false;
  };
}

/** Bursts feel instant; sustained flooding is bounded independently at each listener. */
export function createSoundLimiter() {
  let tokens = 8;
  let last = Date.now();
  return () => {
    const now = Date.now();
    tokens = Math.min(8, tokens + Math.max(0, now - last) / 100);
    last = now;
    if (tokens < 1) return false;
    tokens--;
    return true;
  };
}

/** Owned by the room, not the popover. Each trigger restarts that sender's clip. */
export function attachSoundboard(room: Room, guildId: string | null = null): () => void {
  let disposed = false;
  let context: AudioContext | null = null;
  let output: DynamicsCompressorNode | null = null;
  let generation = 0;
  let previousState = room.state;
  const localLimit = createSoundLimiter();
  const remoteLimits = new Map<string, ReturnType<typeof createSoundLimiter>>();
  const fresh = createFreshnessFilter();
  const seen = new Set<string>();
  const revisions = new Map<string, number>();
  const buffers = new Map<string, Promise<AudioBuffer>>();
  const requests = new AbortController();
  let catalogRetryAt = 0;
  let catalogRetry: Promise<void> | null = null;
  // Every trigger gets its own voice so spammed sounds stack instead of cutting each other off.
  const playing = new Map<number, { identity: string; id: string; gain: GainNode; stop: () => void }>();
  let nextVoice = 0;
  const PREVIEW = "$preview";

  function update(patch: Partial<ReturnType<typeof useSoundboardStore.getState>>) {
    if (!disposed && useSoundboardStore.getState().session === session) useSoundboardStore.setState(patch);
  }
  function allowed() {
    const { isMuted, isDeafened } = useVoiceStore.getState();
    const permissions = room.localParticipant.permissions;
    return !disposed && room.state === ConnectionState.Connected &&
      permissions?.canPublish === true && permissions.canPublishData === true && !isMuted && !isDeafened;
  }
  function stop() {
    generation++;
    playing.forEach((p) => p.stop());
    playing.clear();
  }
  function stopSender(identity: string) {
    playing.forEach((p) => { if (p.identity === identity) p.stop(); });
  }
  function volumeFor(identity: string) {
    const voice = useVoiceStore.getState();
    return voice.isDeafened ? 0 : useSoundboardStore.getState().volume *
      Math.max(0, Math.min(1, voice.remoteVolumes[identity] ?? 1));
  }
  function known(id: string) {
    return SOUNDBOARD_SOUNDS.some((s) => s.id === id) ||
      (guildId !== null && useSoundboardStore.getState().sounds.some((s) => s.id === id && s.guildId === guildId));
  }
  function load(id: string): Promise<AudioBuffer> {
    const cached = buffers.get(id);
    if (cached) return cached;
    if (!context || disposed || !known(id)) return Promise.reject(new Error("Unknown sound"));
    const ctx = context;
    const builtin = SOUNDBOARD_SOUNDS.find((s) => s.id === id);
    const bytes = builtin
      ? fetch(builtin.file, { signal: requests.signal }).then(async (response) => {
        if (!response.ok) throw new Error("Couldn't load built-in sound");
        const data = await response.arrayBuffer();
        if (data.byteLength > 250000) throw new Error("Sound is too large");
        return data;
      })
      : api.get(`/guilds/${guildId}/sounds/${id}`, { signal: requests.signal }).then(({ data }) => {
        const encoded = data.data.audio;
        if (typeof encoded !== "string" || encoded.length > MAX_SOUND_BASE64) throw new Error("Invalid sound");
        return Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)).buffer;
      });
    const promise = bytes.then(async (data) => {
      const audio = await ctx.decodeAudioData(data);
      if (audio.duration <= 0 || audio.duration > MAX_SOUND_SECONDS || !Number.isFinite(audio.duration)) throw new Error("Invalid duration");
      // Normalize once on decode, not on every rapid retrigger.
      let peak = 0;
      for (let ch = 0; ch < audio.numberOfChannels; ch++) for (const value of audio.getChannelData(ch)) peak = Math.max(peak, Math.abs(value));
      if (peak > 0.35) for (let ch = 0; ch < audio.numberOfChannels; ch++) {
        const samples = audio.getChannelData(ch);
        for (let i = 0; i < samples.length; i++) samples[i] *= 0.35 / peak;
      }
      return audio;
    }).catch((err) => { buffers.delete(id); throw err; });
    buffers.set(id, promise);
    return promise;
  }
  function render(id: string, identity: string, audio: AudioBuffer) {
    if (!context || context.state !== "running" || disposed || !known(id) || volumeFor(identity) === 0) return;
    // Bound the mix: past MAX_VOICES the oldest voice makes room for the newest.
    if (playing.size >= MAX_VOICES) playing.values().next().value?.stop();
    const gain = context.createGain();
    gain.gain.value = volumeFor(identity);
    gain.connect(output ?? context.destination);
    const source = context.createBufferSource();
    source.buffer = audio;
    source.connect(gain);
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      source.onended = null;
      source.stop();
      source.disconnect();
      gain.disconnect();
      playing.delete(voice);
    };
    const voice = nextVoice++;
    playing.set(voice, { identity, id, gain, stop: finish });
    source.onended = finish;
    source.start();
  }
  async function unlock() {
    if (disposed) return;
    try {
      if (!context) {
        context = new AudioContext();
        applyOutputDevice();
      }
      if (!output) {
        output = context.createDynamicsCompressor();
        output.threshold.value = -10;
        output.knee.value = 6;
        output.ratio.value = 20;
        output.attack.value = 0.003;
        output.release.value = 0.1;
        output.connect(context.destination);
      }
      if (context.state !== "running") await context.resume();
      if (context.state !== "running") throw new Error("Audio suspended");
    } catch { update({ error: "Audio unavailable. Click a sound to try again." }); }
  }
  async function play(id: string, preview = false) {
    if (disposed || !known(id)) return;
    if (!preview && !allowed()) { update({ error: "Connect, unmute and undeafen to play sounds." }); return; }
    if (!localLimit()) { update({ error: "A little too fast — try again in a moment." }); return; }
    update({ error: null });
    const startedIn = generation;
    const identity = preview ? PREVIEW : room.localParticipant.identity;
    const revision = revisions.get(identity) ?? 0;
    try {
      await unlock();
      const audio = await load(id);
      if (disposed || startedIn !== generation || (revisions.get(identity) ?? 0) !== revision || context?.state !== "running" || (!preview && !allowed())) return;
      render(id, identity, audio); // Local feedback never waits for the network.
      if (!preview) await room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({ id, at: Date.now(), event: crypto.randomUUID() })),
        { reliable: true, topic: TOPIC });
    } catch { update({ error: "Couldn't play or send that sound. Try again." }); }
  }
  const session: SoundboardSession = { play, stop };
  let previouslyAllowed = allowed();
  useSoundboardStore.setState({ session, guildId, sounds: [], loading: false, catalogError: null, available: previouslyAllowed, error: null });

  async function receive(data: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) {
    if (disposed || topic !== TOPIC || !participant || room.state !== ConnectionState.Connected ||
        room.remoteParticipants.get(participant.identity) !== participant ||
        participant.permissions?.canPublish !== true || participant.permissions.canPublishData !== true) return;
    const packet = decodeSoundboardPacket(data);
    if (!packet || seen.has(packet.event) || !fresh(participant.identity, packet.at)) return;
    if (!remoteLimits.has(participant.identity)) remoteLimits.set(participant.identity, createSoundLimiter());
    if (!remoteLimits.get(participant.identity)!()) return;
    seen.add(packet.event);
    if (seen.size > 1024) seen.delete(seen.values().next().value!);
    if (!context || context.state !== "running") { update({ error: "Click Soundboard to enable sound playback." }); return; }
    if (volumeFor(participant.identity) === 0) return;
    const identity = participant.identity;
    const revision = revisions.get(identity) ?? 0;
    const startedIn = generation;
    const receivedAt = Date.now();
    try {
      // The upload event and the first trigger can arrive in either order. Refresh
      // metadata, never fetch arbitrary IDs/URLs from a data packet. Bound retries.
      if (!known(packet.id) && guildId && UUID.test(packet.id)) {
        if (!catalogRetry && Date.now() >= catalogRetryAt) {
          catalogRetryAt = Date.now() + 2000;
          catalogRetry = useSoundboardStore.getState().refresh().finally(() => { catalogRetry = null; });
        }
        if (catalogRetry) await catalogRetry;
      }
      if (!known(packet.id) || disposed || generation !== startedIn) return;
      const audio = await load(packet.id);
      if (disposed || generation !== startedIn || (revisions.get(identity) ?? 0) !== revision || Date.now() - receivedAt > 2000 ||
          room.state !== ConnectionState.Connected || room.remoteParticipants.get(identity) !== participant ||
          !participant.permissions?.canPublish || !participant.permissions.canPublishData) return;
      render(packet.id, identity, audio);
    } catch { update({ error: "Couldn't load a server sound. Reopen the board to retry." }); }
  }
  function sync() {
    if (previousState !== room.state) {
      previousState = room.state;
      stop();
      if (room.state === ConnectionState.Connected) void useSoundboardStore.getState().refresh();
    }
    const available = allowed();
    if (previouslyAllowed && !available) { generation++; stopSender(room.localParticipant.identity); }
    previouslyAllowed = available;
    update({ available });
    if (useVoiceStore.getState().isDeafened) stop();
    playing.forEach((p) => {
      const remote = room.remoteParticipants.get(p.identity);
      if (remote && (!remote.permissions?.canPublish || !remote.permissions.canPublishData)) p.stop();
      else p.gain.gain.value = volumeFor(p.identity);
    });
  }
  function left(p: RemoteParticipant) {
    stopSender(p.identity);
    revisions.set(p.identity, (revisions.get(p.identity) ?? 0) + 1);
    remoteLimits.delete(p.identity);
  }
  async function prewarm() {
    const sounds = [...SOUNDBOARD_SOUNDS, ...useSoundboardStore.getState().sounds];
    // Keep network/decode work bounded even on a full 48-sound server.
    await Promise.all(Array.from({ length: 3 }, async () => {
      while (!disposed && sounds.length) {
        const sound = sounds.shift()!;
        await load(sound.id).catch(() => {});
      }
    }));
  }
  /** Plays sounds on the speaker chosen in settings (Chromium/WebView2; WebKit has no setSinkId). */
  function applyOutputDevice() {
    const ctx = context as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null;
    ctx?.setSinkId?.(useSettingsStore.getState().outputDeviceId).catch(() => {});
  }
  const unsubscribeVoice = useVoiceStore.subscribe(sync);
  const unsubscribeSettings = useSettingsStore.subscribe((state, prev) => {
    if (state.outputDeviceId !== prev.outputDeviceId) applyOutputDevice();
  });
  const unsubscribeSoundboard = useSoundboardStore.subscribe((state, prev) => {
    if (state.volume !== prev.volume) sync();
    if (state.session === session && state.sounds !== prev.sounds) {
      buffers.forEach((_, id) => { if (!known(id)) buffers.delete(id); });
      playing.forEach((p) => { if (!known(p.id)) p.stop(); });
      void prewarm();
    }
  });
  room.on(RoomEvent.DataReceived, receive);
  room.on(RoomEvent.ConnectionStateChanged, sync);
  room.on(RoomEvent.ParticipantPermissionsChanged, sync);
  room.on(RoomEvent.ParticipantDisconnected, left);
  document.addEventListener("pointerdown", unlock);
  document.addEventListener("keydown", unlock);
  void unlock();
  void prewarm();
  void useSoundboardStore.getState().refresh();

  return () => {
    if (disposed) return;
    disposed = true;
    requests.abort();
    stop();
    buffers.clear();
    output?.disconnect();
    void context?.close().catch(() => {});
    unsubscribeVoice();
    unsubscribeSettings();
    unsubscribeSoundboard();
    room.off(RoomEvent.DataReceived, receive);
    room.off(RoomEvent.ConnectionStateChanged, sync);
    room.off(RoomEvent.ParticipantPermissionsChanged, sync);
    room.off(RoomEvent.ParticipantDisconnected, left);
    document.removeEventListener("pointerdown", unlock);
    document.removeEventListener("keydown", unlock);
    if (useSoundboardStore.getState().session === session) {
      useSoundboardStore.setState({ session: null, guildId: null, sounds: [], loading: false, catalogError: null, available: false, error: null });
    }
  };
}
