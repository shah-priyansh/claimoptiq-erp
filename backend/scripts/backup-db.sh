#!/bin/bash

# Database backup script
DATABASE_URL="postgresql://neondb_owner:npg_R4a6iLXfHMQx@ep-delicate-feather-aphev94c.c-7.us-east-1.aws.neon.tech/neondb?sslmode=require"
BACKUP_DIR="./db_backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/backup_$TIMESTAMP.sql"

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

echo "🔄 Starting database backup..."
echo "Backup file: $BACKUP_FILE"

# Extract connection details from DATABASE_URL
# Format: postgresql://user:pass@host:port/dbname
pg_dump "$DATABASE_URL" > "$BACKUP_FILE"

if [ $? -eq 0 ]; then
  SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
  echo "✅ Backup completed successfully!"
  echo "File size: $SIZE"
  echo "Location: $BACKUP_FILE"
  echo ""
  echo "Recent backups:"
  ls -lh "$BACKUP_DIR" | tail -5
else
  echo "❌ Backup failed!"
  exit 1
fi
