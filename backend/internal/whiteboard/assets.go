package whiteboard

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"

	"github.com/d0d012/diskord/internal/storage"
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
)

// UploadAsset validates actual bytes, not the filename or multipart MIME. The
// file and metadata share a board-row lock with commands; uploading changes no
// board seq and emits no commit until the client creates an image object.
func (s *Service) UploadAsset(ctx context.Context, userID, channelID string, input io.Reader) (*UploadedAsset, error) {
	if _, err := s.access(ctx, userID, channelID); err != nil {
		return nil, err
	}
	data, err := io.ReadAll(io.LimitReader(input, MaxImageBytes+1))
	if err != nil {
		return nil, fmt.Errorf("whiteboard.Service.UploadAsset: read: %w", err)
	}
	if len(data) > MaxImageBytes {
		return nil, fiber.NewError(fiber.StatusRequestEntityTooLarge, "image exceeds 8 MiB")
	}
	r := bytes.NewReader(data)
	mime, err := storage.SniffImage(r)
	if errors.Is(err, storage.ErrUnsupportedImage) {
		return nil, fiber.NewError(fiber.StatusBadRequest, "expected a PNG, JPEG or GIF image; SVG is not supported")
	}
	if err != nil {
		return nil, fmt.Errorf("whiteboard.Service.UploadAsset: sniff: %w", err)
	}
	// No WebP decoder exists in the current module graph. Do not accept a file
	// we cannot independently decode and validate.
	if mime == "image/webp" {
		return nil, fiber.NewError(fiber.StatusBadRequest, "WebP is not supported; upload PNG, JPEG or GIF")
	}
	cfg, _, err := image.DecodeConfig(r)
	if err != nil || cfg.Width <= 0 || cfg.Height <= 0 {
		return nil, fiber.NewError(fiber.StatusBadRequest, "image cannot be decoded")
	}
	if cfg.Width > maxImageDim || cfg.Height > maxImageDim || int64(cfg.Width)*int64(cfg.Height) > maxImagePixels {
		return nil, fiber.NewError(fiber.StatusRequestEntityTooLarge, "image exceeds 16 megapixels or 32768 pixels per side")
	}
	// DecodeConfig alone accepts header-only/truncated images. Decode only
	// after the pixel check to bound allocation (GIF: the first frame).
	if _, _, err := image.Decode(bytes.NewReader(data)); err != nil {
		return nil, fiber.NewError(fiber.StatusBadRequest, "image cannot be decoded")
	}
	if s.storage == nil {
		return nil, fmt.Errorf("whiteboard.Service.UploadAsset: storage not configured")
	}

	unlock := s.locks.lock(channelID)
	defer unlock()
	a := Asset{ID: uuid.NewString(), BoardID: channelID, MIME: mime, Bytes: len(data),
		Width: cfg.Width, Height: cfg.Height, UploadedBy: userID}
	err = s.repo.Commit(ctx, channelID, func(ctx context.Context, tx BoardTx) error {
		refs, err := tx.ReferencedAssets(ctx, nil)
		if err != nil {
			return fmt.Errorf("whiteboard.Service.UploadAsset: referenced assets: %w", err)
		}
		if len(refs) >= MaxReferencedAssetsPerBoard {
			return fiber.NewError(fiber.StatusRequestEntityTooLarge, "board image asset quota reached (100 referenced assets)")
		}
		a.StorageKey, err = s.storage.SaveBoardAsset(channelID, mime, bytes.NewReader(data))
		if err != nil {
			return fmt.Errorf("whiteboard.Service.UploadAsset: save: %w", err)
		}
		return tx.InsertAsset(ctx, a)
	})
	if err != nil {
		// Covers insert AND transaction commit failure. Cleanup is not tied to
		// the request context: a cancelled request must not strand a file.
		if a.StorageKey != "" {
			if cleanupErr := s.storage.DeleteBoardAsset(a.StorageKey); cleanupErr != nil {
				log.Error().Err(cleanupErr).Str("assetID", a.ID).Msg("whiteboard.Service.UploadAsset: cleanup")
			}
		}
		var fe *fiber.Error
		if errors.As(err, &fe) {
			return nil, fe
		}
		return nil, fmt.Errorf("whiteboard.Service.UploadAsset: commit: %w", err)
	}
	return &UploadedAsset{ID: a.ID, URL: s.storage.PublicURL(a.StorageKey), Width: a.Width, Height: a.Height}, nil
}
