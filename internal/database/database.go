package database

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"
	"queue-system/internal/config"
	"queue-system/internal/models"
)

type DB struct {
	*sql.DB
	config *config.Config
}

func New(cfg *config.Config) (*DB, error) {
	dir := filepath.Dir(cfg.Database.Path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create database directory: %w", err)
	}

	db, err := sql.Open("sqlite", cfg.Database.Path+"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=synchronous=NORMAL")
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	db.SetMaxOpenConns(cfg.Database.MaxOpenConns)
	db.SetMaxIdleConns(cfg.Database.MaxIdleConns)

	d := &DB{DB: db, config: cfg}

	if err := d.migrate(); err != nil {
		return nil, fmt.Errorf("failed to migrate database: %w", err)
	}

	return d, nil
}

func (d *DB) migrate() error {
	schema := `
	CREATE TABLE IF NOT EXISTS queues (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		queue_number TEXT NOT NULL,
		queue_type TEXT NOT NULL DEFAULT 'general',
		status TEXT NOT NULL DEFAULT 'waiting',
		counter_id INTEGER,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		called_at DATETIME,
		completed_at DATETIME,
		FOREIGN KEY (counter_id) REFERENCES counters(id)
	);

	CREATE TABLE IF NOT EXISTS counters (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		counter_number TEXT NOT NULL UNIQUE,
		counter_name TEXT NOT NULL,
		is_active INTEGER NOT NULL DEFAULT 1,
		current_queue_id INTEGER,
		last_call_at DATETIME,
		FOREIGN KEY (current_queue_id) REFERENCES queues(id)
	);

	CREATE TABLE IF NOT EXISTS settings (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL,
		updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS call_history (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		queue_id INTEGER NOT NULL,
		counter_id INTEGER NOT NULL,
		action TEXT NOT NULL,
		timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (queue_id) REFERENCES queues(id),
		FOREIGN KEY (counter_id) REFERENCES counters(id)
	);

	CREATE INDEX IF NOT EXISTS idx_queues_status ON queues(status);
	CREATE INDEX IF NOT EXISTS idx_queues_created_at ON queues(created_at);
	CREATE INDEX IF NOT EXISTS idx_call_history_timestamp ON call_history(timestamp);

	CREATE TABLE IF NOT EXISTS queue_types (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		code TEXT NOT NULL UNIQUE,
		name TEXT NOT NULL,
		prefix TEXT NOT NULL,
		is_active INTEGER NOT NULL DEFAULT 1,
		sort_order INTEGER NOT NULL DEFAULT 0,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	`

	_, err := d.Exec(schema)
	if err != nil {
		return err
	}

	// Insert default queue type if none exists
	var count int
	d.QueryRow(`SELECT COUNT(*) FROM queue_types`).Scan(&count)
	if count == 0 {
		d.Exec(`INSERT INTO queue_types (code, name, prefix, is_active, sort_order) VALUES ('A', 'Umum', 'A', 1, 1)`)
	}

	return nil
}

// Queue Type operations

func (d *DB) CreateQueueType(code, name, prefix string) (*models.QueueType, error) {
	var maxOrder int
	d.QueryRow(`SELECT COALESCE(MAX(sort_order), 0) FROM queue_types`).Scan(&maxOrder)

	result, err := d.Exec(`
		INSERT INTO queue_types (code, name, prefix, is_active, sort_order, created_at)
		VALUES (?, ?, ?, 1, ?, datetime('now', 'localtime'))
	`, code, name, prefix, maxOrder+1)
	if err != nil {
		return nil, err
	}

	id, _ := result.LastInsertId()
	return d.GetQueueType(id)
}

func (d *DB) GetQueueType(id int64) (*models.QueueType, error) {
	qt := &models.QueueType{}
	err := d.QueryRow(`
		SELECT id, code, name, prefix, is_active, sort_order, created_at
		FROM queue_types WHERE id = ?
	`, id).Scan(&qt.ID, &qt.Code, &qt.Name, &qt.Prefix, &qt.IsActive, &qt.SortOrder, &qt.CreatedAt)
	return qt, err
}

func (d *DB) GetQueueTypeByCode(code string) (*models.QueueType, error) {
	qt := &models.QueueType{}
	err := d.QueryRow(`
		SELECT id, code, name, prefix, is_active, sort_order, created_at
		FROM queue_types WHERE code = ?
	`, code).Scan(&qt.ID, &qt.Code, &qt.Name, &qt.Prefix, &qt.IsActive, &qt.SortOrder, &qt.CreatedAt)
	return qt, err
}

func (d *DB) ListQueueTypes(activeOnly bool) ([]*models.QueueType, error) {
	query := `SELECT id, code, name, prefix, is_active, sort_order, created_at FROM queue_types`
	if activeOnly {
		query += ` WHERE is_active = 1`
	}
	query += ` ORDER BY sort_order ASC`

	rows, err := d.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var types []*models.QueueType
	for rows.Next() {
		qt := &models.QueueType{}
		if err := rows.Scan(&qt.ID, &qt.Code, &qt.Name, &qt.Prefix, &qt.IsActive, &qt.SortOrder, &qt.CreatedAt); err != nil {
			return nil, err
		}
		types = append(types, qt)
	}
	return types, nil
}

func (d *DB) UpdateQueueType(id int64, name, prefix string, isActive bool, sortOrder int) error {
	_, err := d.Exec(`
		UPDATE queue_types SET name = ?, prefix = ?, is_active = ?, sort_order = ? WHERE id = ?
	`, name, prefix, isActive, sortOrder, id)
	return err
}

func (d *DB) DeleteQueueType(id int64) error {
	_, err := d.Exec(`DELETE FROM queue_types WHERE id = ?`, id)
	return err
}

// Queue operations

func (d *DB) CreateQueue(queueTypeCode string) (*models.Queue, error) {
	tx, err := d.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	// Get queue type to find prefix
	var prefix string
	var qtID int64
	err = tx.QueryRow(`SELECT id, prefix FROM queue_types WHERE code = ?`, queueTypeCode).Scan(&qtID, &prefix)
	if err != nil {
		// Fallback to config prefix if queue type not found
		prefix = d.config.Queue.Prefix
	}

	var lastNumber int
	row := tx.QueryRow(`
		SELECT COALESCE(MAX(CAST(SUBSTR(queue_number, LENGTH(?) + 1) AS INTEGER)), 0)
		FROM queues
		WHERE queue_number LIKE ? || '%'
		AND DATE(created_at) = DATE('now', 'localtime')
	`, prefix, prefix)
	row.Scan(&lastNumber)

	if d.config.Queue.ResetDaily && lastNumber == 0 {
		lastNumber = d.config.Queue.StartNumber - 1
	}

	queueNumber := fmt.Sprintf("%s%03d", prefix, lastNumber+1)

	result, err := tx.Exec(`
		INSERT INTO queues (queue_number, queue_type, status, created_at)
		VALUES (?, ?, 'waiting', datetime('now', 'localtime'))
	`, queueNumber, queueTypeCode)
	if err != nil {
		return nil, err
	}

	id, _ := result.LastInsertId()
	
	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return d.GetQueue(id)
}

func (d *DB) CallNextQueue(counterID int64, queueType string) (*models.Queue, error) {
	tx, err := d.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	// 1. Get current counter state
	var currentQueueID sql.NullInt64
	var counterName, counterNumber string
	err = tx.QueryRow(`SELECT current_queue_id, counter_name, counter_number FROM counters WHERE id = ?`, counterID).Scan(&currentQueueID, &counterName, &counterNumber)
	if err != nil {
		return nil, fmt.Errorf("counter not found: %w", err)
	}

	// 2. Complete current queue if exists
	if currentQueueID.Valid {
		_, err = tx.Exec(`
			UPDATE queues 
			SET status = 'completed', completed_at = datetime('now', 'localtime') 
			WHERE id = ?
		`, currentQueueID.Int64)
		if err != nil {
			return nil, err
		}

		_, err = tx.Exec(`
			INSERT INTO call_history (queue_id, counter_id, action, timestamp)
			VALUES (?, ?, ?, datetime('now', 'localtime'))
		`, currentQueueID.Int64, counterID, models.ActionCompleted)
		if err != nil {
			return nil, err
		}
	}

	// 3. Find next waiting queue
	var nextQueueID int64
	query := `
		SELECT id FROM queues 
		WHERE status = 'waiting' 
	`
	args := []interface{}{}
	if queueType != "" {
		query += ` AND queue_type = ?`
		args = append(args, queueType)
	}
	query += ` ORDER BY created_at ASC LIMIT 1`

	err = tx.QueryRow(query, args...).Scan(&nextQueueID)
	if err == sql.ErrNoRows {
		// No waiting queues
		_, err = tx.Exec(`UPDATE counters SET current_queue_id = NULL, last_call_at = NULL WHERE id = ?`, counterID)
		if err != nil {
			return nil, err
		}
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return nil, sql.ErrNoRows
	} else if err != nil {
		return nil, err
	}

	// 4. Update next queue status
	_, err = tx.Exec(`
		UPDATE queues 
		SET status = 'called', counter_id = ?, called_at = datetime('now', 'localtime')
		WHERE id = ?
	`, counterID, nextQueueID)
	if err != nil {
		return nil, err
	}

	// 5. Update counter
	_, err = tx.Exec(`
		UPDATE counters 
		SET current_queue_id = ?, last_call_at = datetime('now', 'localtime')
		WHERE id = ?
	`, nextQueueID, counterID)
	if err != nil {
		return nil, err
	}

	// 6. Record history
	_, err = tx.Exec(`
		INSERT INTO call_history (queue_id, counter_id, action, timestamp)
		VALUES (?, ?, ?, datetime('now', 'localtime'))
	`, nextQueueID, counterID, models.ActionCalled)
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return d.GetQueue(nextQueueID)
}

func (d *DB) GetQueue(id int64) (*models.Queue, error) {
	q := &models.Queue{}
	err := d.QueryRow(`
		SELECT id, queue_number, queue_type, status, counter_id, created_at, called_at, completed_at
		FROM queues WHERE id = ?
	`, id).Scan(&q.ID, &q.QueueNumber, &q.QueueType, &q.Status, &q.CounterID, &q.CreatedAt, &q.CalledAt, &q.CompletedAt)
	if err != nil {
		return nil, err
	}
	q.PrepareJSON()
	return q, nil
}

func (d *DB) GetQueueByNumber(number string) (*models.Queue, error) {
	q := &models.Queue{}
	err := d.QueryRow(`
		SELECT id, queue_number, queue_type, status, counter_id, created_at, called_at, completed_at
		FROM queues WHERE queue_number = ?
	`, number).Scan(&q.ID, &q.QueueNumber, &q.QueueType, &q.Status, &q.CounterID, &q.CreatedAt, &q.CalledAt, &q.CompletedAt)
	if err != nil {
		return nil, err
	}
	q.PrepareJSON()
	return q, nil
}

func (d *DB) ListQueues(status string, limit int) ([]*models.Queue, error) {
	query := `SELECT id, queue_number, queue_type, status, counter_id, created_at, called_at, completed_at FROM queues`
	args := []interface{}{}

	if status != "" {
		query += " WHERE status = ?"
		args = append(args, status)
	}

	query += " ORDER BY created_at DESC"

	if limit > 0 {
		query += " LIMIT ?"
		args = append(args, limit)
	}

	rows, err := d.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var queues []*models.Queue
	for rows.Next() {
		q := &models.Queue{}
		if err := rows.Scan(&q.ID, &q.QueueNumber, &q.QueueType, &q.Status, &q.CounterID, &q.CreatedAt, &q.CalledAt, &q.CompletedAt); err != nil {
			return nil, err
		}
		q.PrepareJSON()
		queues = append(queues, q)
	}
	return queues, nil
}

func (d *DB) ListQueuesWithPagination(status, queueType, date string, page, perPage int) (*models.PaginatedQueues, error) {
	// Build WHERE clause
	where := []string{}
	args := []interface{}{}

	if status != "" {
		where = append(where, "status = ?")
		args = append(args, status)
	}

	if queueType != "" {
		where = append(where, "queue_type = ?")
		args = append(args, queueType)
	}

	if date != "" {
		where = append(where, "DATE(created_at) = DATE(?)")
		args = append(args, date)
	}

	whereClause := ""
	if len(where) > 0 {
		whereClause = " WHERE " + strings.Join(where, " AND ")
	}

	// Get total count
	var total int
	countQuery := "SELECT COUNT(*) FROM queues" + whereClause
	if err := d.QueryRow(countQuery, args...).Scan(&total); err != nil {
		return nil, err
	}

	// Calculate pagination
	totalPages := (total + perPage - 1) / perPage
	if page > totalPages && totalPages > 0 {
		page = totalPages
	}
	offset := (page - 1) * perPage

	// Determine sort order
	orderBy := "created_at DESC"
	if status == "called" {
		orderBy = "called_at DESC"
	} else if status == "completed" {
		orderBy = "completed_at DESC"
	}

	// Get queues
	query := `SELECT id, queue_number, queue_type, status, counter_id, created_at, called_at, completed_at FROM queues` + whereClause + ` ORDER BY ` + orderBy + ` LIMIT ? OFFSET ?`
	args = append(args, perPage, offset)

	rows, err := d.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var queues []*models.Queue
	for rows.Next() {
		q := &models.Queue{}
		if err := rows.Scan(&q.ID, &q.QueueNumber, &q.QueueType, &q.Status, &q.CounterID, &q.CreatedAt, &q.CalledAt, &q.CompletedAt); err != nil {
			return nil, err
		}
		q.PrepareJSON()
		queues = append(queues, q)
	}

	if queues == nil {
		queues = []*models.Queue{}
	}

	return &models.PaginatedQueues{
		Queues:     queues,
		Total:      total,
		Page:       page,
		PerPage:    perPage,
		TotalPages: totalPages,
	}, nil
}

func (d *DB) GetNextWaitingQueue() (*models.Queue, error) {
	q := &models.Queue{}
	err := d.QueryRow(`
		SELECT id, queue_number, queue_type, status, counter_id, created_at, called_at, completed_at
		FROM queues
		WHERE status = 'waiting'
		ORDER BY created_at ASC
		LIMIT 1
	`).Scan(&q.ID, &q.QueueNumber, &q.QueueType, &q.Status, &q.CounterID, &q.CreatedAt, &q.CalledAt, &q.CompletedAt)
	if err != nil {
		return nil, err
	}
	q.PrepareJSON()
	return q, nil
}

func (d *DB) GetNextWaitingQueueByType(queueType string) (*models.Queue, error) {
	q := &models.Queue{}
	err := d.QueryRow(`
		SELECT id, queue_number, queue_type, status, counter_id, created_at, called_at, completed_at
		FROM queues
		WHERE status = 'waiting' AND queue_type = ?
		ORDER BY created_at ASC
		LIMIT 1
	`, queueType).Scan(&q.ID, &q.QueueNumber, &q.QueueType, &q.Status, &q.CounterID, &q.CreatedAt, &q.CalledAt, &q.CompletedAt)
	if err != nil {
		return nil, err
	}
	q.PrepareJSON()
	return q, nil
}

func (d *DB) GetWaitingCountByType() (map[string]int, error) {
	rows, err := d.Query(`
		SELECT queue_type, COUNT(*) as count
		FROM queues
		WHERE status = 'waiting'
		GROUP BY queue_type
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	counts := make(map[string]int)
	for rows.Next() {
		var queueType string
		var count int
		if err := rows.Scan(&queueType, &count); err != nil {
			return nil, err
		}
		counts[queueType] = count
	}
	return counts, nil
}

func (d *DB) UpdateQueueStatus(id int64, status models.QueueStatus, counterID *int64) error {
	now := time.Now()

	var calledAt, completedAt interface{}
	if status == models.StatusCalled {
		calledAt = now
	}
	if status == models.StatusCompleted || status == models.StatusCancelled {
		completedAt = now
	}

	_, err := d.Exec(`
		UPDATE queues
		SET status = ?, counter_id = ?, called_at = COALESCE(?, called_at), completed_at = COALESCE(?, completed_at)
		WHERE id = ?
	`, status, counterID, calledAt, completedAt, id)
	return err
}

func (d *DB) GetWaitingCount() (int, error) {
	var count int
	err := d.QueryRow(`SELECT COUNT(*) FROM queues WHERE status = 'waiting'`).Scan(&count)
	return count, err
}

// Counter operations

func (d *DB) CreateCounter(number, name string) (*models.Counter, error) {
	result, err := d.Exec(`
		INSERT INTO counters (counter_number, counter_name, is_active)
		VALUES (?, ?, 1)
	`, number, name)
	if err != nil {
		return nil, err
	}

	id, _ := result.LastInsertId()
	return d.GetCounter(id)
}

func (d *DB) GetCounter(id int64) (*models.Counter, error) {
	query := `
		SELECT 
			c.id, c.counter_number, c.counter_name, c.is_active, c.current_queue_id, c.last_call_at,
			q.id, q.queue_number, q.queue_type, q.status, q.counter_id, q.created_at, q.called_at, q.completed_at
		FROM counters c
		LEFT JOIN queues q ON c.current_queue_id = q.id
		WHERE c.id = ?
	`
	
	c := &models.Counter{}
	var qID, qCounterID sql.NullInt64
	var qNumber, qType, qStatus sql.NullString
	var qCreated, qCalled, qCompleted sql.NullTime

	err := d.QueryRow(query, id).Scan(
		&c.ID, &c.CounterNumber, &c.CounterName, &c.IsActive, &c.CurrentQueueID, &c.LastCallAt,
		&qID, &qNumber, &qType, &qStatus, &qCounterID, &qCreated, &qCalled, &qCompleted,
	)
	if err != nil {
		return nil, err
	}
	
	c.PrepareJSON()
	if qID.Valid {
		c.CurrentQueue = &models.Queue{
			ID:          qID.Int64,
			QueueNumber: qNumber.String,
			QueueType:   qType.String,
			Status:      models.QueueStatus(qStatus.String),
			CounterID:   qCounterID,
			CreatedAt:   qCreated.Time,
			CalledAt:    qCalled,
			CompletedAt: qCompleted,
		}
		c.CurrentQueue.PrepareJSON()
	}

	return c, nil
}

func (d *DB) ListCounters() ([]*models.Counter, error) {
	query := `
		SELECT 
			c.id, c.counter_number, c.counter_name, c.is_active, c.current_queue_id, c.last_call_at,
			q.id, q.queue_number, q.queue_type, q.status, q.counter_id, q.created_at, q.called_at, q.completed_at
		FROM counters c
		LEFT JOIN queues q ON c.current_queue_id = q.id
		ORDER BY c.counter_number
	`
	
	rows, err := d.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var counters []*models.Counter
	for rows.Next() {
		c := &models.Counter{}
		var qID, qCounterID sql.NullInt64
		var qNumber, qType, qStatus sql.NullString
		var qCreated, qCalled, qCompleted sql.NullTime

		err := rows.Scan(
			&c.ID, &c.CounterNumber, &c.CounterName, &c.IsActive, &c.CurrentQueueID, &c.LastCallAt,
			&qID, &qNumber, &qType, &qStatus, &qCounterID, &qCreated, &qCalled, &qCompleted,
		)
		if err != nil {
			return nil, err
		}
		
		c.PrepareJSON()
		if qID.Valid {
			c.CurrentQueue = &models.Queue{
				ID:          qID.Int64,
				QueueNumber: qNumber.String,
				QueueType:   qType.String,
				Status:      models.QueueStatus(qStatus.String),
				CounterID:   qCounterID,
				CreatedAt:   qCreated.Time,
				CalledAt:    qCalled,
				CompletedAt: qCompleted,
			}
			c.CurrentQueue.PrepareJSON()
		}
		counters = append(counters, c)
	}
	return counters, nil
}

func (d *DB) UpdateCounter(id int64, name string, isActive bool) error {
	_, err := d.Exec(`
		UPDATE counters SET counter_name = ?, is_active = ? WHERE id = ?
	`, name, isActive, id)
	return err
}

func (d *DB) SetCounterCurrentQueue(counterID int64, queueID *int64) error {
	var lastCallAt interface{}
	if queueID != nil {
		lastCallAt = time.Now()
	}

	_, err := d.Exec(`
		UPDATE counters SET current_queue_id = ?, last_call_at = COALESCE(?, last_call_at) WHERE id = ?
	`, queueID, lastCallAt, counterID)
	return err
}

func (d *DB) DeleteCounter(id int64) error {
	tx, err := d.Begin()
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	// Update queues that reference this counter (set counter_id to NULL)
	_, err = tx.Exec(`UPDATE queues SET counter_id = NULL WHERE counter_id = ?`, id)
	if err != nil {
		return fmt.Errorf("failed to update queues: %w", err)
	}

	// Delete call history for this counter
	_, err = tx.Exec(`DELETE FROM call_history WHERE counter_id = ?`, id)
	if err != nil {
		return fmt.Errorf("failed to delete call history: %w", err)
	}

	// Delete the counter
	_, err = tx.Exec(`DELETE FROM counters WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("failed to delete counter: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	return nil
}

// Call history operations

func (d *DB) AddCallHistory(queueID, counterID int64, action models.CallAction) error {
	_, err := d.Exec(`
		INSERT INTO call_history (queue_id, counter_id, action, timestamp)
		VALUES (?, ?, ?, datetime('now', 'localtime'))
	`, queueID, counterID, action)
	return err
}

func (d *DB) GetCallHistory(limit int) ([]*models.CallHistory, error) {
	rows, err := d.Query(`
		SELECT id, queue_id, counter_id, action, timestamp
		FROM call_history
		ORDER BY timestamp DESC
		LIMIT ?
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var history []*models.CallHistory
	for rows.Next() {
		h := &models.CallHistory{}
		if err := rows.Scan(&h.ID, &h.QueueID, &h.CounterID, &h.Action, &h.Timestamp); err != nil {
			return nil, err
		}
		history = append(history, h)
	}
	return history, nil
}

// Stats operations

func (d *DB) GetStats() (*models.Stats, error) {
	stats := &models.Stats{}

	d.QueryRow(`SELECT COUNT(*) FROM queues WHERE DATE(created_at) = DATE('now', 'localtime')`).Scan(&stats.TotalQueues)
	d.QueryRow(`SELECT COUNT(*) FROM queues WHERE status = 'waiting' AND DATE(created_at) = DATE('now', 'localtime')`).Scan(&stats.WaitingQueues)
	d.QueryRow(`SELECT COUNT(*) FROM queues WHERE status = 'called' AND DATE(created_at) = DATE('now', 'localtime')`).Scan(&stats.CalledQueues)
	d.QueryRow(`SELECT COUNT(*) FROM queues WHERE status = 'completed' AND DATE(created_at) = DATE('now', 'localtime')`).Scan(&stats.CompletedQueues)
	d.QueryRow(`SELECT COUNT(*) FROM queues WHERE status = 'cancelled' AND DATE(created_at) = DATE('now', 'localtime')`).Scan(&stats.CancelledQueues)
	d.QueryRow(`SELECT COUNT(*) FROM counters WHERE is_active = 1`).Scan(&stats.ActiveCounters)

	return stats, nil
}

// Settings operations

func (d *DB) GetSetting(key string) (string, error) {
	var value string
	err := d.QueryRow(`SELECT value FROM settings WHERE key = ?`, key).Scan(&value)
	return value, err
}

func (d *DB) SetSetting(key, value string) error {
	_, err := d.Exec(`
		INSERT INTO settings (key, value, updated_at)
		VALUES (?, ?, datetime('now', 'localtime'))
		ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now', 'localtime')
	`, key, value, value)
	return err
}

// Cleanup operations

func (d *DB) CancelOldQueues(hours int) (int64, error) {
	result, err := d.Exec(`
		UPDATE queues
		SET status = 'cancelled', completed_at = datetime('now', 'localtime')
		WHERE status = 'waiting'
		AND created_at < datetime('now', 'localtime', ? || ' hours')
	`, fmt.Sprintf("-%d", hours))
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

// ResetQueuesToday menghapus data antrian hari ini berdasarkan jenis antrian
// queueType: kode jenis antrian (kosong = semua jenis)
func (d *DB) ResetQueuesToday(queueType string) (int64, error) {
	tx, err := d.Begin()
	if err != nil {
		return 0, fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	// Build WHERE clause untuk filter
	whereQueue := "DATE(created_at) = DATE('now', 'localtime')"
	args := []interface{}{}
	if queueType != "" {
		whereQueue += " AND queue_type = ?"
		args = append(args, queueType)
	}

	// Ambil ID antrian yang akan dihapus
	query := fmt.Sprintf("SELECT id FROM queues WHERE %s", whereQueue)
	rows, err := tx.Query(query, args...)
	if err != nil {
		return 0, fmt.Errorf("failed to get queue ids: %w", err)
	}

	var queueIDs []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return 0, fmt.Errorf("failed to scan queue id: %w", err)
		}
		queueIDs = append(queueIDs, id)
	}
	rows.Close()

	if len(queueIDs) == 0 {
		return 0, nil // Tidak ada antrian untuk dihapus
	}

	// Reset counter yang current_queue_id-nya ada di list yang akan dihapus
	for _, qid := range queueIDs {
		_, err = tx.Exec(`UPDATE counters SET current_queue_id = NULL, last_call_at = NULL WHERE current_queue_id = ?`, qid)
		if err != nil {
			return 0, fmt.Errorf("failed to reset counter: %w", err)
		}
	}

	// Hapus call_history untuk antrian yang akan dihapus
	for _, qid := range queueIDs {
		_, err = tx.Exec(`DELETE FROM call_history WHERE queue_id = ?`, qid)
		if err != nil {
			return 0, fmt.Errorf("failed to delete call_history: %w", err)
		}
	}

	// Hapus antrian hari ini sesuai filter
	deleteQuery := fmt.Sprintf("DELETE FROM queues WHERE %s", whereQueue)
	result, err := tx.Exec(deleteQuery, args...)
	if err != nil {
		return 0, fmt.Errorf("failed to delete queues: %w", err)
	}

	affected, _ := result.RowsAffected()

	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("failed to commit transaction: %w", err)
	}

	return affected, nil
}

func (d *DB) Close() error {
	return d.DB.Close()
}
