package voice

import (
	"testing"

	lkauth "github.com/livekit/protocol/auth"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/d0d012/diskord/pkg/config"
)

func TestViewerToken(t *testing.T) {
	cfg := config.LiveKitConfig{APIKey: "k", APISecret: "secretsecretsecretsecretsecret32"}

	token, err := viewerToken(cfg, "u1", "alice", "guild:g:channel:c")
	require.NoError(t, err)

	v, err := lkauth.ParseAPIToken(token)
	require.NoError(t, err)
	_, grants, err := v.Verify(cfg.APISecret)
	require.NoError(t, err)

	// A different identity, so it never replaces the user's real voice connection.
	assert.Equal(t, "u1:viewer", grants.Identity)
	assert.Equal(t, "guild:g:channel:c", grants.Video.Room)
	assert.True(t, grants.Video.Hidden, "other members must not see the viewer")
	assert.False(t, grants.Video.GetCanPublish())
	assert.False(t, grants.Video.GetCanPublishData())
	assert.True(t, grants.Video.GetCanSubscribe())
}
