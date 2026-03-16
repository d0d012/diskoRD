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

	return s.generateTokens(ctx, user)
}

func (s *Service) Login(ctx context.Context, req LoginRequest) (*AuthResponse, error) {
	user, err := s.repo.GetUserByEmail(ctx, strings.ToLower(req.Email))
	if err != nil {
		return nil, err
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		return nil, fiber.NewError(fiber.StatusUnauthorized, "invalid email or password")
	}

	return s.generateTokens(ctx, user)
}

func (s *Service) RefreshToken(ctx context.Context, refreshToken string) (*AuthResponse, error) {
	tokenHash := hashToken(refreshToken)
	userID, err := s.rdb.Get(ctx, "refresh:"+tokenHash).Result()
	if err == redis.Nil {
		return nil, fiber.NewError(fiber.StatusUnauthorized, "invalid or expired refresh token")
	}
	if err != nil {
		return nil, fmt.Errorf("auth.Service.RefreshToken: redis get: %w", err)
	}

	// Delete old refresh token
	s.rdb.Del(ctx, "refresh:"+tokenHash)

	user, err := s.repo.GetUserByID(ctx, userID)
	if err != nil {
		return nil, err
	}

	return s.generateTokens(ctx, user)
}

func (s *Service) Logout(ctx context.Context, refreshToken string) error {
	tokenHash := hashToken(refreshToken)
	s.rdb.Del(ctx, "refresh:"+tokenHash)
	return nil
}

func (s *Service) generateTokens(ctx context.Context, user *User) (*AuthResponse, error) {
	accessToken, err := s.createAccessToken(user)
	if err != nil {
		return nil, fmt.Errorf("auth.Service.generateTokens: access token: %w", err)
	}

	refreshToken, err := s.createRefreshToken(ctx, user.ID)
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

func (s *Service) createRefreshToken(ctx context.Context, userID string) (string, error) {
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return "", err
	}
	token := hex.EncodeToString(tokenBytes)

	tokenHash := hashToken(token)
	err := s.rdb.Set(ctx, "refresh:"+tokenHash, userID, s.jwtCfg.RefreshExpiry).Err()
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
