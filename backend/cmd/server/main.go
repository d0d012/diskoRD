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

	"github.com/d0d012/diskord/internal/auth"
	"github.com/d0d012/diskord/internal/call"
	"github.com/d0d012/diskord/internal/channel"
	"github.com/d0d012/diskord/internal/friend"
	"github.com/d0d012/diskord/internal/gateway"
	"github.com/d0d012/diskord/internal/guild"
	"github.com/d0d012/diskord/internal/invite"
	"github.com/d0d012/diskord/internal/linkpreview"
	"github.com/d0d012/diskord/internal/message"
	"github.com/d0d012/diskord/internal/presence"
	"github.com/d0d012/diskord/internal/reaction"
	"github.com/d0d012/diskord/internal/role"
	"github.com/d0d012/diskord/internal/soundboard"
	"github.com/d0d012/diskord/internal/storage"
	"github.com/d0d012/diskord/internal/user"
	"github.com/d0d012/diskord/internal/voice"
	"github.com/d0d012/diskord/pkg/config"
	"github.com/d0d012/diskord/pkg/db"
	"github.com/d0d012/diskord/pkg/middleware"
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
		BodyLimit:    12 * 1024 * 1024, // headroom over the 8MB upload limit for multipart framing
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  120 * time.Second,
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			msg := "internal server error"
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
				msg = e.Message
			} else {
				log.Error().Err(err).Str("method", c.Method()).Str("path", c.Path()).Msg("unhandled error")
			}
			return c.Status(code).JSON(fiber.Map{"error": msg})
		},
	})

	app.Use(recover.New())
	app.Use(cors.New())

	app.Get("/health", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"data": "ok"})
	})

	authRepo := auth.NewRepository(pool)
	authService := auth.NewService(authRepo, rdb, cfg.JWT)
	authHandler := auth.NewHandler(authService)
	authMw := auth.AuthMiddleware(authService)
	auth.RegisterRoutes(app, authHandler, auth.RouteConfig{
		AuthMiddleware:    authMw,
		LoginRateLimit:    middleware.RateLimit(rdb, middleware.RateLimitConfig{Max: 5, Window: time.Minute}),
		RegisterRateLimit: middleware.RateLimit(rdb, middleware.RateLimitConfig{Max: 3, Window: time.Minute}),
	})

	presenceSvc := presence.NewService(rdb)
	hub := gateway.NewHub(rdb, pool, presenceSvc)

	appBaseURL := fmt.Sprintf("http://localhost:%d", cfg.App.Port)
	if cfg.App.Env == "production" {
		appBaseURL = "" // nginx serves /uploads directly; relative URL is fine
	}
	storageSvc := storage.NewService(cfg.Storage.Path, appBaseURL)

	userRepo := user.NewRepository(pool)
	userService := user.NewService(userRepo, storageSvc)
	userService.SetPublisher(hub)
	userHandler := user.NewHandler(userService)
	user.RegisterRoutes(app, userHandler, authMw,
		middleware.RateLimit(rdb, middleware.RateLimitConfig{Max: 10, Window: time.Minute}))

	guildRepo := guild.NewRepository(pool)
	guildService := guild.NewService(guildRepo, presenceSvc)
	guildService.SetIconStorage(storageSvc)
	guildHandler := guild.NewHandler(guildService)
	guild.RegisterRoutes(app, guildHandler, authMw, pool,
		middleware.RateLimit(rdb, middleware.RateLimitConfig{Max: 10, Window: time.Minute}))

	channelRepo := channel.NewRepository(pool)
	channelService := channel.NewService(channelRepo, guildRepo)
	channelHandler := channel.NewHandler(channelService)
	channel.RegisterRoutes(app, channelHandler, authMw, pool)

	inviteRepo := invite.NewRepository(pool)
	inviteService := invite.NewService(inviteRepo, guildRepo)
	inviteHandler := invite.NewHandler(inviteService)
	invite.RegisterRoutes(app, inviteHandler, authMw, pool)

	friendRepo := friend.NewRepository(pool)
	friendService := friend.NewService(friendRepo, presenceSvc)
	friendHandler := friend.NewHandler(friendService)
	friend.RegisterRoutes(app, friendHandler, authMw)

	guildService.SetPublisher(hub)
	channelService.SetPublisher(hub)
	inviteService.SetNotifier(hub)
	serverCtx, serverCancel := context.WithCancel(context.Background())
	defer serverCancel()
	go hub.Run(serverCtx)

	soundService := soundboard.NewService(soundboard.NewRepository(pool), guildRepo, hub)
	soundboard.RegisterRoutes(app, soundboard.NewHandler(soundService), authMw,
		middleware.RateLimit(rdb, middleware.RateLimitConfig{Max: 10, Window: time.Minute}))

	friendService.SetNotifier(hub)

	callSvc := call.NewService(pool, rdb, cfg.LiveKit, friendRepo)
	callSvc.SetNotifier(hub)
	callHandler := call.NewHandler(callSvc)
	call.RegisterRoutes(app, callHandler, authMw)

	msgRepo := message.NewRepository(pool)
	msgService := message.NewService(msgRepo, guildRepo)
	msgService.SetPublisher(hub)
	msgHandler := message.NewHandler(msgService)
	msgHandler.SetStorage(storageSvc)
	message.RegisterRoutes(app, msgHandler, authMw)

	// Serve uploaded files
	app.Static("/uploads", cfg.Storage.Path)

	voiceSvc := voice.NewService(pool, channelRepo, guildRepo, rdb, cfg.LiveKit)
	voiceSvc.SetPublisher(hub)
	voiceHandler := voice.NewHandler(voiceSvc)
	voice.RegisterRoutes(app, voiceHandler, authMw)

	reactionRepo := reaction.NewRepository(pool)
	reactionService := reaction.NewService(reactionRepo, guildRepo)
	reactionService.SetPublisher(hub)
	reactionHandler := reaction.NewHandler(reactionService)
	reaction.RegisterRoutes(app, reactionHandler, authMw)

	roleRepo := role.NewRepository(pool)
	roleService := role.NewService(roleRepo, guildRepo)
	roleService.SetPublisher(hub)
	roleHandler := role.NewHandler(roleService)
	role.RegisterRoutes(app, roleHandler, authMw)

	linkpreview.RegisterRoutes(app, authMw)

	gatewayHandler := gateway.NewHandler(hub, authService)
	gateway.RegisterRoutes(app, gatewayHandler)

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
