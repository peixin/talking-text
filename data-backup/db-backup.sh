#!/bin/bash

# --- 配置区 ---
DB_CONTAINER="talking-text-postgres"
DB_NAME="talking_text"
DB_USER="talking_text"
BACKUP_DIR="/opt/apps/talking-text/data/db-backups"
RETENTION_DAYS=7

# 获取脚本所在目录
SCRIPT_DIR=$(cd "$(dirname "$0")"; pwd)
PROJECT_DIR=$(cd "$SCRIPT_DIR/.."; pwd)

# 从项目根目录的 .env 文件获取密码
if [ -f "$PROJECT_DIR/.env" ]; then
    export $(grep -v '^#' "$PROJECT_DIR/.env" | xargs)
fi

if [ -z "$POSTGRES_PASSWORD" ]; then
    echo "❌ Error: POSTGRES_PASSWORD not found"
    exit 1
fi

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILENAME="db-backup-${TIMESTAMP}.sql.gz"
LOCAL_PATH="$BACKUP_DIR/$FILENAME"

mkdir -p "$BACKUP_DIR"

echo "--- Starting DB Backup at $(date) ---"

# 1. 导出并压缩
echo "Exporting database from container: $DB_CONTAINER"
docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$DB_CONTAINER" pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$LOCAL_PATH"

if [ $? -eq 0 ]; then
    echo "Backup successful: $FILENAME"
    
    # 2. 本地清理 7 天前的文件
    find "$BACKUP_DIR" -name "db-backup-*.sql.gz" -mtime +$RETENTION_DAYS -exec rm {} \;
    echo "Local cleanup finished."
else
    echo "Backup failed!"
    exit 1
fi

echo "--- DB Backup Finished at $(date) ---"

echo "--- DB Backup Finished at $(date) ---"
