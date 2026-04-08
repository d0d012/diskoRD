package storage

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
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

	return fmt.Sprintf("%s/uploads/%s/%s", s.baseURL, messageID, filename), nil
}
