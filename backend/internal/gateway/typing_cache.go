package gateway

import (
	"context"
	"sync"
	"time"
)

const (
	typingCacheTTL = 60 * time.Second
	typingCacheMax = 10000
)

type typingChannel struct {
	guildID, kind, userA, userB string
	dm                          bool
	expires                     time.Time
}

// Invalidations also fence in-flight database lookups, without retaining tombstones.
type typingCache struct {
	mu         sync.Mutex
	entries    map[string]typingChannel
	generation uint64
}

func (c *typingCache) get(id string, dm bool, now time.Time) (typingChannel, bool, uint64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.entries[id]
	if ok && !now.Before(entry.expires) {
		delete(c.entries, id)
		ok = false
	}
	return entry, ok && entry.dm == dm, c.generation
}

func (c *typingCache) put(id string, entry typingChannel, generation uint64, now time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if generation != c.generation {
		return
	}
	if c.entries == nil {
		c.entries = make(map[string]typingChannel)
	}
	if len(c.entries) >= typingCacheMax {
		// Evict one arbitrary entry: no recency bookkeeping on this hot path.
		for key := range c.entries {
			delete(c.entries, key)
			break
		}
	}
	entry.expires = now.Add(typingCacheTTL)
	c.entries[id] = entry
}

func (c *typingCache) invalidate(id string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.entries, id)
	c.generation++
}

func (h *Hub) typingChannel(id string, dm bool) (typingChannel, bool) {
	entry, ok, generation := h.typingChannels.get(id, dm, time.Now())
	if ok {
		return entry, true
	}
	entry = typingChannel{dm: dm}
	var err error
	if dm {
		err = h.db.QueryRow(context.Background(),
			`SELECT user_a_id, user_b_id FROM dm_channels WHERE id = $1`, id,
		).Scan(&entry.userA, &entry.userB)
	} else {
		err = h.db.QueryRow(context.Background(),
			`SELECT guild_id, type FROM channels WHERE id = $1`, id,
		).Scan(&entry.guildID, &entry.kind)
	}
	if err != nil {
		return typingChannel{}, false
	}
	h.typingChannels.put(id, entry, generation, time.Now())
	return entry, true
}
