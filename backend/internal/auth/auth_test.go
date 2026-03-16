package auth

import (
	"testing"
	"time"

	"github.com/d0d012/diskord/pkg/config"
	"github.com/go-playground/validator/v10"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"
)

var testJWTConfig = config.JWTConfig{
	AccessSecret:  "test-access-secret-for-unit-tests",
	RefreshSecret: "test-refresh-secret-for-unit-tests",
	AccessExpiry:  15 * time.Minute,
	RefreshExpiry: 7 * 24 * time.Hour,
}

func TestPasswordHashing(t *testing.T) {
	password := "mysecretpassword"
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	require.NoError(t, err)

	t.Run("correct password matches", func(t *testing.T) {
		err := bcrypt.CompareHashAndPassword(hash, []byte(password))
		assert.NoError(t, err)
	})

	t.Run("wrong password does not match", func(t *testing.T) {
		err := bcrypt.CompareHashAndPassword(hash, []byte("wrongpassword"))
		assert.Error(t, err)
	})
}

func TestAccessTokenRoundTrip(t *testing.T) {
	svc := &Service{jwtCfg: testJWTConfig}
	user := &User{ID: "test-uuid-123", Username: "testuser"}

	token, err := svc.createAccessToken(user)
	require.NoError(t, err)
	assert.NotEmpty(t, token)

	claims, err := svc.ValidateAccessToken(token)
	require.NoError(t, err)
	assert.Equal(t, "test-uuid-123", claims["sub"])
	assert.Equal(t, "testuser", claims["username"])
}

func TestAccessTokenExpired(t *testing.T) {
	svc := &Service{
		jwtCfg: config.JWTConfig{
			AccessSecret: testJWTConfig.AccessSecret,
			AccessExpiry: -1 * time.Second, // already expired
		},
	}
	user := &User{ID: "test-uuid-123", Username: "testuser"}

	token, err := svc.createAccessToken(user)
	require.NoError(t, err)

	_, err = svc.ValidateAccessToken(token)
	assert.Error(t, err)
}

func TestAccessTokenWrongSecret(t *testing.T) {
	svc := &Service{jwtCfg: testJWTConfig}
	user := &User{ID: "test-uuid-123", Username: "testuser"}

	token, err := svc.createAccessToken(user)
	require.NoError(t, err)

	wrongSvc := &Service{
		jwtCfg: config.JWTConfig{AccessSecret: "completely-different-secret"},
	}
	_, err = wrongSvc.ValidateAccessToken(token)
	assert.Error(t, err)
}

func TestHashToken(t *testing.T) {
	token := "some-refresh-token"
	hash1 := hashToken(token)
	hash2 := hashToken(token)
	assert.Equal(t, hash1, hash2, "same input should produce same hash")

	differentHash := hashToken("different-token")
	assert.NotEqual(t, hash1, differentHash, "different input should produce different hash")
}

func TestUserToResponse(t *testing.T) {
	displayName := "Test User"
	user := &User{
		ID:          "uuid-1",
		Username:    "testuser",
		Email:       "test@example.com",
		DisplayName: &displayName,
		Status:      "online",
		CreatedAt:   time.Now(),
	}

	t.Run("with email", func(t *testing.T) {
		resp := user.ToResponse(true)
		assert.Equal(t, "test@example.com", resp.Email)
	})

	t.Run("without email", func(t *testing.T) {
		resp := user.ToResponse(false)
		assert.Empty(t, resp.Email)
	})
}

func TestFormatValidationError(t *testing.T) {
	v := validator.New() //nolint:all

	t.Run("missing required field", func(t *testing.T) {
		req := RegisterRequest{}
		err := v.Struct(req)
		msg := formatValidationError(err)
		assert.Contains(t, msg, "is required")
	})

	t.Run("invalid email", func(t *testing.T) {
		req := RegisterRequest{Username: "test", Email: "notanemail", Password: "12345678"}
		err := v.Struct(req)
		msg := formatValidationError(err)
		assert.Equal(t, "invalid email format", msg)
	})

	t.Run("password too short", func(t *testing.T) {
		req := RegisterRequest{Username: "test", Email: "test@test.com", Password: "short"}
		err := v.Struct(req)
		msg := formatValidationError(err)
		assert.Contains(t, msg, "at least")
	})
}
