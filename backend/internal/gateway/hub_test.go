package gateway

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestPreferredMapRoundTrip(t *testing.T) {
	h := NewHub(nil, nil, nil)

	assert.Equal(t, "online", h.getPreferred("u1"), "unknown users default to online")

	h.setPreferred("u1", "dnd")
	assert.Equal(t, "dnd", h.getPreferred("u1"))

	h.clearPreferred("u1")
	assert.Equal(t, "online", h.getPreferred("u1"))
}

func TestTouchIsNonBlockingWhenFull(t *testing.T) {
	h := NewHub(nil, nil, nil)

	// Enqueue well past capacity; touch must drop instead of blocking a read loop.
	for i := 0; i < cap(h.touchCh)+32; i++ {
		h.touch("u1")
	}

	assert.Len(t, h.touchCh, cap(h.touchCh))
}
