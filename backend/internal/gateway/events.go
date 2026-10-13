package gateway

import "encoding/json"

const (
	OpHello             = "HELLO"
	OpHeartbeat         = "HEARTBEAT"
	OpHeartbeatAck      = "HEARTBEAT_ACK"
	OpMessageCreate     = "MESSAGE_CREATE"
	OpMessageUpdate     = "MESSAGE_UPDATE"
	OpMessageDelete     = "MESSAGE_DELETE"
	OpTypingStart       = "TYPING_START"
	OpChannelCreate     = "CHANNEL_CREATE"
	OpChannelUpdate     = "CHANNEL_UPDATE"
	OpChannelDelete     = "CHANNEL_DELETE"
	OpGuildUpdate       = "GUILD_UPDATE"
	OpGuildDelete       = "GUILD_DELETE"
	OpGuildMemberAdd    = "GUILD_MEMBER_ADD"
	OpGuildMemberUpdate = "GUILD_MEMBER_UPDATE"
	OpGuildMemberRemove = "GUILD_MEMBER_REMOVE"
	OpPresenceUpdate    = "PRESENCE_UPDATE"
	OpUserUpdate        = "USER_UPDATE"
	OpVoiceStateUpdate  = "VOICE_STATE_UPDATE"
	OpReactionAdd       = "REACTION_ADD"
	OpReactionRemove    = "REACTION_REMOVE"
	OpRoleCreate        = "ROLE_CREATE"
	OpRoleUpdate        = "ROLE_UPDATE"
	OpRoleDelete        = "ROLE_DELETE"
	OpRoleReorder       = "ROLE_REORDER"
	OpMemberRoleAdd     = "MEMBER_ROLE_ADD"
	OpMemberRoleRemove  = "MEMBER_ROLE_REMOVE"

	// DM call signaling
	OpCallInvite  = "CALL_INVITE"
	OpCallAccept  = "CALL_ACCEPT"
	OpCallDecline = "CALL_DECLINE"
	OpCallEnd     = "CALL_END"
	OpCallTimeout = "CALL_TIMEOUT"
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
