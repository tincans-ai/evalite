package main

import (
	"connectrpc.com/connect"
	connectcors "connectrpc.com/cors"
	"context"
	"fmt"
	"github.com/joho/godotenv"
	"github.com/rs/cors"
	"github.com/tincans-ai/evalite/gen/eval/v1/evalv1connect"
	"github.com/tincans-ai/evalite/packages/eval"
	"github.com/tincans-ai/evalite/packages/logutil"
	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"log/slog"
	"net/http"
	"os"
)

var logger *slog.Logger

// withCORS adds CORS support to a Connect HTTP handler.
func withCORS(h http.Handler) http.Handler {
	middleware := cors.New(cors.Options{
		AllowedOrigins: []string{"*"},
		AllowedMethods: connectcors.AllowedMethods(),
		AllowedHeaders: connectcors.AllowedHeaders(),
		ExposedHeaders: connectcors.ExposedHeaders(),
	})
	return middleware.Handler(h)
}

// NewLoggerInterceptor returns a new unary interceptor that logs requests with `slog`.
func NewLoggerInterceptor() connect.UnaryInterceptorFunc {
	interceptor := func(next connect.UnaryFunc) connect.UnaryFunc {
		return connect.UnaryFunc(func(
			ctx context.Context,
			req connect.AnyRequest,
		) (connect.AnyResponse, error) {
			ctx = logutil.ContextWithLogger(ctx, logger)
			res, err := next(ctx, req)
			if err != nil {
				slog.Error("error in request", "err", err)
			}
			return res, err
		})
	}
	return connect.UnaryInterceptorFunc(interceptor)
}

func main() {
	godotenv.Load()

	// set up logger
	lvl := new(slog.LevelVar)
	if os.Getenv("DEBUG") == "1" {
		lvl.Set(slog.LevelDebug)
	} else {
		lvl.Set(slog.LevelInfo)
	}

	logger = slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: lvl}))

	// db
	db, err := gorm.Open(sqlite.Open("test.db"), &gorm.Config{})
	if err != nil {
		panic("failed to connect database")
	}

	// Migrate the schema
	err = db.AutoMigrate(&eval.Workspace{}, &eval.Prompt{}, &eval.TestResult{},
		&eval.TestCase{}, &eval.WorkspaceConfig{}, &eval.SystemPrompt{})
	if err != nil {
		panic("failed to migrate schema")
	}

	server := eval.NewService(db)
	mux := http.NewServeMux()

	interceptors := connect.WithInterceptors(NewLoggerInterceptor())
	path, handler := evalv1connect.NewEvaluationServiceHandler(server, interceptors)
	mux.Handle(path, handler)
	fmt.Println("serving on :8080")
	http.ListenAndServe(
		"localhost:8080",
		// Use h2c so we can serve HTTP/2 without TLS.
		withCORS(h2c.NewHandler(mux, &http2.Server{})),
	)
}
