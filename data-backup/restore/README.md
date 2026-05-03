# Sync
```bash
rsync -avz --progress \
  --exclude 'restore/db-restore-config.json' \
  --exclude 'qshell' \
  data-backup/ stillume:/opt/apps/talking-text/data-backup/
```

# quliu
```bash
./qshell account <Access_Key> <Secret_Key> username
```

# Restore

## download remote backup file from remote host or qin  iu

```bash
scp stillume:/opt/apps/talking-text/data/db-backups/db-backup-20260503_171703.sql.gz ./data/backups/
```

## restore database locally

```bash
./data-backup/restore/db-restore-local.sh ./data/backups/db-backup-20260503_171703.sql.gz
```

## restore database on server (Remote Docker)

For a clean and safe restore on the production server:

1. **Stop all services**:
   ```bash
   docker compose down
   ```

2. **Start ONLY the database**:
   ```bash
   docker compose up -d postgres
   ```

3. **Run the restore script**:
   ```bash
   ./data-backup/restore/db-restore.sh ./data/db-backups/db-backup-YYYYMMDD_HHMMSS.sql.gz
   ```

4. **Restart all services**:
   ```bash
   docker compose up -d
   ```

## cron job on server
```bash
0 */6 * * * /bin/bash /opt/apps/talking-text/data-backup/run-all.sh
```
