#!/bin/bash

# Queue System Backup Script
# Usage: ./backup.sh [backup_dir]

BACKUP_DIR="${1:-./backups}"
DB_PATH="./data/queue.db"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/queue_$DATE.db"

# Create backup directory if not exists
mkdir -p "$BACKUP_DIR"

# Check if database exists
if [ ! -f "$DB_PATH" ]; then
    echo "Error: Database file not found at $DB_PATH"
    exit 1
fi

# Create backup
echo "Creating backup..."
cp "$DB_PATH" "$BACKUP_FILE"

if [ $? -eq 0 ]; then
    echo "Backup created: $BACKUP_FILE"
else
    echo "Error: Failed to create backup"
    exit 1
fi

# Keep only last 7 days of backups
echo "Cleaning old backups..."
find "$BACKUP_DIR" -name "queue_*.db" -mtime +7 -delete

echo "Backup complete"
