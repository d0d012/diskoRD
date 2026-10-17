package storage

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

const MaxFileSize = 8 * 1024 * 1024 // 8MB

var allowedMimeTypes = map[string]string{
	"image/jpeg": ".jpg",
	"image/png":  ".png",
	"image/gif":  ".gif",
	"image/webp": ".webp",
}

type Service struct {
	basePath string
	baseURL  string
}

func NewService(basePath, baseURL string) *Service {
	return &Service{basePath: basePath, baseURL: baseURL}
}

// Save writes the file to disk and returns the public URL.
func (s *Service) Save(mimeType, originalName, messageID string, r io.Reader) (string, error) {
	ext, ok := allowedMimeTypes[mimeType]
	if !ok {
		// Fallback: try to infer from original filename
		original := strings.ToLower(filepath.Ext(originalName))
		allowed := map[string]bool{".jpg": true, ".jpeg": true, ".png": true, ".gif": true, ".webp": true}
		if !allowed[original] {
			return "", fmt.Errorf("unsupported file type: %s", mimeType)
		}
		ext = original
		if ext == ".jpeg" {
			ext = ".jpg"
		}
	}

	dir := filepath.Join(s.basePath, messageID)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", fmt.Errorf("storage.Service.Save: mkdir: %w", err)
	}

	filename := "image" + ext
	fullPath := filepath.Join(dir, filename)

	f, err := os.Create(fullPath)
	if err != nil {
		return "", fmt.Errorf("storage.Service.Save: create: %w", err)
	}
	defer f.Close()

	limited := io.LimitReader(r, MaxFileSize+1)
	written, err := io.Copy(f, limited)
	if err != nil {
		os.Remove(fullPath)
		return "", fmt.Errorf("storage.Service.Save: write: %w", err)
	}
	if written > MaxFileSize {
		os.Remove(fullPath)
		return "", fmt.Errorf("file exceeds 8MB limit")
	}

	return s.messageURL(messageID, filename), nil
}

func (s *Service) messageURL(messageID, filename string) string {
	return fmt.Sprintf("%s/uploads/%s/%s", s.baseURL, messageID, filename)
}

// messageDirRe matches the directories Save creates: one per message UUID.
// Other top-level directories (avatars/, guild-icons/) never match.
var messageDirRe = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// MessageImage is a message attachment found on disk.
type MessageImage struct {
	MessageID string
	URL       string
}

// ListMessageImages walks the storage root for files written by Save
// ({basePath}/{messageID}/image.{ext}) and returns their public URLs, built
// the same way Save builds them. Used to backfill messages.attachments.
func (s *Service) ListMessageImages() ([]MessageImage, error) {
	entries, err := os.ReadDir(s.basePath)
	if err != nil {
		return nil, fmt.Errorf("storage.Service.ListMessageImages: %w", err)
	}
	var images []MessageImage
	for _, entry := range entries {
		if !entry.IsDir() || !messageDirRe.MatchString(entry.Name()) {
			continue
		}
		files, err := os.ReadDir(filepath.Join(s.basePath, entry.Name()))
		if err != nil {
			return nil, fmt.Errorf("storage.Service.ListMessageImages: %w", err)
		}
		for _, f := range files {
			if f.IsDir() || !isMessageImageName(f.Name()) {
				continue
			}
			images = append(images, MessageImage{MessageID: entry.Name(), URL: s.messageURL(entry.Name(), f.Name())})
			break // Save writes a single image per message
		}
	}
	return images, nil
}

func isMessageImageName(name string) bool {
	ext := strings.TrimPrefix(name, "image")
	if ext == name {
		return false
	}
	for _, allowed := range allowedMimeTypes {
		if ext == allowed {
			return true
		}
	}
	return false
}

// SaveAvatar writes a user's avatar and returns its public URL. Cleanup of the
// previous avatar is deferred to DeleteAvatarsExcept so the database can point
// at the new file first. See saveImage.
func (s *Service) SaveAvatar(userID, mimeType string, r io.Reader) (string, error) {
	url, err := s.saveImage("avatars", userID, mimeType, r, false)
	if err != nil {
		return "", fmt.Errorf("storage.Service.SaveAvatar: %w", err)
	}
	return url, nil
}

// DeleteAvatarsExcept removes every avatar of a user except keepFilename (the
// basename of the URL the database currently points at).
func (s *Service) DeleteAvatarsExcept(userID, keepFilename string) error {
	dir := filepath.Join(s.basePath, "avatars", userID)
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("storage.Service.DeleteAvatarsExcept: %w", err)
	}
	for _, entry := range entries {
		if entry.IsDir() || entry.Name() == keepFilename {
			continue
		}
		os.Remove(filepath.Join(dir, entry.Name()))
	}
	return nil
}

// DeleteAvatars removes all of a user's uploaded avatars.
func (s *Service) DeleteAvatars(userID string) error {
	if err := os.RemoveAll(filepath.Join(s.basePath, "avatars", userID)); err != nil {
		return fmt.Errorf("storage.Service.DeleteAvatars: %w", err)
	}
	return nil
}

// SaveGuildIcon writes a guild's icon and returns its public URL. See saveImage.
func (s *Service) SaveGuildIcon(guildID, mimeType string, r io.Reader) (string, error) {
	url, err := s.saveImage("guild-icons", guildID, mimeType, r, true)
	if err != nil {
		return "", fmt.Errorf("storage.Service.SaveGuildIcon: %w", err)
	}
	return url, nil
}

// DeleteGuildIcons removes all of a guild's uploaded icons.
func (s *Service) DeleteGuildIcons(guildID string) error {
	if err := os.RemoveAll(filepath.Join(s.basePath, "guild-icons", guildID)); err != nil {
		return fmt.Errorf("storage.Service.DeleteGuildIcons: %w", err)
	}
	return nil
}

// SniffImage detects the real image type from the first bytes of r and rewinds
// it. Only the types in allowedMimeTypes are accepted; the multipart header and
// filename are never trusted.
func SniffImage(r io.ReadSeeker) (string, error) {
	head := make([]byte, 512)
	n, err := io.ReadFull(r, head)
	if err != nil && err != io.EOF && err != io.ErrUnexpectedEOF {
		return "", fmt.Errorf("storage.SniffImage: read: %w", err)
	}
	mimeType := http.DetectContentType(head[:n])
	if _, ok := allowedMimeTypes[mimeType]; !ok {
		return "", ErrUnsupportedImage
	}
	if _, err := r.Seek(0, io.SeekStart); err != nil {
		return "", fmt.Errorf("storage.SniffImage: seek: %w", err)
	}
	return mimeType, nil
}

// ErrUnsupportedImage is returned by SniffImage for anything that is not a
// PNG, JPEG, GIF or WebP image.
var ErrUnsupportedImage = errors.New("unsupported image type")

// saveImage writes an image to {basePath}/{kind}/{ownerID}/{random}{ext} and
// returns its public URL. A fresh random filename is used on every upload so
// browsers and CDNs never serve a cached old image. When cleanup is true the
// owner's previous files are deleted so only the current one remains; callers
// that need to commit the database first pass false and clean up themselves.
func (s *Service) saveImage(kind, ownerID, mimeType string, r io.Reader, cleanup bool) (string, error) {
	ext, ok := allowedMimeTypes[mimeType]
	if !ok {
		return "", fmt.Errorf("unsupported file type: %s", mimeType)
	}

	dir := filepath.Join(s.basePath, kind, ownerID)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", fmt.Errorf("mkdir: %w", err)
	}

	name, err := randomHex(8)
	if err != nil {
		return "", fmt.Errorf("random name: %w", err)
	}
	filename := name + ext
	fullPath := filepath.Join(dir, filename)

	f, err := os.Create(fullPath)
	if err != nil {
		return "", fmt.Errorf("create: %w", err)
	}

	limited := io.LimitReader(r, MaxFileSize+1)
	written, err := io.Copy(f, limited)
	if err != nil {
		f.Close()
		os.Remove(fullPath)
		return "", fmt.Errorf("write: %w", err)
	}
	if written > MaxFileSize {
		f.Close()
		os.Remove(fullPath)
		return "", fmt.Errorf("file exceeds 8MB limit")
	}
	if err := f.Close(); err != nil {
		os.Remove(fullPath)
		return "", fmt.Errorf("close: %w", err)
	}

	// Remove every other file in the directory so only the newest image is served.
	if cleanup {
		entries, err := os.ReadDir(dir)
		if err == nil {
			for _, entry := range entries {
				if entry.IsDir() || entry.Name() == filename {
					continue
				}
				os.Remove(filepath.Join(dir, entry.Name()))
			}
		}
	}

	return fmt.Sprintf("%s/uploads/%s/%s/%s", s.baseURL, kind, ownerID, filename), nil
}

func randomHex(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
