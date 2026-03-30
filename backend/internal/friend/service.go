package friend

import (
	"context"
	"fmt"

	"github.com/gofiber/fiber/v2"

	"github.com/d0d012/diskord/internal/presence"
)

type Service struct {
	repo        *Repository
	presenceSvc *presence.Service
	notifier    FriendNotifier
}

func NewService(repo *Repository, presenceSvc *presence.Service) *Service {
	return &Service{repo: repo, presenceSvc: presenceSvc}
}

func (s *Service) SetNotifier(n FriendNotifier) {
	s.notifier = n
}

func (s *Service) SendRequest(ctx context.Context, senderID, receiverID string) (*FriendRequestResponse, error) {
	if senderID == receiverID {
		return nil, fiber.NewError(fiber.StatusBadRequest, "cannot send friend request to yourself")
	}

	existing, err := s.repo.GetBetween(ctx, senderID, receiverID)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		switch existing.Status {
		case "accepted":
			return nil, fiber.NewError(fiber.StatusConflict, "already friends")
		case "pending":
			return nil, fiber.NewError(fiber.StatusConflict, "friend request already exists")
		case "blocked":
			return nil, fiber.NewError(fiber.StatusForbidden, "cannot send friend request")
		}
	}

	f, err := s.repo.SendRequest(ctx, senderID, receiverID)
	if err != nil {
		return nil, fmt.Errorf("friend.Service.SendRequest: %w", err)
	}

	// Re-fetch with user info via ListRequests (or return minimal response)
	reqs, err := s.repo.ListRequests(ctx, receiverID)
	if err != nil {
		return nil, err
	}
	for _, r := range reqs {
		if r.ID == f.ID {
			if s.notifier != nil {
				s.notifier.NotifyUser(receiverID, "FRIEND_REQUEST", r)
			}
			return &r, nil
		}
	}
	return nil, fmt.Errorf("friend.Service.SendRequest: created but not found")
}

func (s *Service) AcceptRequest(ctx context.Context, callerID, friendshipID string) error {
	f, err := s.repo.GetByID(ctx, friendshipID)
	if err != nil {
		return err
	}
	if f.ReceiverID != callerID {
		return fiber.NewError(fiber.StatusForbidden, "not the receiver of this request")
	}
	if f.Status != "pending" {
		return fiber.NewError(fiber.StatusBadRequest, "request is not pending")
	}
	if err := s.repo.UpdateStatus(ctx, friendshipID, "accepted"); err != nil {
		return err
	}
	if s.notifier != nil {
		payload := map[string]string{"friendshipId": friendshipID}
		s.notifier.NotifyUser(f.SenderID, "FRIEND_ACCEPT", payload)
		s.notifier.NotifyUser(f.ReceiverID, "FRIEND_ACCEPT", payload)
	}
	return nil
}

func (s *Service) DeclineRequest(ctx context.Context, callerID, friendshipID string) error {
	f, err := s.repo.GetByID(ctx, friendshipID)
	if err != nil {
		return err
	}
	if f.ReceiverID != callerID && f.SenderID != callerID {
		return fiber.NewError(fiber.StatusForbidden, "not part of this request")
	}
	if f.Status != "pending" {
		return fiber.NewError(fiber.StatusBadRequest, "request is not pending")
	}
	if err := s.repo.Delete(ctx, friendshipID); err != nil {
		return err
	}
	if s.notifier != nil {
		payload := map[string]string{"friendshipId": friendshipID}
		s.notifier.NotifyUser(f.SenderID, "FRIEND_DECLINE", payload)
		s.notifier.NotifyUser(f.ReceiverID, "FRIEND_DECLINE", payload)
	}
	return nil
}

func (s *Service) RemoveFriend(ctx context.Context, callerID, friendshipID string) error {
	f, err := s.repo.GetByID(ctx, friendshipID)
	if err != nil {
		return err
	}
	if f.SenderID != callerID && f.ReceiverID != callerID {
		return fiber.NewError(fiber.StatusForbidden, "not part of this friendship")
	}
	if f.Status != "accepted" {
		return fiber.NewError(fiber.StatusBadRequest, "not friends")
	}
	return s.repo.Delete(ctx, friendshipID)
}

func (s *Service) ListFriends(ctx context.Context, userID string) ([]FriendResponse, error) {
	friends, err := s.repo.ListFriends(ctx, userID)
	if err != nil {
		return nil, err
	}
	// Attach presence statuses
	ids := make([]string, len(friends))
	for i, f := range friends {
		ids[i] = f.ID
	}
	statuses := s.presenceSvc.GetStatuses(ctx, ids)
	for i := range friends {
		friends[i].Status = statuses[friends[i].ID]
	}
	return friends, nil
}

func (s *Service) ListRequests(ctx context.Context, userID string) ([]FriendRequestResponse, error) {
	return s.repo.ListRequests(ctx, userID)
}

func (s *Service) OpenDM(ctx context.Context, callerID, targetUserID string) (*DMChannelResponse, error) {
	if callerID == targetUserID {
		return nil, fiber.NewError(fiber.StatusBadRequest, "cannot DM yourself")
	}
	dm, err := s.repo.GetOrCreateDM(ctx, callerID, targetUserID)
	if err != nil {
		return nil, err
	}
	dms, err := s.repo.ListDMs(ctx, callerID)
	if err != nil {
		return nil, err
	}
	for _, d := range dms {
		if d.ID == dm.ID {
			status := s.presenceSvc.GetStatus(ctx, d.Recipient.ID)
			d.Recipient.Status = status
			return &d, nil
		}
	}
	return nil, fmt.Errorf("friend.Service.OpenDM: created but not found")
}

func (s *Service) ListDMs(ctx context.Context, userID string) ([]DMChannelResponse, error) {
	dms, err := s.repo.ListDMs(ctx, userID)
	if err != nil {
		return nil, err
	}
	ids := make([]string, len(dms))
	for i, d := range dms {
		ids[i] = d.Recipient.ID
	}
	statuses := s.presenceSvc.GetStatuses(ctx, ids)
	for i := range dms {
		dms[i].Recipient.Status = statuses[dms[i].Recipient.ID]
	}
	return dms, nil
}
