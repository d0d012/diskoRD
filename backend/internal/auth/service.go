package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog/log"
	"golang.org/x/crypto/bcrypt"

	"github.com/d0d012/diskord/pkg/config"
)

const (
	// refreshGrace is how long a rotated refresh token stays valid after use.
	refreshGrace = 30 * time.Second
	// sessionRefreshTTL applies when the user did not tick "keep me logged in".
	sessionRefreshTTL = 24 * time.Hour
)

// parseRefreshValue splits the stored value into user id and remember flag.
// Legacy values (plain user id) are treated as remembered sessions.
func parseRefreshValue(v string) (userID string, remember bool) {
	if id, ok := strings.CutSuffix(v, "|s"); ok {
		return id, false
	}
	return v, true
}

type Service struct {
	repo   *Repository
	rdb    *redis.Client
	jwtCfg config.JWTConfig
}

func NewService(repo *Repository, rdb *redis.Client, jwtCfg config.JWTConfig) *Service {
	return &Service{repo: repo, rdb: rdb, jwtCfg: jwtCfg}
}

func (s *Service) Register(ctx context.Context, req RegisterRequest) (*AuthResponse, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), 12)
	if err != nil {
		return nil, fmt.Errorf("auth.Service.Register: hash password: %w", err)
	}

	user, err := s.repo.CreateUser(ctx, req.Username, strings.ToLower(req.Email), string(hash))
	if err != nil {
		if strings.Contains(err.Error(), "duplicate key") {
			if strings.Contains(err.Error(), "username") {
				return nil, fiber.NewError(fiber.StatusConflict, "username already taken")
			}
			return nil, fiber.NewError(fiber.StatusConflict, "email already registered")
		}
		log.Error().Err(err).Msg("failed to create user")
		return nil, fiber.NewError(fiber.StatusInternalServerError, "failed to create account")
	}

	return s.generateTokens(ctx, user, true)
}

func (s *Service) Login(ctx context.Context, req LoginRequest) (*AuthResponse, error) {
	user, err := s.repo.GetUserByEmail(ctx, strings.ToLower(req.Email))
	if err != nil {
		return nil, err
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		return nil, fiber.NewError(fiber.StatusUnauthorized, "invalid email or password")
	}

	return s.generateTokens(ctx, user, req.RememberMe == nil || *req.RememberMe)
}

func (s *Service) RefreshToken(ctx context.Context, refreshToken string) (*AuthResponse, error) {
	tokenHash := hashToken(refreshToken)
	val, err := s.rdb.Get(ctx, "refresh:"+tokenHash).Result()
	if err == redis.Nil {
		return nil, fiber.NewError(fiber.StatusUnauthorized, "invalid or expired refresh token")
	}
	if err != nil {
		return nil, fmt.Errorf("auth.Service.RefreshToken: redis get: %w", err)
	}
	userID, remember := parseRefreshValue(val)

	// Rotate, but keep the old token alive for a short grace window so a lost
	// response or two racing clients don't invalidate the session.
	if err := s.rdb.ExpireLT(ctx, "refresh:"+tokenHash, refreshGrace).Err(); err != nil {
		log.Warn().Err(err).Msg("auth: failed to shorten old refresh token TTL")
	}

	user, err := s.repo.GetUserByID(ctx, userID)
	if err != nil {
		return nil, err
	}

	return s.generateTokens(ctx, user, remember)
}

func (s *Service) Logout(ctx context.Context, refreshToken string) error {
	tokenHash := hashToken(refreshToken)
	s.rdb.Del(ctx, "refresh:"+tokenHash)
	return nil
}

func (s *Service) generateTokens(ctx context.Context, user *User, remember bool) (*AuthResponse, error) {
	accessToken, err := s.createAccessToken(user)
	if err != nil {
		return nil, fmt.Errorf("auth.Service.generateTokens: access token: %w", err)
	}

	refreshToken, err := s.createRefreshToken(ctx, user.ID, remember)
	if err != nil {
		return nil, fmt.Errorf("auth.Service.generateTokens: refresh token: %w", err)
	}

	return &AuthResponse{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		User:         user.ToResponse(true),
	}, nil
}

func (s *Service) createAccessToken(user *User) (string, error) {
	claims := jwt.MapClaims{
		"sub":      user.ID,
		"username": user.Username,
		"exp":      time.Now().Add(s.jwtCfg.AccessExpiry).Unix(),
		"iat":      time.Now().Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(s.jwtCfg.AccessSecret))
}

func (s *Service) createRefreshToken(ctx context.Context, userID string, remember bool) (string, error) {
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return "", err
	}
	token := hex.EncodeToString(tokenBytes)

	tokenHash := hashToken(token)
	value, ttl := userID, s.jwtCfg.RefreshExpiry
	if !remember {
		value, ttl = userID+"|s", sessionRefreshTTL
	}
	err := s.rdb.Set(ctx, "refresh:"+tokenHash, value, ttl).Err()
	if err != nil {
		return "", fmt.Errorf("auth.Service.createRefreshToken: redis set: %w", err)
	}

	return token, nil
}

func (s *Service) ValidateAccessToken(tokenString string) (jwt.MapClaims, error) {
	token, err := jwt.Parse(tokenString, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return []byte(s.jwtCfg.AccessSecret), nil
	})
	if err != nil {
		return nil, err
	}
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid token claims")
	}
	return claims, nil
}

func hashToken(token string) string {
	h := sha256.Sum256([]byte(token))
	return hex.EncodeToString(h[:])
}
