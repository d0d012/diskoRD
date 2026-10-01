package gateway

import (
	"sync"
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
	hub     *Hub
	conn    *fiberws.Conn
	send    chan []byte
	userID  string
	guildMu sync.RWMutex
	guilds  map[string]bool // guildID → member
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
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
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
