package handlers

import (
	"database/sql"
	"embed"
	"encoding/json"
	"fmt"
	"html/template"
	"io/fs"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"queue-system/internal/config"
	"queue-system/internal/database"
	"queue-system/internal/models"
	"queue-system/internal/printer"
	"queue-system/internal/sse"
)

type Handler struct {
	db       *database.DB
	hub      *sse.Hub
	config   *config.Config
	tmpl     *template.Template
	staticFS fs.FS
	printer  *printer.Printer
}

func New(db *database.DB, hub *sse.Hub, cfg *config.Config, webFS embed.FS) (*Handler, error) {
	tmpl, err := template.ParseFS(webFS, "web/templates/*.html")
	if err != nil {
		return nil, fmt.Errorf("failed to parse templates: %w", err)
	}

	staticFS, err := fs.Sub(webFS, "web/static")
	if err != nil {
		return nil, fmt.Errorf("failed to get static fs: %w", err)
	}

	// Initialize printer
	printerInstance := printer.New(printer.PrinterConfig{
		Enabled:     cfg.Printer.Enabled,
		PrinterName: cfg.Printer.PrinterName,
	})

	return &Handler{
		db:       db,
		hub:      hub,
		config:   cfg,
		tmpl:     tmpl,
		staticFS: staticFS,
		printer:  printerInstance,
	}, nil
}

func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	// Static files with caching
	staticHandler := http.StripPrefix("/static/", http.FileServer(http.FS(h.staticFS)))
	mux.Handle("/static/", h.cacheMiddleware(staticHandler))

	// Pages
	mux.HandleFunc("/", h.handleIndex)
	mux.HandleFunc("/admin", h.handleAdmin)
	mux.HandleFunc("/display", h.handleDisplay)
	mux.HandleFunc("/ticket", h.handleTicket)
	mux.HandleFunc("/counters", h.handleCountersPage)
	mux.HandleFunc("/counter/", h.handleCounter)
	mux.HandleFunc("/health", h.handleHealth)

	// API - Queues
	mux.HandleFunc("/api/queues", h.handleQueues)
	mux.HandleFunc("/api/queues/take", h.handleTakeQueue)

	// API - Queue Types
	mux.HandleFunc("/api/queue-types", h.handleQueueTypes)
	mux.HandleFunc("/api/queue-type/", h.handleQueueTypeAPI)

	// API - Counters
	mux.HandleFunc("/api/counters", h.handleCounters)
	mux.HandleFunc("/api/counter/", h.handleCounterAPI)

	// API - Stats
	mux.HandleFunc("/api/stats", h.handleStats)
	mux.HandleFunc("/api/stats/by-type", h.handleStatsByType)

	// API - Settings
	mux.HandleFunc("/api/settings", h.handleSettings)

	// API - Admin
	mux.HandleFunc("/api/admin/reset-queues", h.handleResetQueues)

	// API - Reports
	mux.HandleFunc("/api/report", h.handleReport)
	mux.HandleFunc("/api/report/export", h.handleReportExport)

	// API - Printer
	mux.HandleFunc("/api/print-ticket", h.handlePrintTicket)
	mux.HandleFunc("/api/printer/test", h.handlePrinterTest)
	mux.HandleFunc("/api/printer/status", h.handlePrinterStatus)

	// SSE
	mux.HandleFunc("/api/sse/display", h.handleDisplaySSE)
	mux.HandleFunc("/api/sse/counter/", h.handleCounterSSE)
}

// JSON helpers

func (h *Handler) jsonResponse(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(data)
}

func (h *Handler) jsonError(w http.ResponseWriter, message string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}

func (h *Handler) cacheMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Cache for 1 hour
		w.Header().Set("Cache-Control", "public, max-age=3600")
		next.ServeHTTP(w, r)
	})
}

// Page handlers

func (h *Handler) handleIndex(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	http.Redirect(w, r, "/display", http.StatusFound)
}

func (h *Handler) handleAdmin(w http.ResponseWriter, r *http.Request) {
	h.tmpl.ExecuteTemplate(w, "admin.html", nil)
}

func (h *Handler) handleDisplay(w http.ResponseWriter, r *http.Request) {
	data := map[string]interface{}{
		"AudioEnabled": h.config.Audio.Enabled,
		"BellFile":     h.config.Audio.BellFile,
	}
	h.tmpl.ExecuteTemplate(w, "display.html", data)
}

func (h *Handler) handleTicket(w http.ResponseWriter, r *http.Request) {
	queueTypes, _ := h.db.ListQueueTypes(true)
	data := map[string]interface{}{
		"QueueTypes": queueTypes,
	}
	h.tmpl.ExecuteTemplate(w, "ticket.html", data)
}

func (h *Handler) handleCountersPage(w http.ResponseWriter, r *http.Request) {
	h.tmpl.ExecuteTemplate(w, "counters.html", nil)
}

func (h *Handler) handleCounter(w http.ResponseWriter, r *http.Request) {
	idStr := strings.TrimPrefix(r.URL.Path, "/counter/")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		http.Error(w, "Invalid counter ID", http.StatusBadRequest)
		return
	}

	counter, err := h.db.GetCounter(id)
	if err != nil {
		if err == sql.ErrNoRows {
			http.Error(w, "Counter not found", http.StatusNotFound)
			return
		}
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}

	queueTypes, _ := h.db.ListQueueTypes(true)

	data := map[string]interface{}{
		"Counter":    counter,
		"QueueTypes": queueTypes,
	}
	h.tmpl.ExecuteTemplate(w, "counter.html", data)
}

func (h *Handler) handleHealth(w http.ResponseWriter, r *http.Request) {
	stats, _ := h.db.GetStats()
	h.jsonResponse(w, map[string]interface{}{
		"status":          "ok",
		"timestamp":       time.Now(),
		"display_clients": h.hub.GetDisplayClientCount(),
		"stats":           stats,
	})
}

// Queue API handlers

func (h *Handler) handleQueues(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		status := r.URL.Query().Get("status")
		queueType := r.URL.Query().Get("type")
		date := r.URL.Query().Get("date")

		page := 1
		if p := r.URL.Query().Get("page"); p != "" {
			if parsed, err := strconv.Atoi(p); err == nil && parsed > 0 {
				page = parsed
			}
		}

		perPage := 20
		if pp := r.URL.Query().Get("per_page"); pp != "" {
			if parsed, err := strconv.Atoi(pp); err == nil && parsed > 0 && parsed <= 100 {
				perPage = parsed
			}
		}

		result, err := h.db.ListQueuesWithPagination(status, queueType, date, page, perPage)
		if err != nil {
			h.jsonError(w, "Failed to list queues", http.StatusInternalServerError)
			return
		}

		h.jsonResponse(w, result)

	default:
		h.jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func (h *Handler) handleTakeQueue(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		h.jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	queueType := r.URL.Query().Get("type")
	if queueType == "" {
		queueType = "general"
	}

	queue, err := h.db.CreateQueue(queueType)
	if err != nil {
		h.jsonError(w, "Failed to create queue", http.StatusInternalServerError)
		return
	}

	// Broadcast update to all counters
	waitingCount, _ := h.db.GetWaitingCount()
	h.hub.BroadcastAllCounters("queue_added", models.CounterUpdateData{
		WaitingCount: waitingCount,
		Timestamp:    time.Now(),
	})

	h.jsonResponse(w, queue)
}

// Counter API handlers

func (h *Handler) handleCounters(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		counters, err := h.db.ListCounters()
		if err != nil {
			h.jsonError(w, "Failed to list counters", http.StatusInternalServerError)
			return
		}

		if counters == nil {
			counters = []*models.Counter{}
		}

		h.jsonResponse(w, counters)

	case http.MethodPost:
		var req struct {
			CounterNumber string `json:"counter_number"`
			CounterName   string `json:"counter_name"`
		}

		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			h.jsonError(w, "Invalid request body", http.StatusBadRequest)
			return
		}

		counter, err := h.db.CreateCounter(req.CounterNumber, req.CounterName)
		if err != nil {
			h.jsonError(w, "Failed to create counter", http.StatusInternalServerError)
			return
		}

		h.jsonResponse(w, counter)

	default:
		h.jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func (h *Handler) handleCounterAPI(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/counter/")
	parts := strings.Split(path, "/")

	if len(parts) < 1 {
		h.jsonError(w, "Invalid path", http.StatusBadRequest)
		return
	}

	counterID, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		h.jsonError(w, "Invalid counter ID", http.StatusBadRequest)
		return
	}

	action := ""
	if len(parts) > 1 {
		action = parts[1]
	}

	switch action {
	case "call-next":
		h.handleCallNext(w, r, counterID)
	case "recall":
		h.handleRecall(w, r, counterID)
	case "complete":
		h.handleComplete(w, r, counterID)
	case "cancel":
		h.handleCancel(w, r, counterID)
	default:
		switch r.Method {
		case http.MethodGet:
			// Get counter info
			counter, err := h.db.GetCounter(counterID)
			if err != nil {
				if err == sql.ErrNoRows {
					h.jsonError(w, "Counter not found", http.StatusNotFound)
					return
				}
				h.jsonError(w, "Database error", http.StatusInternalServerError)
				return
			}
			h.jsonResponse(w, counter)

		case http.MethodPut:
			// Update counter
			var req struct {
				CounterName string `json:"counter_name"`
				IsActive    *bool  `json:"is_active,omitempty"`
			}

			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				h.jsonError(w, "Invalid request body", http.StatusBadRequest)
				return
			}

			// Get current counter to preserve is_active if not provided
			currentCounter, err := h.db.GetCounter(counterID)
			if err != nil {
				if err == sql.ErrNoRows {
					h.jsonError(w, "Counter not found", http.StatusNotFound)
					return
				}
				h.jsonError(w, "Database error", http.StatusInternalServerError)
				return
			}

			isActive := currentCounter.IsActive
			if req.IsActive != nil {
				isActive = *req.IsActive
			}

			if err := h.db.UpdateCounter(counterID, req.CounterName, isActive); err != nil {
				log.Printf("Failed to update counter: %v", err)
				h.jsonError(w, "Failed to update counter", http.StatusInternalServerError)
				return
			}

			// Get updated counter
			counter, err := h.db.GetCounter(counterID)
			if err != nil {
				h.jsonError(w, "Failed to get updated counter", http.StatusInternalServerError)
				return
			}

			log.Printf("Counter updated: %s", counter.CounterName)
			h.jsonResponse(w, counter)

		case http.MethodDelete:
			// Delete counter
			counter, err := h.db.GetCounter(counterID)
			if err != nil {
				if err == sql.ErrNoRows {
					h.jsonError(w, "Counter not found", http.StatusNotFound)
					return
				}
				h.jsonError(w, "Database error", http.StatusInternalServerError)
				return
			}

			if err := h.db.DeleteCounter(counterID); err != nil {
				log.Printf("Failed to delete counter: %v", err)
				h.jsonError(w, "Failed to delete counter", http.StatusInternalServerError)
				return
			}

			log.Printf("Counter deleted: %s (%s)", counter.CounterName, counter.CounterNumber)
			h.jsonResponse(w, map[string]string{"status": "deleted"})

		default:
			h.jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	}
}

func (h *Handler) handleCallNext(w http.ResponseWriter, r *http.Request, counterID int64) {
	if r.Method != http.MethodPost {
		h.jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Get queue type from query parameter
	queueType := r.URL.Query().Get("type")

	// Atomic call next queue
	queue, err := h.db.CallNextQueue(counterID, queueType)
	if err != nil {
		if err == sql.ErrNoRows {
			h.jsonError(w, "No waiting queue", http.StatusNotFound)
			return
		}
		h.jsonError(w, "Database error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Get updated counter info for broadcast
	counter, err := h.db.GetCounter(counterID)
	if err != nil {
		h.jsonError(w, "Failed to get counter info", http.StatusInternalServerError)
		return
	}

	// Broadcast to display
	h.hub.BroadcastDisplay("queue_called", models.QueueCalledData{
		QueueNumber:   queue.QueueNumber,
		CounterNumber: counter.CounterNumber,
		CounterName:   counter.CounterName,
		Timestamp:     time.Now(),
	})

	// Broadcast to all counters
	waitingCount, _ := h.db.GetWaitingCount()
	h.hub.BroadcastAllCounters("queue_updated", models.CounterUpdateData{
		CurrentQueue: &queue.QueueNumber,
		WaitingCount: waitingCount,
		Timestamp:    time.Now(),
	})

	h.jsonResponse(w, counter)

	log.Printf("Queue %s called to counter %s", queue.QueueNumber, counter.CounterName)
}

func (h *Handler) handleRecall(w http.ResponseWriter, r *http.Request, counterID int64) {
	if r.Method != http.MethodPost {
		h.jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	counter, err := h.db.GetCounter(counterID)
	if err != nil {
		h.jsonError(w, "Counter not found", http.StatusNotFound)
		return
	}

	if !counter.CurrentQueueID.Valid {
		h.jsonError(w, "No current queue to recall", http.StatusBadRequest)
		return
	}

	queue, err := h.db.GetQueue(counter.CurrentQueueID.Int64)
	if err != nil {
		h.jsonError(w, "Queue not found", http.StatusNotFound)
		return
	}

	h.db.AddCallHistory(queue.ID, counterID, models.ActionRecalled)

	// Broadcast to display
	h.hub.BroadcastDisplay("queue_called", models.QueueCalledData{
		QueueNumber:   queue.QueueNumber,
		CounterNumber: counter.CounterNumber,
		CounterName:   counter.CounterName,
		Timestamp:     time.Now(),
	})

	h.jsonResponse(w, counter)

	log.Printf("Queue %s recalled to counter %s", queue.QueueNumber, counter.CounterName)
}

func (h *Handler) handleComplete(w http.ResponseWriter, r *http.Request, counterID int64) {
	if r.Method != http.MethodPost {
		h.jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	counter, err := h.db.GetCounter(counterID)
	if err != nil {
		h.jsonError(w, "Counter not found", http.StatusNotFound)
		return
	}

	if !counter.CurrentQueueID.Valid {
		h.jsonError(w, "No current queue to complete", http.StatusBadRequest)
		return
	}

	queue, _ := h.db.GetQueue(counter.CurrentQueueID.Int64)

	h.db.UpdateQueueStatus(counter.CurrentQueueID.Int64, models.StatusCompleted, &counterID)
	h.db.SetCounterCurrentQueue(counterID, nil)
	h.db.AddCallHistory(counter.CurrentQueueID.Int64, counterID, models.ActionCompleted)

	// Broadcast update
	waitingCount, _ := h.db.GetWaitingCount()
	h.hub.BroadcastAllCounters("queue_updated", models.CounterUpdateData{
		WaitingCount: waitingCount,
		Timestamp:    time.Now(),
	})

	counter, _ = h.db.GetCounter(counterID)
	h.jsonResponse(w, counter)

	if queue != nil {
		log.Printf("Queue %s completed at counter %s", queue.QueueNumber, counter.CounterName)
	}
}

func (h *Handler) handleCancel(w http.ResponseWriter, r *http.Request, counterID int64) {
	if r.Method != http.MethodPost {
		h.jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	counter, err := h.db.GetCounter(counterID)
	if err != nil {
		h.jsonError(w, "Counter not found", http.StatusNotFound)
		return
	}

	if !counter.CurrentQueueID.Valid {
		h.jsonError(w, "No current queue to cancel", http.StatusBadRequest)
		return
	}

	queue, _ := h.db.GetQueue(counter.CurrentQueueID.Int64)

	h.db.UpdateQueueStatus(counter.CurrentQueueID.Int64, models.StatusCancelled, &counterID)
	h.db.SetCounterCurrentQueue(counterID, nil)
	h.db.AddCallHistory(counter.CurrentQueueID.Int64, counterID, models.ActionCancelled)

	// Broadcast update
	waitingCount, _ := h.db.GetWaitingCount()
	h.hub.BroadcastAllCounters("queue_updated", models.CounterUpdateData{
		WaitingCount: waitingCount,
		Timestamp:    time.Now(),
	})

	counter, _ = h.db.GetCounter(counterID)
	h.jsonResponse(w, counter)

	if queue != nil {
		log.Printf("Queue %s cancelled at counter %s", queue.QueueNumber, counter.CounterName)
	}
}

// Stats handler

func (h *Handler) handleStats(w http.ResponseWriter, r *http.Request) {
	stats, err := h.db.GetStats()
	if err != nil {
		h.jsonError(w, "Failed to get stats", http.StatusInternalServerError)
		return
	}
	h.jsonResponse(w, stats)
}

func (h *Handler) handleStatsByType(w http.ResponseWriter, r *http.Request) {
	counts, err := h.db.GetWaitingCountByType()
	if err != nil {
		h.jsonError(w, "Failed to get stats by type", http.StatusInternalServerError)
		return
	}
	h.jsonResponse(w, counts)
}

// Settings API handler

func (h *Handler) handleSettings(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		keysParam := r.URL.Query().Get("keys")

		// If no keys specified, return all settings
		if keysParam == "" {
			allSettings, err := h.db.GetAllSettings()
			if err != nil {
				h.jsonError(w, "Failed to get settings", http.StatusInternalServerError)
				return
			}
			h.jsonResponse(w, allSettings)
			return
		}

		// Return specific keys
		keys := strings.Split(keysParam, ",")
		response := make(map[string]string)
		for _, key := range keys {
			val, _ := h.db.GetSetting(key)
			response[key] = val
		}

		h.jsonResponse(w, response)

	case http.MethodPost:
		var req map[string]string
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			h.jsonError(w, "Invalid request body", http.StatusBadRequest)
			return
		}

		for key, value := range req {
			if err := h.db.SetSetting(key, value); err != nil {
				h.jsonError(w, "Failed to save setting: "+key, http.StatusInternalServerError)
				return
			}
		}
		
		// Broadcast setting update to display
		h.hub.BroadcastDisplay("settings_updated", req)

		h.jsonResponse(w, map[string]string{"status": "saved"})

	default:
		h.jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// Admin handler - Reset queues hari ini
func (h *Handler) handleResetQueues(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		h.jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Ambil parameter queue_type dari query string (kosong = semua jenis)
	queueType := r.URL.Query().Get("type")

	affected, err := h.db.ResetQueuesToday(queueType)
	if err != nil {
		log.Printf("Failed to reset queues: %v", err)
		h.jsonError(w, "Failed to reset queues: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Broadcast update ke semua client
	waitingCount, _ := h.db.GetWaitingCount()
	h.hub.BroadcastAllCounters("queue_reset", models.CounterUpdateData{
		WaitingCount: waitingCount,
		Timestamp:    time.Now(),
	})

	message := fmt.Sprintf("%d antrian hari ini berhasil direset", affected)
	if queueType != "" {
		message = fmt.Sprintf("%d antrian tipe %s hari ini berhasil direset", affected, queueType)
	}

	log.Printf("Reset queues today: type=%s, affected=%d", queueType, affected)
	h.jsonResponse(w, map[string]interface{}{
		"status":   "success",
		"message":  message,
		"affected": affected,
	})
}

// Queue Types API handlers

func (h *Handler) handleQueueTypes(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		activeOnly := r.URL.Query().Get("active") == "true"
		types, err := h.db.ListQueueTypes(activeOnly)
		if err != nil {
			h.jsonError(w, "Failed to list queue types", http.StatusInternalServerError)
			return
		}
		if types == nil {
			types = []*models.QueueType{}
		}
		h.jsonResponse(w, types)

	case http.MethodPost:
		var req struct {
			Code   string `json:"code"`
			Name   string `json:"name"`
			Prefix string `json:"prefix"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			h.jsonError(w, "Invalid request body", http.StatusBadRequest)
			return
		}
		if req.Code == "" || req.Name == "" || req.Prefix == "" {
			h.jsonError(w, "Code, name, and prefix are required", http.StatusBadRequest)
			return
		}

		qt, err := h.db.CreateQueueType(req.Code, req.Name, req.Prefix)
		if err != nil {
			h.jsonError(w, "Failed to create queue type", http.StatusInternalServerError)
			return
		}
		h.jsonResponse(w, qt)

	default:
		h.jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func (h *Handler) handleQueueTypeAPI(w http.ResponseWriter, r *http.Request) {
	idStr := strings.TrimPrefix(r.URL.Path, "/api/queue-type/")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		h.jsonError(w, "Invalid queue type ID", http.StatusBadRequest)
		return
	}

	switch r.Method {
	case http.MethodGet:
		qt, err := h.db.GetQueueType(id)
		if err != nil {
			if err == sql.ErrNoRows {
				h.jsonError(w, "Queue type not found", http.StatusNotFound)
				return
			}
			h.jsonError(w, "Database error", http.StatusInternalServerError)
			return
		}
		h.jsonResponse(w, qt)

	case http.MethodPut:
		var req struct {
			Name      string `json:"name"`
			Prefix    string `json:"prefix"`
			IsActive  bool   `json:"is_active"`
			SortOrder int    `json:"sort_order"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			h.jsonError(w, "Invalid request body", http.StatusBadRequest)
			return
		}

		if err := h.db.UpdateQueueType(id, req.Name, req.Prefix, req.IsActive, req.SortOrder); err != nil {
			h.jsonError(w, "Failed to update queue type", http.StatusInternalServerError)
			return
		}

		qt, _ := h.db.GetQueueType(id)
		h.jsonResponse(w, qt)

	case http.MethodDelete:
		if err := h.db.DeleteQueueType(id); err != nil {
			h.jsonError(w, "Failed to delete queue type", http.StatusInternalServerError)
			return
		}
		h.jsonResponse(w, map[string]string{"status": "deleted"})

	default:
		h.jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// SSE handlers

func (h *Handler) handleDisplaySSE(w http.ResponseWriter, r *http.Request) {
	h.hub.ServeDisplaySSE(w, r)
}

func (h *Handler) handleCounterSSE(w http.ResponseWriter, r *http.Request) {
	idStr := strings.TrimPrefix(r.URL.Path, "/api/sse/counter/")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		http.Error(w, "Invalid counter ID", http.StatusBadRequest)
		return
	}
	h.hub.ServeCounterSSE(w, r, id)
}

// Printer handlers

func (h *Handler) handlePrintTicket(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		h.jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		QueueNumber string `json:"queue_number"`
		TypeName    string `json:"type_name"`
		DateTime    string `json:"date_time"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.jsonError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.QueueNumber == "" {
		h.jsonError(w, "Queue number is required", http.StatusBadRequest)
		return
	}

	// Set default values if not provided
	if req.TypeName == "" {
		req.TypeName = "Umum"
	}
	if req.DateTime == "" {
		req.DateTime = time.Now().Format("02/01/2006, 15:04:05")
	}

	// Load ticket template from settings
	template := h.loadTicketTemplate()

	// Print ticket
	err := h.printer.PrintTicket(printer.TicketData{
		QueueNumber: req.QueueNumber,
		TypeName:    req.TypeName,
		DateTime:    req.DateTime,
	}, template)

	if err != nil {
		log.Printf("Print error: %v", err)
		h.jsonError(w, "Failed to print ticket: "+err.Error(), http.StatusInternalServerError)
		return
	}

	log.Printf("Printed ticket: %s (%s)", req.QueueNumber, req.TypeName)
	h.jsonResponse(w, map[string]string{
		"status":  "printed",
		"message": "Ticket printed successfully",
	})
}

// loadTicketTemplate loads ticket template settings from database
func (h *Handler) loadTicketTemplate() printer.TicketTemplate {
	template := printer.DefaultTemplate()

	// Load text settings
	if val, _ := h.db.GetSetting("ticket_header"); val != "" {
		template.Header = val
	}
	if val, _ := h.db.GetSetting("ticket_subheader"); val != "" {
		template.Subheader = val
	}
	if val, _ := h.db.GetSetting("ticket_title"); val != "" {
		template.Title = val
	}
	if val, _ := h.db.GetSetting("ticket_footer1"); val != "" {
		template.Footer1 = val
	}
	if val, _ := h.db.GetSetting("ticket_footer2"); val != "" {
		template.Footer2 = val
	}
	if val, _ := h.db.GetSetting("ticket_thanks"); val != "" {
		template.Thanks = val
	}

	// Load visibility settings (default to true)
	if val, _ := h.db.GetSetting("ticket_show_subheader"); val == "false" {
		template.ShowSubheader = false
	}
	if val, _ := h.db.GetSetting("ticket_show_type"); val == "false" {
		template.ShowType = false
	}
	if val, _ := h.db.GetSetting("ticket_show_datetime"); val == "false" {
		template.ShowDatetime = false
	}
	if val, _ := h.db.GetSetting("ticket_show_footer"); val == "false" {
		template.ShowFooter = false
	}
	if val, _ := h.db.GetSetting("ticket_show_thanks"); val == "false" {
		template.ShowThanks = false
	}

	return template
}

func (h *Handler) handlePrinterTest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		h.jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	err := h.printer.TestPrint()
	if err != nil {
		log.Printf("Test print error: %v", err)
		h.jsonError(w, "Test print failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	h.jsonResponse(w, map[string]string{
		"status":  "success",
		"message": "Test print sent to printer",
	})
}

func (h *Handler) handlePrinterStatus(w http.ResponseWriter, r *http.Request) {
	h.jsonResponse(w, map[string]interface{}{
		"enabled":      h.printer.IsEnabled(),
		"printer_name": h.printer.GetPrinterName(),
	})
}

// Report handlers

func (h *Handler) handleReport(w http.ResponseWriter, r *http.Request) {
	startDate := r.URL.Query().Get("start")
	endDate := r.URL.Query().Get("end")

	if startDate == "" || endDate == "" {
		h.jsonError(w, "start and end date required", http.StatusBadRequest)
		return
	}

	report, err := h.db.GetReport(startDate, endDate)
	if err != nil {
		h.jsonError(w, "Failed to get report", http.StatusInternalServerError)
		return
	}

	h.jsonResponse(w, report)
}

func (h *Handler) handleReportExport(w http.ResponseWriter, r *http.Request) {
	startDate := r.URL.Query().Get("start")
	endDate := r.URL.Query().Get("end")

	if startDate == "" || endDate == "" {
		h.jsonError(w, "start and end date required", http.StatusBadRequest)
		return
	}

	queues, err := h.db.GetQueuesForExport(startDate, endDate)
	if err != nil {
		h.jsonError(w, "Failed to get queues", http.StatusInternalServerError)
		return
	}

	// Generate CSV
	w.Header().Set("Content-Type", "text/csv")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=report-%s-%s.csv", startDate, endDate))

	// Write CSV header
	w.Write([]byte("No Antrian,Jenis,Status,Waktu Ambil,Waktu Panggil,Waktu Selesai,Loket\n"))

	for _, q := range queues {
		calledAt := ""
		if q.CalledAt.Valid {
			calledAt = q.CalledAt.Time.Format("2006-01-02 15:04:05")
		}
		completedAt := ""
		if q.CompletedAt.Valid {
			completedAt = q.CompletedAt.Time.Format("2006-01-02 15:04:05")
		}
		counterName := ""
		if q.CounterID.Valid {
			counterName = fmt.Sprintf("Loket %d", q.CounterID.Int64)
		}

		line := fmt.Sprintf("%s,%s,%s,%s,%s,%s,%s\n",
			q.QueueNumber,
			q.QueueType,
			q.Status,
			q.CreatedAt.Format("2006-01-02 15:04:05"),
			calledAt,
			completedAt,
			counterName,
		)
		w.Write([]byte(line))
	}
}
