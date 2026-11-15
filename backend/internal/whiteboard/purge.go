package whiteboard

import (
	"context"
	"errors"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
)

// PurgeRequest combines filters with AND when both are supplied.
type PurgeRequest struct {
	CreatedBy *string `json:"createdBy,omitempty"`
	Rect      *Rect   `json:"rect,omitempty"`
}

type PurgeResult struct {
	Deleted int `json:"deleted"`
}

func (s *Service) Purge(ctx context.Context, userID, channelID string, req PurgeRequest) (*PurgeResult, error) {
	ch, err := s.access(ctx, userID, channelID)
	if err != nil {
		return nil, err
	}
	// Identical to channel.Service.requireAdmin (used by Update and Delete):
	// the guild_members role, not custom role permissions or "moderator".
	role, err := s.members.GetMemberRole(ctx, ch.GuildID, userID)
	if err != nil {
		var fe *fiber.Error
		if errors.As(err, &fe) {
			return nil, err
		}
		log.Error().Err(err).Str("channelID", channelID).Msg("whiteboard.Service.Purge: role")
		return nil, fiber.NewError(fiber.StatusInternalServerError, "failed to purge board")
	}
	if role != "owner" && role != "admin" {
		return nil, fiber.NewError(fiber.StatusForbidden, "only admins and owners can manage channels")
	}
	if req.CreatedBy == nil && req.Rect == nil {
		return nil, fiber.NewError(fiber.StatusBadRequest, "createdBy or rect is required")
	}
	if req.CreatedBy != nil && !isUUID(*req.CreatedBy) {
		return nil, fiber.NewError(fiber.StatusBadRequest, "invalid createdBy")
	}
	if req.Rect != nil {
		if err := req.Rect.validate(); err != nil {
			return nil, httpError(err)
		}
	}

	unlock := s.locks.lock(channelID)
	defer unlock()

	result := &PurgeResult{}
	for {
		// Select and delete under the same board transaction: versions cannot
		// become stale between selection and the normal commit path.
		committed, err := s.commitCommand(ctx, ch, userID, uuid.NewString(), func(ctx context.Context, tx BoardTx) ([]prepared, error) {
			targets, err := tx.PurgeTargets(ctx, req)
			if err != nil {
				return nil, err
			}
			changes := make([]prepared, len(targets))
			for i, o := range targets {
				version := o.Version
				changes[i].req = ChangeRequest{ID: o.ID, Action: ActionDelete, ExpectedVersion: &version}
			}
			return changes, nil
		})
		if err != nil {
			return nil, err
		}
		if committed == nil {
			return result, nil
		}
		result.Deleted += len(committed.Changes)
		if len(committed.Changes) < MaxChangesPerCommand {
			return result, nil
		}
	}
}
