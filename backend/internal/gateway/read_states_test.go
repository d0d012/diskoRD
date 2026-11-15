package gateway

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestReadStateUpdateOnlyReachesOtherConnectionsOfCaller(t *testing.T) {
	h := NewHub(nil, nil, nil)
	origin := newClient(h, nil, "me", nil)
	other := newClient(h, nil, "me", nil)
	stranger := newClient(h, nil, "stranger", nil)
	origin.readConnectionID.Store("origin")
	other.readConnectionID.Store("other")
	h.clients["me"] = map[*Client]bool{origin: true, other: true}
	h.clients["stranger"] = map[*Client]bool{stranger: true}
	h.NotifyReadState("me", "origin", map[string]interface{}{"channelId": "ch", "lastReadAt": "2026-01-01T00:00:00Z", "mentionCount": 0})
	assert.Empty(t, origin.send)
	assert.Empty(t, stranger.send)
	require.Len(t, other.send, 1)
	var event Event
	require.NoError(t, json.Unmarshal(<-other.send, &event))
	assert.Equal(t, "READ_STATE_UPDATE", event.Op)
	var data map[string]interface{}
	require.NoError(t, json.Unmarshal(event.D, &data))
	assert.Equal(t, "ch", data["channelId"])
	assert.Equal(t, float64(0), data["mentionCount"])
}
