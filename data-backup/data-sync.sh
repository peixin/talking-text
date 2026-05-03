#!/bin/bash

# 获取脚本所在目录的绝对路径
SCRIPT_DIR=$(cd "$(dirname "$0")"; pwd)
QSHELL="$SCRIPT_DIR/qshell"
CONFIG_AUDIO="$SCRIPT_DIR/qiniu-sync-audio.json"
CONFIG_DB="$SCRIPT_DIR/qiniu-sync-db.json"

echo "--- Starting Data Sync at $(date) ---"

# 确保 qshell 有执行权限
chmod +x "$QSHELL"

# 执行音频同步
echo "Syncing Audio..."
"$QSHELL" qupload "$CONFIG_AUDIO"

# 执行数据库备份同步
echo "Syncing DB Backups..."
"$QSHELL" qupload "$CONFIG_DB"

echo "--- Data Sync Finished at $(date) ---"
