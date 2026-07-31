package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/spf13/cobra"
	"github.com/spf13/viper"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"

	server "github.com/fara15/cdp-relay/internal/server"
	"github.com/fara15/cdp-relay/internal/ratelimit"
)

var (
	logger *zap.Logger
	rootCmd = &cobra.Command{
		Use:   "cdp-relay",
		Short: "CDP Relay - High-throughput relay broker for Chrome DevTools Protocol",
		Long: `CDP Relay provides authenticated WebSocket tunnel between server
and client browsers for server-hosted browser automation.

Features:
- TLS-only connections with mutual TLS support
- Session routing and channel management
- Heartbeats and connection liveliness
- Backpressure handling
- Immediate revocation capability
- Protocol version negotiation
- Replay protection with sequence numbers
- Per-session rate limiting`,
		PersistentPreRun: func(cmd *cobra.Command, args []string) {
			initLogger()
		},
		Run: func(cmd *cobra.Command, args []string) {
			runServer()
		},
	}
)

func init() {
	rootCmd.PersistentFlags().String("address", "127.0.0.1:8080", "Server address to listen on")
	rootCmd.PersistentFlags().String("tls-cert", "", "TLS certificate file")
	rootCmd.PersistentFlags().String("tls-key", "", "TLS private key file")
	rootCmd.PersistentFlags().String("tls-ca", "", "CA certificate for mTLS")
	rootCmd.PersistentFlags().Bool("mtls", false, "Enable mutual TLS")
	rootCmd.PersistentFlags().Duration("session-lease", 5*time.Minute, "Default session lease duration")
	rootCmd.PersistentFlags().Duration("heartbeat-interval", 30*time.Second, "Heartbeat interval")
	rootCmd.PersistentFlags().Int64("max-message-size", 10*1024*1024, "Maximum message size in bytes")
	rootCmd.PersistentFlags().Float64("rate-limit-tps", 1000, "Rate limit tokens per second")
	rootCmd.PersistentFlags().Int64("rate-limit-burst", 100, "Rate limit burst size")
	rootCmd.PersistentFlags().String("log-level", "info", "Log level (debug, info, warn, error)")

	viper.BindPFlag("address", rootCmd.PersistentFlags().Lookup("address"))
	viper.BindPFlag("tls.cert", rootCmd.PersistentFlags().Lookup("tls-cert"))
	viper.BindPFlag("tls.key", rootCmd.PersistentFlags().Lookup("tls-key"))
	viper.BindPFlag("tls.ca", rootCmd.PersistentFlags().Lookup("tls-ca"))
	viper.BindPFlag("tls.mtls", rootCmd.PersistentFlags().Lookup("mtls"))
	viper.BindPFlag("session_lease", rootCmd.PersistentFlags().Lookup("session-lease"))
	viper.BindPFlag("heartbeat_interval", rootCmd.PersistentFlags().Lookup("heartbeat-interval"))
	viper.BindPFlag("max_message_size", rootCmd.PersistentFlags().Lookup("max-message-size"))
	viper.BindPFlag("rate_limit.tps", rootCmd.PersistentFlags().Lookup("rate-limit-tps"))
	viper.BindPFlag("rate_limit.burst", rootCmd.PersistentFlags().Lookup("rate-limit-burst"))
	viper.BindPFlag("log.level", rootCmd.PersistentFlags().Lookup("log-level"))

	viper.SetEnvPrefix("CDP_RELAY")
	viper.AutomaticEnv()
}

func initLogger() {
	var level zapcore.Level
	switch viper.GetString("log.level") {
	case "debug":
		level = zapcore.DebugLevel
	case "info":
		level = zapcore.InfoLevel
	case "warn":
		level = zapcore.WarnLevel
	case "error":
		level = zapcore.ErrorLevel
	default:
		level = zapcore.InfoLevel
	}

	config := zap.Config{
		Level:       zap.NewAtomicLevelAt(level),
		Development: false,
		Encoding:    "json",
		EncoderConfig: zapcore.EncoderConfig{
			TimeKey:        "ts",
			LevelKey:       "level",
			NameKey:        "logger",
			CallerKey:      "caller",
			FunctionKey:    zapcore.OmitKey,
			MessageKey:     "msg",
			StacktraceKey:  "stacktrace",
			LineEnding:     zapcore.DefaultLineEnding,
			EncodeLevel:    zapcore.LowercaseLevelEncoder,
			EncodeTime:     zapcore.ISO8601TimeEncoder,
			EncodeDuration: zapcore.SecondsDurationEncoder,
			EncodeCaller:   zapcore.ShortCallerEncoder,
		},
		OutputPaths:      []string{"stderr"},
		ErrorOutputPaths: []string{"stderr"},
	}

	var err error
	logger, err = config.Build()
	if err != nil {
		panic(fmt.Sprintf("Failed to initialize logger: %v", err))
	}
}

func runServer() {
	address := viper.GetString("address")

	var tlsConfig *server.TLSConfig
	if viper.GetString("tls.cert") != "" && viper.GetString("tls.key") != "" {
		tlsConfig = &server.TLSConfig{
			CertFile:   viper.GetString("tls.cert"),
			KeyFile:    viper.GetString("tls.key"),
			CAFile:     viper.GetString("tls.ca"),
			MTLSEnabled: viper.GetBool("tls.mtls"),
		}
	}

	rateLimitConfig := ratelimit.Config{
		TokensPerSecond: viper.GetFloat64("rate_limit.tps"),
		BurstSize:       viper.GetInt64("rate_limit.burst"),
		WindowSizeMs:    1000,
	}

	cfg := server.Config{
		Address:           address,
		TLS:               tlsConfig,
		SessionLease:      viper.GetDuration("session_lease"),
		HeartbeatInterval: viper.GetDuration("heartbeat_interval"),
		MaxMessageSize:    viper.GetInt64("max_message_size"),
		RateLimitConfig:   rateLimitConfig,
	}

	srv := server.NewServer(cfg, logger)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Handle shutdown signals
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		if err := srv.Start(ctx); err != nil && err != http.ErrServerClosed {
			logger.Fatal("Server failed", zap.Error(err))
		}
	}()

	logger.Info("CDP Relay server started",
		zap.String("address", address),
		zap.Bool("tls", tlsConfig != nil),
		zap.Duration("session_lease", cfg.SessionLease),
		zap.Duration("heartbeat_interval", cfg.HeartbeatInterval),
	)

	// Wait for shutdown signal
	<-sigCh
	logger.Info("Shutting down server...")

	cancel()

	if err := srv.Stop(); err != nil {
		logger.Error("Server shutdown error", zap.Error(err))
	}

	logger.Info("Server stopped")
}

func main() {
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
