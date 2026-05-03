# --- 配置 ---
DB_CONTAINER="talking-text-postgres"

# 获取脚本所在目录
SCRIPT_DIR=$(cd "$(dirname "$0")"; pwd)
PROJECT_DIR=$(cd "$SCRIPT_DIR/../.."; pwd)
CONFIG_FILE="$SCRIPT_DIR/db-restore-config.json"

# 检查输入参数
if [ -z "$1" ]; then
    echo "Usage: ./db-restore.sh <path_to_backup_file.sql.gz>"
    echo "Available backups:"
    ls -1 "$PROJECT_DIR/data/db-backups/"
    exit 1
fi

BACKUP_FILE=$1

# 检查文件是否存在
if [ ! -f "$BACKUP_FILE" ]; then
    echo "❌ Error: File $BACKUP_FILE not found."
    exit 1
fi

# 1. 解析配置 (从 JSON 中提取)
TARGET_DB=$(grep '"target_db"' "$CONFIG_FILE" | cut -d'"' -f4)
DB_USER=$(grep '"db_user"' "$CONFIG_FILE" | cut -d'"' -f4)
DB_PASS=$(grep '"db_password"' "$CONFIG_FILE" | cut -d'"' -f4)

# 2. 如果 JSON 里没密码，尝试从项目根目录 .env 加载
if [ -z "$DB_PASS" ] && [ -f "$PROJECT_DIR/.env" ]; then
    export $(grep -v '^#' "$PROJECT_DIR/.env" | xargs)
    DB_PASS="$POSTGRES_PASSWORD"
fi

if [ -z "$DB_PASS" ]; then
    echo "❌ Error: Database password not found in config or .env"
    exit 1
fi

echo "--- REMOTE RESTORE (DOCKER) ---"
echo "Container: $DB_CONTAINER"
echo "Target DB: $TARGET_DB"
echo "Backup File: $BACKUP_FILE"

# 确认操作
read -p "⚠️  CRITICAL: This will OVERWRITE the REMOTE database $TARGET_DB. Are you sure? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Operation cancelled."
    exit 1
fi

# 执行还原
echo "Wiping all tables (dropping public schema) in $TARGET_DB..."
docker exec -e PGPASSWORD="$DB_PASS" "$DB_CONTAINER" psql -U "$DB_USER" -d "$TARGET_DB" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

echo "Starting import..."
gunzip -c "$BACKUP_FILE" | docker exec -i -e PGPASSWORD="$DB_PASS" "$DB_CONTAINER" psql -U "$DB_USER" -d "$TARGET_DB"

if [ $? -eq 0 ]; then
    echo "✅ Remote restore successful!"
else
    echo "❌ Remote restore failed!"
fi
