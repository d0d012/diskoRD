package config

import (
	"fmt"
	"time"

	"github.com/spf13/viper"
)

type Config struct {
	App      AppConfig
	DB       DBConfig
	Redis    RedisConfig
	JWT      JWTConfig
	LiveKit  LiveKitConfig
	Turn     TurnConfig
	Storage  StorageConfig
}

type AppConfig struct {
	Env  string
	Port int
}

type DBConfig struct {
	Host     string
	Port     int
	User     string
	Password string
	Name     string
	SSLMode  string
}

func (d DBConfig) DSN() string {
	return fmt.Sprintf(
		"postgres://%s:%s@%s:%d/%s?sslmode=%s",
		d.User, d.Password, d.Host, d.Port, d.Name, d.SSLMode,
	)
}

type RedisConfig struct {
	Host     string
	Port     int
	Password string
}

func (r RedisConfig) Addr() string {
	return fmt.Sprintf("%s:%d", r.Host, r.Port)
}

type JWTConfig struct {
	AccessSecret  string
	RefreshSecret string
	AccessExpiry  time.Duration
	RefreshExpiry time.Duration
}

type LiveKitConfig struct {
	Host      string
	Port      int
	APIKey    string
	APISecret string
	PublicURL string // e.g. wss://diskord.ahmertezcan.com — overrides ws://Host:Port for clients
}

type TurnConfig struct {
	Host     string
	Port     int
	Username string
	Password string
}

type StorageConfig struct {
	Driver string
	Path   string
}

func Load() (*Config, error) {
	viper.SetConfigFile(".env")
	viper.AutomaticEnv()

	// Defaults matching .env.example for local Docker dev
	viper.SetDefault("APP_ENV", "development")
	viper.SetDefault("APP_PORT", 8080)

	viper.SetDefault("DB_HOST", "localhost")
	viper.SetDefault("DB_PORT", 5433)
	viper.SetDefault("DB_USER", "diskord")
	viper.SetDefault("DB_PASSWORD", "diskord")
	viper.SetDefault("DB_NAME", "diskord")
	viper.SetDefault("DB_SSLMODE", "disable")

	viper.SetDefault("REDIS_HOST", "localhost")
	viper.SetDefault("REDIS_PORT", 6380)
	viper.SetDefault("REDIS_PASSWORD", "")

	viper.SetDefault("JWT_ACCESS_SECRET", "dev-access-secret-change-in-production")
	viper.SetDefault("JWT_REFRESH_SECRET", "dev-refresh-secret-change-in-production")
	viper.SetDefault("JWT_ACCESS_EXPIRY", "15m")
	viper.SetDefault("JWT_REFRESH_EXPIRY", "8760h")

	viper.SetDefault("LIVEKIT_HOST", "localhost")
	viper.SetDefault("LIVEKIT_PORT", 7880)
	viper.SetDefault("LIVEKIT_API_KEY", "devkey")
	viper.SetDefault("LIVEKIT_API_SECRET", "devsecret")
	viper.SetDefault("LIVEKIT_PUBLIC_URL", "")

	viper.SetDefault("TURN_HOST", "localhost")
	viper.SetDefault("TURN_PORT", 3478)
	viper.SetDefault("TURN_USERNAME", "diskord")
	viper.SetDefault("TURN_PASSWORD", "diskord")

	viper.SetDefault("STORAGE_DRIVER", "local")
	viper.SetDefault("STORAGE_PATH", "./uploads")

	// .env file is optional — defaults are sufficient for local dev
	_ = viper.ReadInConfig()

	accessExpiry, err := time.ParseDuration(viper.GetString("JWT_ACCESS_EXPIRY"))
	if err != nil {
		return nil, fmt.Errorf("config: invalid JWT_ACCESS_EXPIRY: %w", err)
	}
	refreshExpiry, err := time.ParseDuration(viper.GetString("JWT_REFRESH_EXPIRY"))
	if err != nil {
		return nil, fmt.Errorf("config: invalid JWT_REFRESH_EXPIRY: %w", err)
	}

	return &Config{
		App: AppConfig{
			Env:  viper.GetString("APP_ENV"),
			Port: viper.GetInt("APP_PORT"),
		},
		DB: DBConfig{
			Host:     viper.GetString("DB_HOST"),
			Port:     viper.GetInt("DB_PORT"),
			User:     viper.GetString("DB_USER"),
			Password: viper.GetString("DB_PASSWORD"),
			Name:     viper.GetString("DB_NAME"),
			SSLMode:  viper.GetString("DB_SSLMODE"),
		},
		Redis: RedisConfig{
			Host:     viper.GetString("REDIS_HOST"),
			Port:     viper.GetInt("REDIS_PORT"),
			Password: viper.GetString("REDIS_PASSWORD"),
		},
		JWT: JWTConfig{
			AccessSecret:  viper.GetString("JWT_ACCESS_SECRET"),
			RefreshSecret: viper.GetString("JWT_REFRESH_SECRET"),
			AccessExpiry:  accessExpiry,
			RefreshExpiry: refreshExpiry,
		},
		LiveKit: LiveKitConfig{
			Host:      viper.GetString("LIVEKIT_HOST"),
			Port:      viper.GetInt("LIVEKIT_PORT"),
			APIKey:    viper.GetString("LIVEKIT_API_KEY"),
			APISecret: viper.GetString("LIVEKIT_API_SECRET"),
			PublicURL: viper.GetString("LIVEKIT_PUBLIC_URL"),
		},
		Turn: TurnConfig{
			Host:     viper.GetString("TURN_HOST"),
			Port:     viper.GetInt("TURN_PORT"),
			Username: viper.GetString("TURN_USERNAME"),
			Password: viper.GetString("TURN_PASSWORD"),
		},
		Storage: StorageConfig{
			Driver: viper.GetString("STORAGE_DRIVER"),
			Path:   viper.GetString("STORAGE_PATH"),
		},
	}, nil
}
