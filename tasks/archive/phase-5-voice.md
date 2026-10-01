# Phase 5 — Voice & Video (LiveKit)

> Prerequisite: Phase 4 complete (presence and friends working)

## Dependency Graph

```
5.1 (LiveKit infra) ──→ 5.2 (voice token endpoint) ──→ 5.3 (voice frontend)
```

**Can run in parallel:**
- 5.1 + 5.2 partially (5.2 can be coded while 5.1 sets up infra — just needs LiveKit running for testing)

**Must be sequential:**
- 5.2 → 5.3 (frontend needs the token endpoint)

---

## Task 5.1: LiveKit Infrastructure

**Run first** | Writes to: `infra/`

**Goal:** LiveKit running in local Docker Compose. Coturn is defined in production Docker Compose.

**Steps:**
1. Add `livekit-server` to `infra/docker-compose.yml`
2. Create `infra/livekit/livekit.yaml` config
3. Add LiveKit API key/secret to `.env.example`
4. For production, define coturn in `infra/docker-compose.prod.yml`

**Acceptance criteria:**
- LiveKit server accessible at configured port
- Production coturn service is defined in `infra/docker-compose.prod.yml`

---

## Task 5.2: Voice Token Endpoint

**Depends on: 5.1** | Writes to: `backend/internal/voice/`

**Files:** `internal/voice/` — models.go, service.go, handler.go, routes.go

**Endpoint:**
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /channels/:id/voice/token | Yes | Generate LiveKit JWT for voice channel |

**Implementation:**
- Verify channel is type `voice` and user is guild member
- Generate LiveKit JWT with room name `guild:{guildId}:channel:{channelId}`
- Track voice state in Redis: `voice_state:{channelId}` → SET of userIDs
- Broadcast `VOICE_STATE_UPDATE` via gateway when user joins/leaves

**Acceptance criteria:**
- Token generation works for voice channels only
- Voice state tracked correctly in Redis
- Gateway broadcasts join/leave events

---

## Task 5.3: Voice Frontend

**Depends on: 5.2** | Writes to: `frontend/src/`

**Components:**
- `features/voice/VoicePanel.tsx` — voice channel participant list + controls
- `features/voice/VoiceControls.tsx` — mute, deafen, disconnect buttons
- `hooks/useVoice.ts` — LiveKit room connection management

**Dependencies:** `livekit-client`

**Acceptance criteria:**
- Can join a voice channel and hear other participants
- Mute/deafen controls work
- Participant list shows who's in the channel
- Speaking indicator shows active speakers
