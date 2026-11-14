package whiteboard

import "context"

// RoomPublisher is satisfied by the gateway hub. Neither package needs to
// import the other: server wiring connects their narrow interfaces.
type RoomPublisher interface {
	PublishToRoom(ctx context.Context, guildID, roomID, op string, data any)
}

type GatewayPublisher struct{ rooms RoomPublisher }

func NewGatewayPublisher(rooms RoomPublisher) *GatewayPublisher {
	return &GatewayPublisher{rooms: rooms}
}

func (p *GatewayPublisher) PublishBoardCommit(ctx context.Context, guildID, channelID string, payload CommitPayload) {
	// Do not spawn a goroutine: Execute holds the per-board commit+publish lock.
	p.rooms.PublishToRoom(ctx, guildID, channelID, "BOARD_COMMIT", payload)
}

var _ Publisher = (*GatewayPublisher)(nil)
