#!/bin/bash

# 获取脚本所在目录
SCRIPT_DIR=$(cd "$(dirname "$0")"; pwd)
PROJECT_DIR=$(cd "$SCRIPT_DIR/../.."; pwd)
CONFIG_FILE="$SCRIPT_DIR/db-restore-config.json"

# 检查输入参数
if [ -z "$1" ]; then
    echo "Usage: ./db-restore-local.sh <path_to_backup_file.sql.gz>"
    echo "Available backups:"
    ls -1 "$PROJECT_DIR/data/backups/"
    exit 1
fi

BACKUP_FILE=$1

# 检查文件是否存在
if [ ! -f "$BACKUP_FILE" ]; then
    echo "❌ Error: File $BACKUP_FILE not found."
    exit 1
fi

# 解析配置 (简单提取，不依赖复杂 jq)
TARGET_DB=$(grep '"target_db"' "$CONFIG_FILE" | cut -d'"' -f4)
DB_USER=$(grep '"db_user"' "$CONFIG_FILE" | cut -d'"' -f4)
DB_PASS=$(grep '"db_password"' "$CONFIG_FILE" | cut -d'"' -f4)
DB_HOST=$(grep '"db_host"' "$CONFIG_FILE" | cut -d'"' -f4)
DB_PORT=$(grep '"db_port"' "$CONFIG_FILE" | cut -d'"' -f4)

# 设置 Postgres 密码环境变量，避免交互式输入
export PGPASSWORD="$DB_PASS"

echo "--- Restoring to $TARGET_DB on $DB_HOST:$DB_PORT ---"
echo "Target File: $BACKUP_FILE"

# 确认操作
read -p "⚠️  This will OVERWRITE the database $TARGET_DB. Are you sure? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Operation cancelled."
    exit 1
fi

# 1. 清空 Schema
echo "Wiping all tables (dropping public schema) in $TARGET_DB..."
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$TARGET_DB" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

# 2. 执行导入
echo "Importing data..."
gunzip -c "$BACKUP_FILE" | psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$TARGET_DB"

if [ $? -eq 0 ]; then
    echo "✅ Restore successful!"
else
    echo "❌ Restore failed!"
fi
