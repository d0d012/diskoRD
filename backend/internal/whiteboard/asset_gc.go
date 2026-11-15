package whiteboard

import (
	"context"
	"fmt"
	"time"

	"github.com/rs/zerolog/log"
)

// CollectOrphanAssets serializes with commands, deletes rows transactionally,
// then removes files. Failed file deletes are retried by the disk sweep.
func (s *Service) CollectOrphanAssets(ctx context.Context) (int, error) {
	if s.storage == nil {
		return 0, fmt.Errorf("whiteboard.Service.CollectOrphanAssets: storage not configured")
	}
	boards, err := s.repo.OrphanAssetBoards(ctx)
	if err != nil {
		return 0, fmt.Errorf("whiteboard.Service.CollectOrphanAssets: candidates: %w", err)
	}
	deleted := 0
	for _, boardID := range boards {
		if err := ctx.Err(); err != nil {
			return deleted, err
		}
		unlock := s.locks.lock(boardID)
		var keys []string
		err := s.repo.Commit(ctx, boardID, func(ctx context.Context, tx BoardTx) error {
			var err error
			keys, err = tx.DeleteOrphanAssets(ctx)
			return err
		})
		unlock()
		if err != nil {
			return deleted, fmt.Errorf("whiteboard.Service.CollectOrphanAssets: commit: %w", err)
		}
		deleted += len(keys)
		for _, key := range keys {
			if err := s.storage.DeleteBoardAsset(key); err != nil {
				log.Warn().Err(err).Str("storageKey", key).Msg("board asset GC: delete failed")
			}
		}
	}
	return deleted, nil
}

func (s *Service) SweepOrphanAssetFiles(ctx context.Context) (int, error) {
	if s.storage == nil {
		return 0, fmt.Errorf("whiteboard.Service.SweepOrphanAssetFiles: storage not configured")
	}
	return s.storage.SweepBoardAssets(ctx, s.repo.ExistingAssetKeys)
}

// RunAssetGC stops with the server's shutdown context.
func (s *Service) RunAssetGC(ctx context.Context) {
	timer := time.NewTimer(10 * time.Minute)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
			rows, err := s.CollectOrphanAssets(ctx)
			log.Info().Err(err).Int("rows", rows).Msg("board asset GC")
			files, err := s.SweepOrphanAssetFiles(ctx)
			log.Info().Err(err).Int("files", files).Msg("board asset disk sweep")
			timer.Reset(6 * time.Hour)
		}
	}
}
