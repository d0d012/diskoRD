package storage

import (
	"context"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"time"

	"github.com/rs/zerolog/log"
)

type BoardAssetFile struct {
	Key     string
	ModTime time.Time
}

// ListBoardAssets visits only regular files in the layout SaveBoardAsset owns.
// It does not follow symlinks, including board directories.
func (s *Service) ListBoardAssets() ([]BoardAssetFile, error) {
	root := filepath.Join(s.basePath, "board-assets")
	var files []BoardAssetFile
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			if path == root && os.IsNotExist(err) {
				return nil
			}
			return err
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		if entry.IsDir() {
			if path != root && !messageDirRe.MatchString(rel) {
				return filepath.SkipDir
			}
			return nil
		}
		if !entry.Type().IsRegular() {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		files = append(files, BoardAssetFile{Key: "board-assets/" + filepath.ToSlash(rel), ModTime: info.ModTime()})
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("storage.Service.ListBoardAssets: %w", err)
	}
	return files, nil
}

// SweepBoardAssets asks the database about old files in bounded batches. A
// lookup failure never authorizes deletion. Fresh in-flight uploads are exempt.
func (s *Service) SweepBoardAssets(ctx context.Context, existing func(context.Context, []string) ([]string, error)) (int, error) {
	files, err := s.ListBoardAssets()
	if err != nil {
		return 0, err
	}
	cutoff := time.Now().Add(-24 * time.Hour)
	var keys []string
	for _, file := range files {
		if file.ModTime.Before(cutoff) {
			keys = append(keys, file.Key)
		}
	}
	deleted := 0
	for start := 0; start < len(keys); start += 500 {
		if err := ctx.Err(); err != nil {
			return deleted, err
		}
		batch := keys[start:min(start+500, len(keys))]
		live, err := existing(ctx, batch)
		if err != nil {
			return deleted, fmt.Errorf("storage.Service.SweepBoardAssets: keys: %w", err)
		}
		keep := make(map[string]bool, len(live))
		for _, key := range live {
			keep[key] = true
		}
		for _, key := range batch {
			if keep[key] {
				continue
			}
			if err := s.DeleteBoardAsset(key); err != nil {
				log.Warn().Err(err).Str("storageKey", key).Msg("board disk sweep: delete failed")
			} else {
				deleted++
			}
		}
	}
	return deleted, nil
}
