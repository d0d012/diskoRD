import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionState, RoomEvent, type Room, type RemoteParticipant } from "livekit-client";
import { attachSoundboard, createSoundLimiter, decodeSoundboardPacket, SOUNDBOARD_SOUNDS } from "./soundboard";
import { useSoundboardStore } from "../stores/soundboardStore";
import { useVoiceStore } from "../stores/voiceStore";
import { api } from "./api";
vi.mock("./api", () => ({ api: { get: vi.fn() } }));

function gainNode() { return { gain: { value: 0 }, connect: vi.fn().mockReturnThis(), disconnect: vi.fn() }; }
function bufferSource() {
  return { buffer: null as unknown, onended: null as (() => void) | null,
    start: vi.fn(), stop: vi.fn(), connect: vi.fn().mockReturnThis(), disconnect: vi.fn() };
}
class FakeAudioContext {
  state = "running";
  destination = {};
  resume = vi.fn(async () => {});
  close = vi.fn(async () => {});
  decodeAudioData = vi.fn(async () => ({ duration: 1, numberOfChannels: 1, getChannelData: () => new Float32Array([0.1]) }));
  gains: ReturnType<typeof gainNode>[] = [];
  sources: ReturnType<typeof bufferSource>[] = [];
  createDynamicsCompressor() {
    return { threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 0 }, attack: { value: 0 }, release: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() };
  }
  createGain() { const node = gainNode(); this.gains.push(node); return node; }
  createBufferSource() { const node = bufferSource(); this.sources.push(node); return node; }
}
function makeRoom() {
  const listeners = new Map<string, Set<(...args: unknown[]) => unknown>>();
  return {
    state: ConnectionState.Connected,
    localParticipant: { identity: "me", permissions: { canPublish: true, canPublishData: true }, publishData: vi.fn(async () => {}) },
    remoteParticipants: new Map<string, RemoteParticipant>(),
    on: vi.fn((event: string, fn: (...args: unknown[]) => unknown) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn);
    }),
    off: vi.fn((event: string, fn: (...args: unknown[]) => unknown) => listeners.get(event)?.delete(fn)),
    emit: async (event: string, ...args: unknown[]) => Promise.all([...listeners.get(event) ?? []].map((fn) => fn(...args))),
  };
}
const packet = (id = "beep", at = Date.now()) => new TextEncoder().encode(JSON.stringify({ id, at, event: crypto.randomUUID() }));
let room: ReturnType<typeof makeRoom>;
let context: FakeAudioContext;
let cleanup: () => void;
async function receive(identity = "other", data = packet()) {
  let participant = room.remoteParticipants.get(identity);
  if (!participant) {
    participant = { identity, permissions: { canPublish: true, canPublishData: true } } as RemoteParticipant;
    room.remoteParticipants.set(identity, participant);
  }
  await room.emit(RoomEvent.DataReceived, data, participant, undefined, "diskord.soundboard.v2");
}
beforeEach(async () => {
  vi.useFakeTimers(); vi.clearAllMocks();
  context = new FakeAudioContext();
  vi.stubGlobal("AudioContext", vi.fn(function () { return context; }));
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(44) })));
  useVoiceStore.setState({ isMuted: false, isDeafened: false, remoteVolumes: {} });
  useSoundboardStore.setState({ volume: 0.5 });
  room = makeRoom(); cleanup = attachSoundboard(room as unknown as Room);
  await vi.waitFor(() => expect(context.decodeAudioData).toHaveBeenCalledTimes(6));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("soundboard room session", () => {
  it("validates bounded packets, rejecting stale, invalid IDs and missing event IDs", () => {
    expect(decodeSoundboardPacket(packet())?.id).toBe("beep");
    expect(decodeSoundboardPacket(packet("https://evil.test/a.wav"))).toBeNull();
    expect(decodeSoundboardPacket(packet("beep", Date.now() - 6000))).toBeNull();
    expect(decodeSoundboardPacket(packet("beep", Date.now() + 6000))).toBeNull();
    expect(decodeSoundboardPacket(new Uint8Array(257))).toBeNull();
    expect(decodeSoundboardPacket(new TextEncoder().encode("null"))).toBeNull();
  });
  it("preloads local recordings and stacks rapid retriggers without waiting for clips or the network", async () => {
    for (const sound of SOUNDBOARD_SOUNDS) expect(fetch).toHaveBeenCalledWith(sound.file, { signal: expect.anything() });
    let finish!: () => void;
    room.localParticipant.publishData.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const session = useSoundboardStore.getState().session!;
    const first = session.play("beep");
    await vi.waitFor(() => expect(finish).toBeDefined());
    expect(context.sources).toHaveLength(1);
    await session.play("beep"); await session.play("beep");
    expect(context.sources).toHaveLength(3);
    for (const source of context.sources) expect(source.disconnect).not.toHaveBeenCalled(); // Overlapping, not cut off.
    expect(context.decodeAudioData).toHaveBeenCalledTimes(6); // No decode or download per retrigger.
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(room.localParticipant.publishData).toHaveBeenCalledTimes(3);
    expect(room.localParticipant.publishData).toHaveBeenCalledWith(expect.anything(), { reliable: true, topic: "diskord.soundboard.v2" });
    finish(); await first;
  });
  it("previews without publishing while muted", async () => {
    useVoiceStore.setState({ isMuted: true });
    await useSoundboardStore.getState().session!.play("beep", true);
    expect(room.localParticipant.publishData).not.toHaveBeenCalled();
    expect(context.sources).toHaveLength(1);
  });
  it("blocks broadcasts while muted, deafened, reconnecting or denied publishing", async () => {
    const session = useSoundboardStore.getState().session!;
    useVoiceStore.setState({ isMuted: true }); await session.play("beep");
    useVoiceStore.setState({ isMuted: false, isDeafened: true }); await session.play("beep");
    useVoiceStore.setState({ isDeafened: false });
    room.state = ConnectionState.Reconnecting; await room.emit(RoomEvent.ConnectionStateChanged); await session.play("beep");
    room.state = ConnectionState.Connected; room.localParticipant.permissions.canPublishData = false;
    await room.emit(RoomEvent.ParticipantPermissionsChanged); await session.play("beep");
    expect(useSoundboardStore.getState().available).toBe(false);
    expect(room.localParticipant.publishData).not.toHaveBeenCalled();
  });
  it("allows bursts but rate-limits sustained floods, refilling automatically", () => {
    const allow = createSoundLimiter();
    for (let i = 0; i < 8; i++) expect(allow()).toBe(true);
    expect(allow()).toBe(false); vi.advanceTimersByTime(100);
    expect(allow()).toBe(true); expect(allow()).toBe(false);
  });
  it("deduplicates retransmissions but plays distinct triggers in the same millisecond", async () => {
    const data = packet(); await receive("a", data); await receive("a", data);
    await receive("a"); await receive("a");
    expect(context.sources).toHaveLength(3);
    for (const source of context.sources) expect(source.disconnect).not.toHaveBeenCalled();
  });
  it("bounds overlap and favors new triggers instead of queuing them", async () => {
    for (let i = 0; i < 17; i++) await receive(`user${i}`);
    expect(context.sources).toHaveLength(17);
    expect(context.sources[0].disconnect).toHaveBeenCalled();
    expect(context.sources[1].disconnect).not.toHaveBeenCalled();
    expect(context.sources[16].disconnect).not.toHaveBeenCalled();
  });
  it("applies listener and participant volume live; deafen stops and drops playback", async () => {
    useVoiceStore.setState({ remoteVolumes: { other: 0.4 } }); await receive();
    expect(context.gains[0].gain.value).toBeCloseTo(0.2);
    useSoundboardStore.getState().setVolume(0.2);
    expect(context.gains[0].gain.value).toBeCloseTo(0.08);
    useVoiceStore.setState({ isDeafened: true });
    expect(context.sources[0].disconnect).toHaveBeenCalled();
    await receive("another"); expect(context.sources).toHaveLength(1);
  });
  it("ignores unauthenticated, wrong-topic and denied events", async () => {
    await room.emit(RoomEvent.DataReceived, packet(), undefined, undefined, "diskord.soundboard.v2");
    const denied = { identity: "denied", permissions: { canPublish: false, canPublishData: true } } as RemoteParticipant;
    room.remoteParticipants.set("denied", denied); await receive("denied");
    await room.emit(RoomEvent.DataReceived, packet(), denied, undefined, "other");
    expect(context.sources).toHaveLength(0);
  });
  it("reports failed sends without locking subsequent triggers", async () => {
    room.localParticipant.publishData.mockRejectedValueOnce(new Error("offline"));
    await useSoundboardStore.getState().session!.play("beep");
    expect(useSoundboardStore.getState().error).toContain("Couldn't play or send");
    await useSoundboardStore.getState().session!.play("beep");
    expect(room.localParticipant.publishData).toHaveBeenCalledTimes(2);
  });
  it("stops and removes listeners on disposal, with no stale actions", async () => {
    const session = useSoundboardStore.getState().session!;
    await session.play("beep"); cleanup(); await receive(); await session.play("beep");
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0].disconnect).toHaveBeenCalled();
    expect(context.close).toHaveBeenCalled();
    expect(useSoundboardStore.getState().session).toBeNull();
    expect(room.off).toHaveBeenCalledTimes(4);
  });
  it("stops on reconnect and participant departure", async () => {
    await receive(); await room.emit(RoomEvent.ParticipantDisconnected, room.remoteParticipants.get("other"));
    expect(context.sources[0].disconnect).toHaveBeenCalled();
    await receive("second"); room.state = ConnectionState.Reconnecting; await room.emit(RoomEvent.ConnectionStateChanged);
    expect(context.sources[1].disconnect).toHaveBeenCalled();
    await receive("third"); room.state = ConnectionState.Connected; await room.emit(RoomEvent.ConnectionStateChanged);
    expect(context.sources).toHaveLength(2);
  });
  it("loads only current-guild catalog entries and reuses decoded custom audio", async () => {
    cleanup(); context.decodeAudioData.mockClear();
    const sound = { id: crypto.randomUUID(), guildId: "guild", name: "Quack", creatorId: "me", canDelete: true, createdAt: "", updatedAt: "" };
    vi.mocked(api.get).mockImplementation(async (url) => ({ data: { data: url.endsWith("/sounds") ? [sound] : { audio: "AA==" } } }));
    cleanup = attachSoundboard(room as unknown as Room, "guild");
    await vi.waitFor(() => expect(context.decodeAudioData).toHaveBeenCalledTimes(7));
    const session = useSoundboardStore.getState().session!;
    await session.play(sound.id); await session.play(sound.id);
    expect(context.sources).toHaveLength(2);
    expect(context.sources[0].disconnect).not.toHaveBeenCalled();
    expect(context.decodeAudioData).toHaveBeenCalledTimes(7);
    await session.play(crypto.randomUUID());
    expect(context.sources).toHaveLength(2);
    expect(api.get).toHaveBeenCalledTimes(2);
  });
  it("never plays a pending download after local Stop", async () => {
    cleanup();
    let complete!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation(() => new Promise<Response>((resolve) => { complete = resolve; }));
    cleanup = attachSoundboard(room as unknown as Room);
    const pending = receive("other", packet("sad"));
    useSoundboardStore.getState().session!.stop();
    complete({ ok: true, arrayBuffer: async () => new ArrayBuffer(44) } as Response);
    await pending;
    expect(context.sources).toHaveLength(0);
  });
});
