package gateway

import (
	"time"

	fiberws "github.com/gofiber/websocket/v2"
)

// Reliable board traffic has its own FIFO, never competing with lossy presence
// or the legacy send buffer. A wedged socket is disconnected, not silently
// allowed to miss commits. Reconnect + snapshot is the recovery boundary.
const maxBoardBacklogBytes = 32 * 1024 * 1024

type boardMessage struct {
	roomID, guildID string
	payload         []byte
}

func newClient(hub *Hub, conn *fiberws.Conn, userID string, guilds map[string]bool) *Client {
	return &Client{
		hub: hub, conn: conn, userID: userID, guilds: guilds, registered: make(chan struct{}),
		send: make(chan []byte, 256), rooms: make(map[string]bool),
		boardWake: make(chan struct{}, 1), boardPresence: make(map[presenceKey]*pendingPresence),
	}
}

func (c *Client) HasRoom(roomID string) bool {
	c.roomMu.Lock()
	defer c.roomMu.Unlock()
	return c.rooms[roomID]
}

func (c *Client) AddRoom(roomID string) {
	c.roomMu.Lock()
	defer c.roomMu.Unlock()
	c.rooms[roomID] = true
}

func (c *Client) RoomIDs() []string {
	c.roomMu.Lock()
	defer c.roomMu.Unlock()
	ids := make([]string, 0, len(c.rooms))
	for id := range c.rooms {
		ids = append(ids, id)
	}
	return ids
}

func (c *Client) RemoveRoom(roomID string) {
	c.roomMu.Lock()
	defer c.roomMu.Unlock()
	delete(c.rooms, roomID)
	kept := c.boardQueue[:0]
	for _, msg := range c.boardQueue {
		if msg.roomID == roomID {
			c.boardBytes -= len(msg.payload)
		} else {
			kept = append(kept, msg)
		}
	}
	clear(c.boardQueue[len(kept):])
	c.boardQueue = kept
	for key := range c.boardPresence {
		if key.roomID == roomID {
			delete(c.boardPresence, key)
		}
	}
}

func (c *Client) wakeBoardLocked() {
	select {
	case c.boardWake <- struct{}{}:
	default:
	}
}

func (c *Client) enqueueBoard(roomID, guildID string, payload []byte) {
	c.roomMu.Lock()
	defer c.roomMu.Unlock()
	if !c.rooms[roomID] || c.boardOverflow {
		return
	}
	if c.boardBytes+len(payload) > maxBoardBacklogBytes {
		c.boardOverflow = true
		c.wakeBoardLocked()
		return
	}
	c.boardQueue = append(c.boardQueue, boardMessage{roomID, guildID, payload})
	c.boardBytes += len(payload)
	c.wakeBoardLocked()
}

func (c *Client) nextBoard() ([]byte, bool) {
	c.roomMu.Lock()
	defer c.roomMu.Unlock()
	if c.boardOverflow {
		return nil, true
	}
	for len(c.boardQueue) > 0 {
		msg := c.boardQueue[0]
		c.boardQueue[0] = boardMessage{}
		c.boardQueue = c.boardQueue[1:]
		c.boardBytes -= len(msg.payload)
		if len(c.boardQueue) > 0 {
			c.wakeBoardLocked()
		}
		if c.rooms[msg.roomID] && c.HasGuild(msg.guildID) {
			return msg.payload, false
		}
	}
	return nil, false
}

func (c *Client) writeFrame(msg []byte) error {
	c.conn.SetWriteDeadline(time.Now().Add(writeWait))
	return c.conn.WriteMessage(fiberws.TextMessage, msg)
}
