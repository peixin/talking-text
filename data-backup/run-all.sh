#!/bin/bash

# 获取脚本所在目录
SCRIPT_DIR=$(cd "$(dirname "$0")"; pwd)

# 确保在脚本目录下执行
cd "$SCRIPT_DIR"

# 创建日志目录
LOG_DIR="$SCRIPT_DIR/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/backup_$(date +%Y%m).log"

{
    echo "=========================================="
    echo "Batch Job Started: $(date)"
    echo "=========================================="

    # 1. 执行数据库备份
    bash "$SCRIPT_DIR/db-backup.sh"

    # 2. 执行数据目录同步
    bash "$SCRIPT_DIR/data-sync.sh"

    echo "=========================================="
    echo "Batch Job Finished: $(date)"
    echo "=========================================="
} >> "$LOG_FILE" 2>&1
