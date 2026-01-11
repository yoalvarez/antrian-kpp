package sse

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"
)

type Client struct {
	ID        string
	Channel   chan []byte
	CounterID int64
}

type Hub struct {
	displayClients  map[string]*Client
	counterClients  map[int64]map[string]*Client
	mu              sync.RWMutex
	register        chan *Client
	unregister      chan *Client
}

func NewHub() *Hub {
	h := &Hub{
		displayClients: make(map[string]*Client),
		counterClients: make(map[int64]map[string]*Client),
		register:       make(chan *Client),
		unregister:     make(chan *Client),
	}
	go h.run()
	return h
}

func (h *Hub) run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			if client.CounterID == 0 {
				h.displayClients[client.ID] = client
			} else {
				if h.counterClients[client.CounterID] == nil {
					h.counterClients[client.CounterID] = make(map[string]*Client)
				}
				h.counterClients[client.CounterID][client.ID] = client
			}
			h.mu.Unlock()
			log.Printf("SSE client connected: %s (counter: %d)", client.ID, client.CounterID)

		case client := <-h.unregister:
			h.mu.Lock()
			if client.CounterID == 0 {
				if _, ok := h.displayClients[client.ID]; ok {
					delete(h.displayClients, client.ID)
					close(client.Channel)
				}
			} else {
				if clients, ok := h.counterClients[client.CounterID]; ok {
					if _, ok := clients[client.ID]; ok {
						delete(clients, client.ID)
						close(client.Channel)
					}
				}
			}
			h.mu.Unlock()
			log.Printf("SSE client disconnected: %s", client.ID)
		}
	}
}

func (h *Hub) BroadcastDisplay(eventType string, data interface{}) {
	event := map[string]interface{}{
		"type": eventType,
		"data": data,
	}

	jsonData, err := json.Marshal(event)
	if err != nil {
		log.Printf("Error marshaling SSE data: %v", err)
		return
	}

	h.mu.RLock()
	defer h.mu.RUnlock()

	for _, client := range h.displayClients {
		select {
		case client.Channel <- jsonData:
		default:
			log.Printf("SSE client buffer full: %s", client.ID)
		}
	}
}

func (h *Hub) BroadcastCounter(counterID int64, eventType string, data interface{}) {
	event := map[string]interface{}{
		"type": eventType,
		"data": data,
	}

	jsonData, err := json.Marshal(event)
	if err != nil {
		log.Printf("Error marshaling SSE data: %v", err)
		return
	}

	h.mu.RLock()
	defer h.mu.RUnlock()

	if clients, ok := h.counterClients[counterID]; ok {
		for _, client := range clients {
			select {
			case client.Channel <- jsonData:
			default:
				log.Printf("SSE client buffer full: %s", client.ID)
			}
		}
	}
}

func (h *Hub) BroadcastAllCounters(eventType string, data interface{}) {
	event := map[string]interface{}{
		"type": eventType,
		"data": data,
	}

	jsonData, err := json.Marshal(event)
	if err != nil {
		log.Printf("Error marshaling SSE data: %v", err)
		return
	}

	h.mu.RLock()
	defer h.mu.RUnlock()

	for _, clients := range h.counterClients {
		for _, client := range clients {
			select {
			case client.Channel <- jsonData:
			default:
				log.Printf("SSE client buffer full: %s", client.ID)
			}
		}
	}
}

func (h *Hub) ServeDisplaySSE(w http.ResponseWriter, r *http.Request) {
	h.serveSSE(w, r, 0)
}

func (h *Hub) ServeCounterSSE(w http.ResponseWriter, r *http.Request, counterID int64) {
	h.serveSSE(w, r, counterID)
}

func (h *Hub) serveSSE(w http.ResponseWriter, r *http.Request, counterID int64) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "SSE not supported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	clientID := fmt.Sprintf("%d-%d", time.Now().UnixNano(), counterID)
	client := &Client{
		ID:        clientID,
		Channel:   make(chan []byte, 10),
		CounterID: counterID,
	}

	h.register <- client

	defer func() {
		h.unregister <- client
	}()

	// Send initial connection event
	fmt.Fprintf(w, "event: connected\ndata: {\"client_id\":\"%s\"}\n\n", clientID)
	flusher.Flush()

	// Heartbeat ticker
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
			fmt.Fprintf(w, ": heartbeat\n\n")
			flusher.Flush()
		case data := <-client.Channel:
			fmt.Fprintf(w, "event: message\ndata: %s\n\n", data)
			flusher.Flush()
		}
	}
}

func (h *Hub) GetDisplayClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.displayClients)
}

func (h *Hub) GetCounterClientCount(counterID int64) int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	if clients, ok := h.counterClients[counterID]; ok {
		return len(clients)
	}
	return 0
}
