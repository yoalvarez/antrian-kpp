package main

import (
	"context"
	"embed"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
	"time"

	"queue-system/internal/config"
	"queue-system/internal/database"
	"queue-system/internal/handlers"
	"queue-system/internal/sse"
)

//go:embed web/templates/*.html
var templatesFS embed.FS

//go:embed web/static/css/*.css
var cssFS embed.FS

//go:embed web/static/js/*.js
var jsFS embed.FS

//go:embed all:web
var webFS embed.FS

func main() {
	configPath := flag.String("config", "config.yaml", "Path to config file")
	flag.Parse()

	// Ensure config exists
	if _, err := os.Stat(*configPath); os.IsNotExist(err) {
		log.Printf("Config file not found at %s. Creating default config...", *configPath)
		defaultCfg := config.DefaultConfig()
		
		// Create directory if needed (e.g. if path is configs/config.yaml)
		configDir := filepath.Dir(*configPath)
		if configDir != "." {
			os.MkdirAll(configDir, 0755)
		}

		if err := defaultCfg.Save(*configPath); err != nil {
			log.Printf("Warning: Failed to create default config: %v", err)
		} else {
			log.Println("Default config created successfully.")
		}
	}

	// Load config
	cfg, err := config.Load(*configPath)
	if err != nil {
		log.Printf("Warning: Failed to load config from %s: %v", *configPath, err)
		log.Println("Using default configuration")
		cfg = config.DefaultConfig()
	}

	// Setup logging
	log.SetFlags(log.LstdFlags | log.Lshortfile)
	log.Printf("Starting Queue System...")
	log.Printf("Server will listen on %s:%d", cfg.Server.Host, cfg.Server.Port)

	// Initialize database
	db, err := database.New(cfg)
	if err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()
	log.Println("Database initialized successfully")

	// Initialize SSE hub
	hub := sse.NewHub()
	log.Println("SSE hub initialized")

	// Initialize handlers
	h, err := handlers.New(db, hub, cfg, webFS)
	if err != nil {
		log.Fatalf("Failed to initialize handlers: %v", err)
	}

	// Setup routes
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	// Create server
	server := &http.Server{
		Addr:         fmt.Sprintf("%s:%d", cfg.Server.Host, cfg.Server.Port),
		Handler:      loggingMiddleware(mux),
		ReadTimeout:  cfg.Server.ReadTimeout,
		WriteTimeout: 0, // Disable write timeout for SSE support
	}

	// Start server in goroutine
	go func() {
		addr := fmt.Sprintf("http://%s:%d", cfg.Server.Host, cfg.Server.Port)
		if cfg.Server.Host == "0.0.0.0" {
			addr = fmt.Sprintf("http://localhost:%d", cfg.Server.Port)
		}
		
		log.Printf("Server started at %s", addr)
		log.Printf("  Admin:   %s/admin", addr)
		log.Printf("  Display: %s/display", addr)

		// Auto-open browser
		go func() {
			time.Sleep(1 * time.Second) // Give server a moment to start
			log.Println("Opening browser...")
			openBrowser(addr + "/admin")
		}()

		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server failed: %v", err)
		}
	}()

	// Start background cleanup task
	go func() {
		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()

		for range ticker.C {
			if cfg.Queue.AutoCancelHours > 0 {
				affected, err := db.CancelOldQueues(cfg.Queue.AutoCancelHours)
				if err != nil {
					log.Printf("Failed to cancel old queues: %v", err)
				} else if affected > 0 {
					log.Printf("Auto-cancelled %d old queues", affected)
				}
			}
		}
	}()

	// Wait for shutdown signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down server...")

	// Graceful shutdown with timeout
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		log.Printf("Server forced to shutdown: %v", err)
	}

	log.Println("Server stopped")
}

func openBrowser(url string) {
	var err error
	switch runtime.GOOS {
	case "linux":
		err = exec.Command("xdg-open", url).Start()
	case "windows":
		err = exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	case "darwin":
		err = exec.Command("open", url).Start()
	default:
		err = fmt.Errorf("unsupported platform")
	}
	if err != nil {
		log.Printf("Failed to open browser: %v", err)
	}
}

func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()

		// Wrap response writer to capture status code
		wrapped := &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}

		next.ServeHTTP(wrapped, r)

		// Skip logging for static files and SSE
		if len(r.URL.Path) > 7 && r.URL.Path[:7] == "/static" {
			return
		}
		if len(r.URL.Path) > 8 && r.URL.Path[:8] == "/api/sse" {
			return
		}

		log.Printf("%s %s %d %v", r.Method, r.URL.Path, wrapped.statusCode, time.Since(start))
	})
}

type responseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (w *responseWriter) WriteHeader(code int) {
	w.statusCode = code
	w.ResponseWriter.WriteHeader(code)
}

func (w *responseWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}
