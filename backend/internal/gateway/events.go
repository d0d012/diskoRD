package gateway

import "encoding/json"

const (
	OpHello           = "HELLO"
	OpHeartbeat       = "HEARTBEAT"
	OpHeartbeatAck    = "HEARTBEAT_ACK"
	OpMessageCreate   = "MESSAGE_CREATE"
	OpMessageUpdate   = "MESSAGE_UPDATE"
	OpMessageDelete   = "MESSAGE_DELETE"
	OpTypingStart     = "TYPING_START"
	OpGuildMemberAdd  = "GUILD_MEMBER_ADD"
	OpGuildMemberRemove = "GUILD_MEMBER_REMOVE"
	OpPresenceUpdate  = "PRESENCE_UPDATE"
	OpVoiceStateUpdate = "VOICE_STATE_UPDATE"
)

// Event is what clients send and receive over WebSocket.
type Event struct {
	Op string          `json:"op"`
	D  json.RawMessage `json:"d,omitempty"`
	S  int64           `json:"s"`
}

// routableEvent is used internally on Redis pub/sub to carry routing metadata.
type routableEvent struct {
	Op      string          `json:"op"`
	D       json.RawMessage `json:"d,omitempty"`
	S       int64           `json:"s"`
	GuildID string          `json:"guildId"`
}

func newEvent(op string, seq int64, data interface{}) ([]byte, error) {
	raw, err := json.Marshal(data)
	if err != nil {
		return nil, err
	}
	return json.Marshal(Event{Op: op, D: raw, S: seq})
}
