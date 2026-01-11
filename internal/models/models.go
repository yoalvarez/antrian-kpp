package models

import (
	"database/sql"
	"time"
)

type QueueStatus string

const (
	StatusWaiting   QueueStatus = "waiting"
	StatusCalled    QueueStatus = "called"
	StatusCompleted QueueStatus = "completed"
	StatusCancelled QueueStatus = "cancelled"
)

type Queue struct {
	ID          int64          `json:"id"`
	QueueNumber string         `json:"queue_number"`
	QueueType   string         `json:"queue_type"`
	Status      QueueStatus    `json:"status"`
	CounterID   sql.NullInt64  `json:"-"`
	CounterIDPtr *int64        `json:"counter_id,omitempty"`
	CreatedAt   time.Time      `json:"created_at"`
	CalledAt    sql.NullTime   `json:"-"`
	CalledAtPtr *time.Time     `json:"called_at,omitempty"`
	CompletedAt sql.NullTime   `json:"-"`
	CompletedAtPtr *time.Time  `json:"completed_at,omitempty"`
}

func (q *Queue) PrepareJSON() {
	if q.CounterID.Valid {
		q.CounterIDPtr = &q.CounterID.Int64
	}
	if q.CalledAt.Valid {
		q.CalledAtPtr = &q.CalledAt.Time
	}
	if q.CompletedAt.Valid {
		q.CompletedAtPtr = &q.CompletedAt.Time
	}
}

type Counter struct {
	ID             int64         `json:"id"`
	CounterNumber  string        `json:"counter_number"`
	CounterName    string        `json:"counter_name"`
	IsActive       bool          `json:"is_active"`
	CurrentQueueID sql.NullInt64 `json:"-"`
	CurrentQueueIDPtr *int64     `json:"current_queue_id,omitempty"`
	CurrentQueue   *Queue        `json:"current_queue,omitempty"`
	LastCallAt     sql.NullTime  `json:"-"`
	LastCallAtPtr  *time.Time    `json:"last_call_at,omitempty"`
}

func (c *Counter) PrepareJSON() {
	if c.CurrentQueueID.Valid {
		c.CurrentQueueIDPtr = &c.CurrentQueueID.Int64
	}
	if c.LastCallAt.Valid {
		c.LastCallAtPtr = &c.LastCallAt.Time
	}
}

type Setting struct {
	Key       string    `json:"key"`
	Value     string    `json:"value"`
	UpdatedAt time.Time `json:"updated_at"`
}

type CallAction string

const (
	ActionCalled    CallAction = "called"
	ActionRecalled  CallAction = "recalled"
	ActionCompleted CallAction = "completed"
	ActionCancelled CallAction = "cancelled"
)

type CallHistory struct {
	ID        int64      `json:"id"`
	QueueID   int64      `json:"queue_id"`
	CounterID int64      `json:"counter_id"`
	Action    CallAction `json:"action"`
	Timestamp time.Time  `json:"timestamp"`
}

type Stats struct {
	TotalQueues     int `json:"total_queues"`
	WaitingQueues   int `json:"waiting_queues"`
	CalledQueues    int `json:"called_queues"`
	CompletedQueues int `json:"completed_queues"`
	CancelledQueues int `json:"cancelled_queues"`
	ActiveCounters  int `json:"active_counters"`
}

type DisplayEvent struct {
	Type string      `json:"type"`
	Data interface{} `json:"data"`
}

type QueueCalledData struct {
	QueueNumber   string    `json:"queue_number"`
	CounterNumber string    `json:"counter_number"`
	CounterName   string    `json:"counter_name"`
	Timestamp     time.Time `json:"timestamp"`
}

type CounterUpdateData struct {
	CurrentQueue *string   `json:"current_queue"`
	WaitingCount int       `json:"waiting_count"`
	Timestamp    time.Time `json:"timestamp"`
}

type QueueType struct {
	ID        int64     `json:"id"`
	Code      string    `json:"code"`
	Name      string    `json:"name"`
	Prefix    string    `json:"prefix"`
	IsActive  bool      `json:"is_active"`
	SortOrder int       `json:"sort_order"`
	CreatedAt time.Time `json:"created_at"`
}

type PaginatedQueues struct {
	Queues     []*Queue `json:"queues"`
	Total      int      `json:"total"`
	Page       int      `json:"page"`
	PerPage    int      `json:"per_page"`
	TotalPages int      `json:"total_pages"`
}
