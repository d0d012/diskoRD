package call

import (
	"context"
	"fmt"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"
	lkauth "github.com/livekit/protocol/auth"
	"github.com/redis/go-redis/v9"

	"github.com/d0d012/diskord/internal/friend"
	"github.com/d0d012/diskord/pkg/config"
)

const callTTL = 30 * time.Second

func callKey(channelID string) string {
	return fmt.Sprintf("call:%s", channelID)
}

// Notifier is satisfied by the gateway hub.
type Notifier interface {
	NotifyUser(userID, op string, data interface{})
}

type Service struct {
	db         *pgxpool.Pool
	rdb        *redis.Client
	cfg        config.LiveKitConfig
	friendRepo *friend.Repository
	notifier   Notifier
}

func NewService(db *pgxpool.Pool, rdb *redis.Client, cfg config.LiveKitConfig, friendRepo *friend.Repository) *Service {
	return &Service{db: db, rdb: rdb, cfg: cfg, friendRepo: friendRepo}
}

func (s *Service) SetNotifier(n Notifier) {
	s.notifier = n
}

func (s *Service) generateToken(userID, username, roomName string) (string, error) {
	at := lkauth.NewAccessToken(s.cfg.APIKey, s.cfg.APISecret)
	grant := &lkauth.VideoGrant{
		RoomJoin:     true,
		Room:         roomName,
		CanPublish:   boolPtr(true),
		CanSubscribe: boolPtr(true),
	}
	at.SetVideoGrant(grant).
		SetIdentity(userID).
		SetName(username).
		SetValidFor(4 * time.Hour)
	return at.ToJWT()
}

func boolPtr(b bool) *bool { return &b }

// Initiate starts a call: stores a Redis key and sends CALL_INVITE to the recipient.
func (s *Service) Initiate(ctx context.Context, channelID, callerID string) error {
	dm, err := s.friendRepo.GetDMByID(ctx, channelID, callerID)
	if err != nil {
		return fiber.NewError(fiber.StatusNotFound, "DM channel not found")
	}

	recipientID := dm.UserBID
	if dm.UserBID == callerID {
		recipientID = dm.UserAID
	}

	// Store pending call with TTL
	if err := s.rdb.Set(ctx, callKey(channelID), callerID, callTTL).Err(); err != nil {
		return fmt.Errorf("call.Service.Initiate: redis set: %w", err)
	}

	var callerName string
	_ = s.db.QueryRow(ctx, `SELECT username FROM users WHERE id = $1`, callerID).Scan(&callerName)

	if s.notifier != nil {
		s.notifier.NotifyUser(recipientID, "CALL_INVITE", CallInviteEvent{
			ChannelID:  channelID,
			CallerID:   callerID,
			CallerName: callerName,
		})
	}
	return nil
}

// Accept accepts the call: generates tokens for both parties and sends CALL_ACCEPT.
func (s *Service) Accept(ctx context.Context, channelID, calleeID string) error {
	dm, err := s.friendRepo.GetDMByID(ctx, channelID, calleeID)
	if err != nil {
		return fiber.NewError(fiber.StatusNotFound, "DM channel not found")
	}

	callerID, err := s.rdb.Get(ctx, callKey(channelID)).Result()
	if err != nil {
		return fiber.NewError(fiber.StatusGone, "call expired or not found")
	}

	if s.notifier == nil {
		return fmt.Errorf("call.Service.Accept: notifier not set")
	}

	wsURL := s.cfg.PublicURL
	if wsURL == "" {
		wsURL = fmt.Sprintf("ws://%s:%d", s.cfg.Host, s.cfg.Port)
	}

	roomName := fmt.Sprintf("dm:%s", channelID)

	// Generate token for callee
	var calleeName string
	_ = s.db.QueryRow(ctx, `SELECT username FROM users WHERE id = $1`, calleeID).Scan(&calleeName)
	calleeToken, err := s.generateToken(calleeID, calleeName, roomName)
	if err != nil {
		return fmt.Errorf("call.Service.Accept: generate callee token: %w", err)
	}

	// Generate token for caller
	var callerName string
	_ = s.db.QueryRow(ctx, `SELECT username FROM users WHERE id = $1`, callerID).Scan(&callerName)
	callerToken, err := s.generateToken(callerID, callerName, roomName)
	if err != nil {
		return fmt.Errorf("call.Service.Accept: generate caller token: %w", err)
	}

	// Mark as active (no TTL — active until ended)
	s.rdb.Persist(ctx, callKey(channelID))

	// Notify both
	_ = dm // used to verify membership above
	s.notifier.NotifyUser(calleeID, "CALL_ACCEPT", CallAcceptEvent{ChannelID: channelID, Token: calleeToken, URL: wsURL})
	s.notifier.NotifyUser(callerID, "CALL_ACCEPT", CallAcceptEvent{ChannelID: channelID, Token: callerToken, URL: wsURL})
	return nil
}

// Decline rejects the call: cleans up Redis and notifies caller.
func (s *Service) Decline(ctx context.Context, channelID, calleeID string) error {
	callerID, err := s.rdb.Get(ctx, callKey(channelID)).Result()
	if err != nil {
		return nil // already expired, ignore
	}

	s.rdb.Del(ctx, callKey(channelID))

	if s.notifier != nil {
		s.notifier.NotifyUser(callerID, "CALL_DECLINE", CallDeclineEvent{ChannelID: channelID})
	}
	return nil
}

// End terminates an active call: cleans up Redis and notifies both participants.
func (s *Service) End(ctx context.Context, channelID, userID string) error {
	dm, err := s.friendRepo.GetDMByID(ctx, channelID, userID)
	if err != nil {
		return fiber.NewError(fiber.StatusNotFound, "DM channel not found")
	}

	s.rdb.Del(ctx, callKey(channelID))

	if s.notifier != nil {
		otherID := dm.UserBID
		if dm.UserBID == userID {
			otherID = dm.UserAID
		}
		s.notifier.NotifyUser(userID, "CALL_END", CallEndEvent{ChannelID: channelID})
		s.notifier.NotifyUser(otherID, "CALL_END", CallEndEvent{ChannelID: channelID})
	}
	return nil
}
