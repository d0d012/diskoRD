package whiteboard

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

func (r *fakeRepo) OrphanAssetBoards(context.Context) ([]string, error) { return []string{chID}, nil }
func (r *fakeRepo) ExistingAssetKeys(_ context.Context, keys []string) ([]string, error) {
	var live []string
	for _, a := range r.assets {
		for _, key := range keys {
			if a.StorageKey == key {
				live = append(live, key)
			}
		}
	}
	return live, nil
}
func (t *fakeTx) TouchAssets(_ context.Context, ids []string) error {
	t.repo.touched = append(t.repo.touched, ids...)
	return nil
}
func (t *fakeTx) DeleteOrphanAssets(context.Context) ([]string, error) {
	for id, a := range t.assets {
		for _, key := range t.repo.orphanKeys {
			if a.StorageKey == key {
				delete(t.assets, id)
			}
		}
	}
	return t.repo.orphanKeys, nil
}

func TestAssetTouchesOnCreateReplaceAndDelete(t *testing.T) {
	h := newHarness()
	a, b := seedAsset(h), seedAsset(h)
	id := h.uuid()
	_, err := h.run(createChange(id, assetImage(id, a, "")))
	require.NoError(t, err)
	assert.ElementsMatch(t, []string{a.ID}, h.repo.touched)
	h.repo.touched = nil
	_, err = h.run(updateChange(id, 1, m{"assetId": b.ID, "url": "/uploads/" + b.StorageKey}))
	require.NoError(t, err)
	assert.ElementsMatch(t, []string{a.ID, b.ID}, h.repo.touched)
	h.repo.touched = nil
	_, err = h.run(deleteChange(id, 2))
	require.NoError(t, err)
	assert.Equal(t, []string{b.ID}, h.repo.touched)
}

func TestCollectOrphanAssetsCommitOrdering(t *testing.T) {
	for _, fail := range []bool{false, true} {
		t.Run(map[bool]string{false: "commit", true: "rollback"}[fail], func(t *testing.T) {
			h, dir := assetHarness(t, "")
			a := seedAsset(h)
			path := filepath.Join(dir, filepath.FromSlash(a.StorageKey))
			require.NoError(t, os.MkdirAll(filepath.Dir(path), 0755))
			require.NoError(t, os.WriteFile(path, []byte("image"), 0600))
			h.repo.orphanKeys = []string{a.StorageKey}
			h.repo.beforeCommit = func() { _, err := os.Stat(path); require.NoError(t, err); require.Contains(t, h.repo.assets, a.ID) }
			if fail {
				h.repo.failCommit = errors.New("rollback")
			}
			n, err := h.svc.CollectOrphanAssets(context.Background())
			if fail {
				require.Error(t, err)
				assert.Zero(t, n)
				assert.FileExists(t, path)
			} else {
				require.NoError(t, err)
				assert.Equal(t, 1, n)
				assert.NoFileExists(t, path)
				assert.NotContains(t, h.repo.assets, a.ID)
			}
		})
	}
}

func TestCollectOrphanAssetsFileErrorContinues(t *testing.T) {
	h, _ := assetHarness(t, "")
	h.repo.orphanKeys = []string{"invalid-key", "another-invalid-key"}
	n, err := h.svc.CollectOrphanAssets(context.Background())
	require.NoError(t, err)
	assert.Equal(t, 2, n)
	assert.Equal(t, 1, h.repo.commits)
}

func TestCollectOrphanAssetsUsesCommandLock(t *testing.T) {
	h, _ := assetHarness(t, "")
	unlock := h.svc.locks.lock(chID)
	done := make(chan error, 1)
	go func() { _, err := h.svc.CollectOrphanAssets(context.Background()); done <- err }()
	select {
	case <-done:
		t.Fatal("GC bypassed command lock")
	case <-time.After(30 * time.Millisecond):
	}
	unlock()
	select {
	case err := <-done:
		require.NoError(t, err)
	case <-time.After(time.Second):
		t.Fatal("GC did not acquire released lock")
	}
}
