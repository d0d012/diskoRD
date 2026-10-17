// Command backfill-attachments restores messages.attachments (migration 000021)
// for images uploaded before the column existed. It scans STORAGE_PATH for
// {messageID}/image.{ext} and sets the URL on messages whose attachments are
// still empty. Safe to run more than once.
//
//	./backfill-attachments            # apply
//	./backfill-attachments -dry-run   # report only
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/d0d012/diskord/internal/message"
	"github.com/d0d012/diskord/internal/storage"
	"github.com/d0d012/diskord/pkg/config"
	"github.com/d0d012/diskord/pkg/db"
)

// attachmentStore is the part of message.Repository the backfill writes through.
type attachmentStore interface {
	SetAttachmentsIfEmpty(ctx context.Context, messageID string, urls []string) (bool, error)
}

type result struct {
	Found   int
	Updated int
}

func backfill(ctx context.Context, store attachmentStore, images []storage.MessageImage, dryRun bool) (result, error) {
	res := result{Found: len(images)}
	if dryRun {
		return res, nil
	}
	for _, img := range images {
		updated, err := store.SetAttachmentsIfEmpty(ctx, img.MessageID, []string{img.URL})
		if err != nil {
			return res, fmt.Errorf("backfill %s: %w", img.MessageID, err)
		}
		if updated {
			res.Updated++
			log.Info().Str("messageId", img.MessageID).Str("url", img.URL).Msg("restored attachment")
		}
	}
	return res, nil
}

func main() {
	dryRun := flag.Bool("dry-run", false, "list what would be restored without writing")
	flag.Parse()

	log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr})

	cfg, err := config.Load()
	if err != nil {
		log.Fatal().Err(err).Msg("failed to load config")
	}
	if cfg.Storage.Path == "" {
		log.Fatal().Msg("STORAGE_PATH is not set")
	}

	// Same base URL rule as cmd/server, so restored URLs match new uploads.
	baseURL := fmt.Sprintf("http://localhost:%d", cfg.App.Port)
	if cfg.App.Env == "production" {
		baseURL = ""
	}

	images, err := storage.NewService(cfg.Storage.Path, baseURL).ListMessageImages()
	if err != nil {
		log.Fatal().Err(err).Msg("failed to scan storage")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	pool, err := db.Connect(ctx, cfg.DB.DSN())
	if err != nil {
		log.Fatal().Err(err).Msg("failed to connect to database")
	}
	defer pool.Close()

	res, err := backfill(ctx, message.NewRepository(pool), images, *dryRun)
	if err != nil {
		log.Fatal().Err(err).Msg("backfill failed")
	}
	log.Info().Int("found", res.Found).Int("updated", res.Updated).Bool("dryRun", *dryRun).Msg("backfill complete")
}
