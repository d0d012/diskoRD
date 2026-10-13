package storage

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSaveAvatarRejectsUnsupportedType(t *testing.T) {
	svc := NewService(t.TempDir(), "http://localhost:8080")

	_, err := svc.SaveAvatar("user-1", "text/html", strings.NewReader("<html>not an image</html>"))
	require.Error(t, err)
}

func TestSaveAvatarSecondUploadKeepsNewestAfterCleanup(t *testing.T) {
	base := t.TempDir()
	svc := NewService(base, "http://localhost:8080")

	first, err := svc.SaveAvatar("user-1", "image/png", strings.NewReader("first"))
	require.NoError(t, err)

	// The first upload stays until the database points at the new file.
	second, err := svc.SaveAvatar("user-1", "image/png", strings.NewReader("second"))
	require.NoError(t, err)
	assert.NotEqual(t, first, second)

	dir := filepath.Join(base, "avatars", "user-1")
	entries, err := os.ReadDir(dir)
	require.NoError(t, err)
	require.Len(t, entries, 2)

	// Once the database points at the second file, the first is cleaned up.
	require.NoError(t, svc.DeleteAvatarsExcept("user-1", filepath.Base(second)))

	entries, err = os.ReadDir(dir)
	require.NoError(t, err)
	require.Len(t, entries, 1)

	content, err := os.ReadFile(filepath.Join(dir, entries[0].Name()))
	require.NoError(t, err)
	assert.Equal(t, "second", string(content))
	assert.Contains(t, second, "/uploads/avatars/user-1/")
}

func TestSaveAvatarExceedsLimit(t *testing.T) {
	svc := NewService(t.TempDir(), "http://localhost:8080")

	_, err := svc.SaveAvatar("user-1", "image/png", strings.NewReader(strings.Repeat("a", MaxFileSize+1)))
	require.Error(t, err)
}

func TestDeleteAvatars(t *testing.T) {
	base := t.TempDir()
	svc := NewService(base, "http://localhost:8080")

	_, err := svc.SaveAvatar("user-1", "image/png", strings.NewReader("data"))
	require.NoError(t, err)

	require.NoError(t, svc.DeleteAvatars("user-1"))

	dir := filepath.Join(base, "avatars", "user-1")
	_, err = os.Stat(dir)
	assert.True(t, os.IsNotExist(err))
}

func TestSniffImageRejectsHTMLNamedAsImage(t *testing.T) {
	_, err := SniffImage(strings.NewReader("<html><script>alert(1)</script></html>"))
	assert.ErrorIs(t, err, ErrUnsupportedImage)
}

func TestSniffImageDetectsPNGAndRewinds(t *testing.T) {
	data := "\x89PNG\r\n\x1a\n" + strings.Repeat("\x00", 32)
	r := strings.NewReader(data)

	mimeType, err := SniffImage(r)
	require.NoError(t, err)
	assert.Equal(t, "image/png", mimeType)
	assert.Equal(t, int64(len(data)), int64(r.Len()), "reader should be rewound")
}

func TestSaveGuildIconUsesItsOwnDirectory(t *testing.T) {
	base := t.TempDir()
	svc := NewService(base, "")

	url, err := svc.SaveGuildIcon("guild-1", "image/webp", strings.NewReader("icon"))
	require.NoError(t, err)
	assert.True(t, strings.HasPrefix(url, "/uploads/guild-icons/guild-1/"), url)
	assert.True(t, strings.HasSuffix(url, ".webp"), url)

	require.NoError(t, svc.DeleteGuildIcons("guild-1"))
	_, err = os.Stat(filepath.Join(base, "guild-icons", "guild-1"))
	assert.True(t, os.IsNotExist(err))
}
