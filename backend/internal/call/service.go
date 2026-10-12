package call

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"
	lkauth "github.com/livekit/protocol/auth"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog/log"

	"github.com/d0d012/diskord/internal/friend"
	"github.com/d0d012/diskord/pkg/config"
)

const (
	// ringTTL is how long an unanswered call rings before timing out.
	ringTTL = 30 * time.Second
	// ringKeyTTL is slightly longer than ringTTL so the timeout handler, not
	// Redis expiry, is what ends a ring (and can notify both sides).
	ringKeyTTL = ringTTL + 5*time.Second
	// activeTTL is how long an active call survives without a keepalive. Clients
	// ping every 30s, so a crashed client's call is reaped within this window.
	activeTTL = 90 * time.Second

	stateRinging = "ringing"
	stateActive  = "active"
)

func callKey(channelID string) string  { return fmt.Sprintf("call:%s", channelID) }
func userCallKey(userID string) string { return fmt.Sprintf("usercall:%s", userID) }

// Notifier is satisfied by the gateway hub.
type Notifier interface {
	NotifyUser(userID, op string, data interface{})
}

type Service struct {
	db       *pgxpool.Pool
	rdb      *redis.Client
	cfg      config.LiveKitConfig
	notifier Notifier

	// Lookups are fields so tests can run without Postgres.
	lookupDM   func(ctx context.Context, channelID, userID string) (userA, userB string, err error)
	lookupName func(ctx context.Context, userID string) string
}

func NewService(db *pgxpool.Pool, rdb *redis.Client, cfg config.LiveKitConfig, friendRepo *friend.Repository) *Service {
	s := &Service{db: db, rdb: rdb, cfg: cfg}
	s.lookupDM = func(ctx context.Context, channelID, userID string) (string, string, error) {
		dm, err := friendRepo.GetDMByID(ctx, channelID, userID)
		if err != nil {
			return "", "", fiber.NewError(fiber.StatusNotFound, "DM channel not found")
		}
		return dm.UserAID, dm.UserBID, nil
	}
	s.lookupName = func(ctx context.Context, userID string) string {
		var name string
		_ = db.QueryRow(ctx, `SELECT username FROM users WHERE id = $1`, userID).Scan(&name)
		return name
	}
	return s
}

func (s *Service) SetNotifier(n Notifier) {
	s.notifier = n
}

func roomFor(channelID string) string { return fmt.Sprintf("dm:%s", channelID) }

func (s *Service) liveKitURL() string {
	if s.cfg.PublicURL != "" {
		return s.cfg.PublicURL
	}
	return fmt.Sprintf("ws://%s:%d", s.cfg.Host, s.cfg.Port)
}

// ViewerToken returns a hidden, subscribe-only token for a participant's own active
// call, so the desktop call window can show video while the call itself stays in the
// main window. The ":viewer" identity keeps it from replacing the user's connection.
func (s *Service) ViewerToken(ctx context.Context, channelID, userID string) (*ViewerTokenResponse, error) {
	if _, _, err := s.lookupDM(ctx, channelID, userID); err != nil {
		return nil, err
	}
	c, err := s.loadCall(ctx, channelID)
	if err != nil {
		return nil, err
	}
	if c == nil || c.state != stateActive || (c.caller != userID && c.callee != userID) {
		return nil, fiber.NewError(fiber.StatusGone, "no active call")
	}
	at := lkauth.NewAccessToken(s.cfg.APIKey, s.cfg.APISecret)
	at.SetVideoGrant(&lkauth.VideoGrant{
		RoomJoin:       true,
		Room:           roomFor(channelID),
		CanPublish:     boolPtr(false),
		CanPublishData: boolPtr(false),
		CanSubscribe:   boolPtr(true),
		Hidden:         true,
	}).
		SetIdentity(userID + ":viewer").
		SetName(s.lookupName(ctx, userID)).
		SetValidFor(12 * time.Hour)
	token, err := at.ToJWT()
	if err != nil {
		return nil, fmt.Errorf("call.Service.ViewerToken: %w", err)
	}
	return &ViewerTokenResponse{Token: token, URL: s.liveKitURL()}, nil
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
		SetValidFor(12 * time.Hour)
	return at.ToJWT()
}

func boolPtr(b bool) *bool { return &b }

type callState struct {
	caller string
	callee string
	state  string
}

func (s *Service) loadCall(ctx context.Context, channelID string) (*callState, error) {
	m, err := s.rdb.HGetAll(ctx, callKey(channelID)).Result()
	if err != nil && strings.HasPrefix(err.Error(), "WRONGTYPE") {
		// Older builds stored call:{channelId} as a plain string with no TTL. Such a
		// key is a leftover, never a live call: drop it instead of failing forever.
		log.Warn().Str("channelID", channelID).Msg("call: removing legacy call key")
		if err := s.rdb.Del(ctx, callKey(channelID)).Err(); err != nil {
			return nil, fmt.Errorf("call.Service.loadCall: delete legacy key: %w", err)
		}
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("call.Service.loadCall: %w", err)
	}
	if len(m) == 0 {
		return nil, nil
	}
	return &callState{caller: m["caller"], callee: m["callee"], state: m["state"]}, nil
}

func (s *Service) clearCall(ctx context.Context, channelID string, c *callState) {
	keys := []string{callKey(channelID)}
	if c != nil {
		keys = append(keys, userCallKey(c.caller), userCallKey(c.callee))
	}
	s.rdb.Del(ctx, keys...)
}

func (s *Service) notify(userID, op string, data interface{}) {
	if s.notifier != nil {
		s.notifier.NotifyUser(userID, op, data)
	}
}

func other(a, b, me string) string {
	if a == me {
		return b
	}
	return a
}

// Initiate starts a call: stores the call state and sends CALL_INVITE to the recipient.
func (s *Service) Initiate(ctx context.Context, channelID, callerID string) error {
	a, b, err := s.lookupDM(ctx, channelID, callerID)
	if err != nil {
		return err
	}
	recipientID := other(a, b, callerID)

	if existing, err := s.loadCall(ctx, channelID); err != nil {
		return err
	} else if existing != nil && existing.state == stateActive {
		// Only the two DM members can get here, and a client can only start a call while
		// it isn't in one. So this call is dead on the caller's side (crash, reload, lost
		// hang-up): replace it instead of blocking calls until it expires.
		log.Info().Str("channelID", channelID).Str("userID", callerID).Msg("call: replacing stale active call")
		s.clearCall(ctx, channelID, existing)
		s.notify(recipientID, "CALL_END", CallEndEvent{ChannelID: channelID})
	} else if existing != nil {
		if existing.caller == recipientID {
			return fiber.NewError(fiber.StatusConflict, "this user is already calling you")
		}
		return fiber.NewError(fiber.StatusConflict, "already calling")
	}

	// Busy checks: neither side may be in another call.
	if n, _ := s.rdb.Exists(ctx, userCallKey(callerID)).Result(); n > 0 {
		return fiber.NewError(fiber.StatusConflict, "you are already in a call")
	}
	if n, _ := s.rdb.Exists(ctx, userCallKey(recipientID)).Result(); n > 0 {
		return fiber.NewError(fiber.StatusConflict, "user is busy")
	}

	pipe := s.rdb.TxPipeline()
	pipe.HSet(ctx, callKey(channelID), "caller", callerID, "callee", recipientID, "state", stateRinging)
	pipe.Expire(ctx, callKey(channelID), ringKeyTTL)
	pipe.Set(ctx, userCallKey(callerID), channelID, ringKeyTTL)
	pipe.Set(ctx, userCallKey(recipientID), channelID, ringKeyTTL)
	if _, err := pipe.Exec(ctx); err != nil {
		return fmt.Errorf("call.Service.Initiate: redis: %w", err)
	}

	s.notify(recipientID, "CALL_INVITE", CallInviteEvent{
		ChannelID:  channelID,
		CallerID:   callerID,
		CallerName: s.lookupName(ctx, callerID),
	})

	// Tell both sides if nobody answers.
	time.AfterFunc(ringTTL, func() { s.expireRing(channelID, callerID) })
	return nil
}

func (s *Service) expireRing(channelID, callerID string) {
	ctx := context.Background()
	c, err := s.loadCall(ctx, channelID)
	if err != nil || c == nil || c.state != stateRinging || c.caller != callerID {
		return
	}
	s.clearCall(ctx, channelID, c)
	ev := CallTimeoutEvent{ChannelID: channelID}
	s.notify(c.caller, "CALL_TIMEOUT", ev)
	s.notify(c.callee, "CALL_TIMEOUT", ev)
}

// Accept accepts the call: generates tokens for both parties and sends CALL_ACCEPT.
func (s *Service) Accept(ctx context.Context, channelID, calleeID string) error {
	if _, _, err := s.lookupDM(ctx, channelID, calleeID); err != nil {
		return err
	}

	c, err := s.loadCall(ctx, channelID)
	if err != nil {
		return err
	}
	if c == nil || c.state != stateRinging {
		return fiber.NewError(fiber.StatusGone, "call expired or not found")
	}
	if c.callee != calleeID {
		return fiber.NewError(fiber.StatusForbidden, "only the recipient can accept this call")
	}
	if s.notifier == nil {
		return fmt.Errorf("call.Service.Accept: notifier not set")
	}

	wsURL := s.liveKitURL()
	roomName := roomFor(channelID)

	calleeToken, err := s.generateToken(calleeID, s.lookupName(ctx, calleeID), roomName)
	if err != nil {
		return fmt.Errorf("call.Service.Accept: generate callee token: %w", err)
	}
	callerToken, err := s.generateToken(c.caller, s.lookupName(ctx, c.caller), roomName)
	if err != nil {
		return fmt.Errorf("call.Service.Accept: generate caller token: %w", err)
	}

	pipe := s.rdb.TxPipeline()
	pipe.HSet(ctx, callKey(channelID), "state", stateActive)
	pipe.Expire(ctx, callKey(channelID), activeTTL)
	pipe.Expire(ctx, userCallKey(c.caller), activeTTL)
	pipe.Expire(ctx, userCallKey(c.callee), activeTTL)
	if _, err := pipe.Exec(ctx); err != nil {
		return fmt.Errorf("call.Service.Accept: redis: %w", err)
	}

	s.notifier.NotifyUser(calleeID, "CALL_ACCEPT", CallAcceptEvent{ChannelID: channelID, Token: calleeToken, URL: wsURL})
	s.notifier.NotifyUser(c.caller, "CALL_ACCEPT", CallAcceptEvent{ChannelID: channelID, Token: callerToken, URL: wsURL})
	return nil
}

// Decline rejects the call: cleans up Redis and notifies the caller.
func (s *Service) Decline(ctx context.Context, channelID, calleeID string) error {
	if _, _, err := s.lookupDM(ctx, channelID, calleeID); err != nil {
		return err
	}
	c, err := s.loadCall(ctx, channelID)
	if err != nil {
		return err
	}
	if c == nil || c.state != stateRinging {
		return nil // already ended or timed out
	}
	if c.callee != calleeID {
		return fiber.NewError(fiber.StatusForbidden, "only the recipient can decline this call")
	}

	s.clearCall(ctx, channelID, c)
	s.notify(c.caller, "CALL_DECLINE", CallDeclineEvent{ChannelID: channelID})
	return nil
}

// End terminates a call (ringing or active): cleans up Redis and notifies both participants.
func (s *Service) End(ctx context.Context, channelID, userID string) error {
	a, b, err := s.lookupDM(ctx, channelID, userID)
	if err != nil {
		return err
	}

	c, err := s.loadCall(ctx, channelID)
	if err != nil {
		return err
	}
	s.clearCall(ctx, channelID, c)

	ev := CallEndEvent{ChannelID: channelID}
	s.notify(userID, "CALL_END", ev)
	s.notify(other(a, b, userID), "CALL_END", ev)
	return nil
}

// Keepalive extends an active call's lifetime. Returns 410 if the call is gone.
func (s *Service) Keepalive(ctx context.Context, channelID, userID string) error {
	if _, _, err := s.lookupDM(ctx, channelID, userID); err != nil {
		return err
	}
	c, err := s.loadCall(ctx, channelID)
	if err != nil {
		return err
	}
	if c == nil {
		return fiber.NewError(fiber.StatusGone, "call not found")
	}
	if c.state != stateActive {
		return nil
	}
	pipe := s.rdb.TxPipeline()
	pipe.Expire(ctx, callKey(channelID), activeTTL)
	pipe.Expire(ctx, userCallKey(c.caller), activeTTL)
	pipe.Expire(ctx, userCallKey(c.callee), activeTTL)
	if _, err := pipe.Exec(ctx); err != nil {
		return fmt.Errorf("call.Service.Keepalive: redis: %w", err)
	}
	return nil
}
