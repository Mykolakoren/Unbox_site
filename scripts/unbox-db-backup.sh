#!/usr/bin/env bash
# Nightly Postgres backup for UnboxCRM. Dumps unboxdb, gzips, keeps 14 days.
#
# Deployed on the prod droplet at /usr/local/bin/unbox-db-backup.sh and run by
# cron: `0 2 * * * /usr/local/bin/unbox-db-backup.sh >> /var/log/unbox-db-backup.log 2>&1`
# Kept here in the repo so it's versioned and reproducible after a droplet rebuild.
#
# Off-box (§5#3): помимо локального /var/backups/unbox-db, свежий дамп
# выгружается в DigitalOcean Spaces (rclone), если настроено — это защищает
# от ПОЛНОЙ потери дроплета. Активация: см. ops/README.md (owner вставляет
# ключи Spaces в /root/.config/rclone/rclone.conf + remote в offsite.env).
# Плюс включить weekly droplet snapshots в панели DigitalOcean.
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

# ── Off-box copy → DigitalOcean Spaces (не роняет локальный бэкап) ──────────
OFFSITE_CONF=/root/.config/unbox-offsite.env
if [ -f "$OFFSITE_CONF" ]; then
  # ожидается: UNBOX_OFFSITE_REMOTE=spaces:bucket/db  [UNBOX_OFFSITE_KEEP_DAYS=30]
  # shellcheck disable=SC1090
  . "$OFFSITE_CONF"
fi
OFFSITE_REMOTE="${UNBOX_OFFSITE_REMOTE:-}"
OFFSITE_KEEP_DAYS="${UNBOX_OFFSITE_KEEP_DAYS:-30}"
if [ -n "$OFFSITE_REMOTE" ] && command -v rclone >/dev/null 2>&1; then
  if rclone copy "$OUT" "$OFFSITE_REMOTE/" --s3-no-check-bucket; then
    echo "$(date -u +%FT%TZ) OFFSITE-OK $OFFSITE_REMOTE"
    rclone delete "$OFFSITE_REMOTE/" --min-age "${OFFSITE_KEEP_DAYS}d" --include 'unbox-*.sql.gz' || true
  else
    echo "$(date -u +%FT%TZ) OFFSITE-FAIL $OFFSITE_REMOTE (проверьте ключи/бакет)"
  fi
else
  echo "$(date -u +%FT%TZ) offsite: не настроен (пропуск) — см. ops/README.md"
fi
