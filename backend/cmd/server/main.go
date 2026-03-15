package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/d0d012/diskord/pkg/config"
	"github.com/d0d012/diskord/pkg/db"
	pkgredis "github.com/d0d012/diskord/pkg/redis"
)

func main() {
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
	if os.Getenv("APP_ENV") != "production" {
		log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr})
	}

	cfg, err := config.Load()
	if err != nil {
		log.Fatal().Err(err).Msg("failed to load config")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pool, err := db.Connect(ctx, cfg.DB.DSN())
	if err != nil {
		log.Fatal().Err(err).Msg("failed to connect to database")
	}
	defer pool.Close()

	rdb, err := pkgredis.Connect(ctx, cfg.Redis.Addr(), cfg.Redis.Password)
	if err != nil {
		log.Fatal().Err(err).Msg("failed to connect to Redis")
	}
	defer rdb.Close()

	app := fiber.New(fiber.Config{
		AppName:      "diskord",
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  120 * time.Second,
	})

	app.Use(recover.New())
	app.Use(cors.New())

	app.Get("/health", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"data": "ok"})
	})

	// Domain routes will be registered here as they are implemented:
	// auth.RegisterRoutes(app, ...)
	// guild.RegisterRoutes(app, ...)
	// etc.

	go func() {
		addr := fmt.Sprintf(":%d", cfg.App.Port)
		log.Info().Str("addr", addr).Str("env", cfg.App.Env).Msg("starting server")
		if err := app.Listen(addr); err != nil {
			log.Fatal().Err(err).Msg("server failed")
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Info().Msg("shutting down server")
	if err := app.ShutdownWithTimeout(30 * time.Second); err != nil {
		log.Error().Err(err).Msg("server forced to shutdown")
	}
}
