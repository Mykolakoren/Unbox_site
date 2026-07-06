#!/usr/bin/env bash
# Nightly Postgres backup for UnboxCRM. Dumps unboxdb, gzips, keeps 14 days.
#
# Deployed on the prod droplet at /usr/local/bin/unbox-db-backup.sh and run by
# cron: `0 2 * * * /usr/local/bin/unbox-db-backup.sh >> /var/log/unbox-db-backup.log 2>&1`
# Kept here in the repo so it's versioned and reproducible after a droplet rebuild.
#
# ⚠️ TODO (off-box): this writes to LOCAL /var/backups/unbox-db only — it protects
# against accidental DROP / bad migration / app-level corruption, but NOT against
# total droplet loss. Add an off-box copy (DigitalOcean Spaces via s3cmd, or rsync
# to another host) and enable weekly DO droplet snapshots.
set -euo pipefail
BACKUP_DIR=/var/backups/unbox-db
mkdir -p "$BACKUP_DIR"
DB_URL=$(grep '^DATABASE_URL=' /var/www/unbox/backend/.env | cut -d= -f2- | tr -d '"'\''')
TS=$(date -u +%Y%m%dT%H%M%SZ)
OUT="$BACKUP_DIR/unbox-$TS.sql.gz"
pg_dump "$DB_URL" | gzip > "$OUT"
# Integrity: refuse to keep a suspiciously small (broken) dump.
if [ "$(stat -c%s "$OUT")" -lt 1024 ]; then echo "ERROR: dump too small, removing"; rm -f "$OUT"; exit 1; fi
find "$BACKUP_DIR" -name 'unbox-*.sql.gz' -mtime +14 -delete
echo "$(date -u +%FT%TZ) OK $OUT ($(du -h "$OUT" | cut -f1))"
