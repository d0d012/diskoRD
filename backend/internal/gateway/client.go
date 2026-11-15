package gateway

import (
	"sync"
	"sync/atomic"
	"time"

	fiberws "github.com/gofiber/websocket/v2"
	"github.com/rs/zerolog/log"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = 30 * time.Second
	maxMessageSize = 4096
)

// Client represents a single WebSocket connection.
type Client struct {
	hub        *Hub
	conn       *fiberws.Conn
	send       chan []byte
	userID     string
	username   atomic.Value // string, refreshed by USER_UPDATE
	lastTouch  atomic.Int64 // Unix nanoseconds of last successful Redis touch
	registered chan struct{}
	guildMu    sync.RWMutex
	guilds     map[string]bool // guildID → member

	roomMu         sync.Mutex
	rooms          map[string]bool
	boardQueue     []boardMessage
	boardBytes     int
	boardWake      chan struct{}
	boardOverflow  bool
	boardClosed    bool // guarded by hub.mu
	boardPresence  map[presenceKey]*pendingPresence
	presenceBucket presenceBucket // guarded by roomMu
}

func (c *Client) Username() string {
	username, _ := c.username.Load().(string)
	return username
}

func (c *Client) HasGuild(guildID string) bool {
	c.guildMu.RLock()
	defer c.guildMu.RUnlock()
	return c.guilds[guildID]
}

func (c *Client) AddGuild(guildID string) {
	c.guildMu.Lock()
	defer c.guildMu.Unlock()
	c.guilds[guildID] = true
}

func (c *Client) RemoveGuild(guildID string) {
	c.guildMu.Lock()
	defer c.guildMu.Unlock()
	delete(c.guilds, guildID)
}

func (c *Client) GuildIDs() []string {
	c.guildMu.RLock()
	defer c.guildMu.RUnlock()
	ids := make([]string, 0, len(c.guilds))
	for guildID := range c.guilds {
		ids = append(ids, guildID)
	}
	return ids
}

// ReadPump pumps messages from the WebSocket to the hub.
// Runs in its own goroutine per client.
func (c *Client) ReadPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()

	c.conn.SetReadLimit(maxMessageSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		// Protocol-level pongs are not throttled by background tabs, unlike JS timers.
		c.hub.touch(c)
		return nil
	})

	for {
		_, msg, err := c.conn.ReadMessage()
		if err != nil {
			if fiberws.IsUnexpectedCloseError(err, fiberws.CloseGoingAway, fiberws.CloseNormalClosure) {
				log.Debug().Err(err).Str("userID", c.userID).Msg("gateway: unexpected close")
			}
			break
		}
		c.hub.handleClientMessage(c, msg)
	}
}

// WritePump pumps messages from the send channel to the WebSocket.
// Runs in its own goroutine per client.
func (c *Client) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	presenceTicker := time.NewTicker(50 * time.Millisecond)
	defer func() {
		ticker.Stop()
		presenceTicker.Stop()
		c.conn.Close()
	}()

	// HELLO and READY (queued before ReadPump starts) must precede any board
	// subscription response. Only prioritise the initial batch, so sustained
	// guild traffic cannot starve the reliable board FIFO afterwards.
	initial := len(c.send)
	for i := 0; i < initial; i++ {
		msg, ok := <-c.send
		if !ok || c.writeFrame(msg) != nil {
			return
		}
	}
	for {
		select {
		case <-c.boardWake:
			msg, overflow := c.nextBoard()
			if overflow {
				log.Warn().Str("userID", c.userID).Msg("gateway: board backlog exhausted; closing for resync")
				return
			}
			if msg != nil && c.writeFrame(msg) != nil {
				return
			}

		case <-presenceTicker.C:
			// Dequeue just before each write, not a batch which could go stale
			// while a slow socket is blocked. Bound work so pings stay timely.
			for i := 0; i < 32; i++ {
				msg := c.nextBoardPresence(time.Now())
				if msg == nil {
					break
				}
				if c.writeFrame(msg) != nil {
					return
				}
			}

		case msg, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				c.conn.WriteMessage(fiberws.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(fiberws.TextMessage, msg); err != nil {
				return
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(fiberws.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
