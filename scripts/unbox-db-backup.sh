#!/usr/bin/env bash
# Ночной бэкап Postgres для UnboxCRM: дамп unboxdb → gzip → ШИФРОВАНИЕ → 14 дней.
#
# Живёт на дроплете в /usr/local/bin/unbox-db-backup.sh, запускается кроном:
#   0 2 * * * /usr/local/bin/unbox-db-backup.sh >> /var/log/unbox-db-backup.log 2>&1
# Хранится в репозитории, чтобы пережить пересборку дроплета.
#
# ШИФРОВАНИЕ (2026-07-21). Дамп содержит имена клиентов, телефоны, суммы —
# всё, кроме заметок терапевта, которые зашифрованы отдельно в самой базе.
# Раньше файл лежал открытым, и любой, кто получил доступ к серверу или к
# облачному бакету, читал его целиком. Теперь GPG, симметрично, AES256.
# Пароль: /root/.config/unbox-backup-key (root-only) + копия в .secrets.md.
#
#   ПОТЕРЯ ПАРОЛЯ = БЭКАПЫ НЕ ПРОЧИТАТЬ. Это цена защиты, помнить.
#
# Если файла с паролем нет — бэкап всё равно делается, но ОТКРЫТЫМ, с воплем
# в лог. Остаться без бэкапа хуже, чем остаться без шифрования.
#
# Off-box: помимо локального /var/backups/unbox-db свежий дамп выгружается в
# DigitalOcean Spaces (rclone), если настроено — защита от полной потери
# дроплета. Активация: см. ops/README.md.
#
# ВОССТАНОВЛЕНИЕ: ops/unbox-db-restore.sh (там же проверка «а читается ли»).
set -euo pipefail

BACKUP_DIR=/var/backups/unbox-db
KEYFILE=/root/.config/unbox-backup-key
mkdir -p "$BACKUP_DIR"

DB_URL=$(grep '^DATABASE_URL=' /var/www/unbox/backend/.env | cut -d= -f2- | tr -d '"'\''')
TS=$(date -u +%Y%m%dT%H%M%SZ)

GPG_OPTS=(--symmetric --cipher-algo AES256 --batch --yes
          --pinentry-mode loopback --passphrase-file "$KEYFILE")

if [ -s "$KEYFILE" ] && command -v gpg >/dev/null 2>&1; then
  OUT="$BACKUP_DIR/unbox-$TS.sql.gz.gpg"
  ENCRYPTED=yes
  pg_dump "$DB_URL" | gzip | gpg "${GPG_OPTS[@]}" -o "$OUT"
else
  OUT="$BACKUP_DIR/unbox-$TS.sql.gz"
  ENCRYPTED=no
  echo "$(date -u +%FT%TZ) ВНИМАНИЕ: $KEYFILE отсутствует — бэкап ОТКРЫТЫМ ТЕКСТОМ"
  pg_dump "$DB_URL" | gzip > "$OUT"
fi

# Целостность. Раньше проверялся только размер — обрезанный дамп проходил.
# Теперь честно разворачиваем обратно и проверяем сам gzip-поток.
if [ "$(stat -c%s "$OUT")" -lt 1024 ]; then
  echo "ОШИБКА: дамп подозрительно мал, удаляю"; rm -f "$OUT"; exit 1
fi
if [ "$ENCRYPTED" = yes ]; then
  if ! gpg --quiet --batch --pinentry-mode loopback --passphrase-file "$KEYFILE" \
           --decrypt "$OUT" 2>/dev/null | gzip -t; then
    echo "ОШИБКА: бэкап не расшифровывается или битый, удаляю"; rm -f "$OUT"; exit 1
  fi
else
  if ! gzip -t "$OUT"; then
    echo "ОШИБКА: битый gzip, удаляю"; rm -f "$OUT"; exit 1
  fi
fi

# Чистка старше 14 дней — обе формы имени (шифрованные и старые открытые).
find "$BACKUP_DIR" -name 'unbox-*.sql.gz' -mtime +14 -delete
find "$BACKUP_DIR" -name 'unbox-*.sql.gz.gpg' -mtime +14 -delete

echo "$(date -u +%FT%TZ) OK $OUT ($(du -h "$OUT" | cut -f1), шифрование: $ENCRYPTED)"

# ── Копия наружу → DigitalOcean Spaces (не роняет локальный бэкап) ──────────
OFFSITE_CONF=/root/.config/unbox-offsite.env
if [ -f "$OFFSITE_CONF" ]; then
  # ожидается: UNBOX_OFFSITE_REMOTE=spaces:bucket/db  [UNBOX_OFFSITE_KEEP_DAYS=30]
  # shellcheck disable=SC1090
  . "$OFFSITE_CONF"
fi
OFFSITE_REMOTE="${UNBOX_OFFSITE_REMOTE:-}"
OFFSITE_KEEP_DAYS="${UNBOX_OFFSITE_KEEP_DAYS:-30}"
if [ -n "$OFFSITE_REMOTE" ] && command -v rclone >/dev/null 2>&1; then
  if [ "$ENCRYPTED" != yes ]; then
    # Наружу открытый дамп не отдаём: в облаке он живёт дольше и достаётся
    # проще, чем на сервере. Лучше пропустить выгрузку, чем разослать копию.
    echo "$(date -u +%FT%TZ) OFFSITE-ПРОПУСК: бэкап не зашифрован, наружу не отправляю"
  elif rclone copy "$OUT" "$OFFSITE_REMOTE/" --s3-no-check-bucket; then
    echo "$(date -u +%FT%TZ) OFFSITE-OK $OFFSITE_REMOTE"
    rclone delete "$OFFSITE_REMOTE/" --min-age "${OFFSITE_KEEP_DAYS}d" --include 'unbox-*.sql.gz*' || true
  else
    echo "$(date -u +%FT%TZ) OFFSITE-FAIL $OFFSITE_REMOTE (проверьте ключи/бакет)"
  fi
else
  echo "$(date -u +%FT%TZ) offsite: не настроен (пропуск) — см. ops/README.md"
fi
