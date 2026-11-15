package storage

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSweepBoardAssetsGraceAndExistingKeys(t *testing.T) {
	dir := t.TempDir()
	s := NewService(dir, "")
	board := "11111111-1111-4111-8111-111111111111"
	prefix := "board-assets/" + board + "/"
	old := time.Now().Add(-25 * time.Hour)
	for _, name := range []string{"old.png", "live.png", "new.png"} {
		path := filepath.Join(dir, filepath.FromSlash(prefix+name))
		require.NoError(t, os.MkdirAll(filepath.Dir(path), 0755))
		require.NoError(t, os.WriteFile(path, []byte("image"), 0600))
		if name != "new.png" {
			require.NoError(t, os.Chtimes(path, old, old))
		}
	}
	n, err := s.SweepBoardAssets(context.Background(), func(_ context.Context, keys []string) ([]string, error) {
		assert.ElementsMatch(t, []string{prefix + "old.png", prefix + "live.png"}, keys)
		return []string{prefix + "live.png"}, nil
	})
	require.NoError(t, err)
	assert.Equal(t, 1, n)
	assert.NoFileExists(t, filepath.Join(dir, filepath.FromSlash(prefix+"old.png")))
	assert.FileExists(t, filepath.Join(dir, filepath.FromSlash(prefix+"live.png")))
	assert.FileExists(t, filepath.Join(dir, filepath.FromSlash(prefix+"new.png")))
	n, err = s.SweepBoardAssets(context.Background(), func(context.Context, []string) ([]string, error) { return nil, errors.New("database offline") })
	require.Error(t, err)
	assert.Zero(t, n)
	assert.FileExists(t, filepath.Join(dir, filepath.FromSlash(prefix+"live.png")))
}
