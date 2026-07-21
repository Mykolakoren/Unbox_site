#!/usr/bin/env bash
# Восстановление UnboxCRM из зашифрованного бэкапа + проверка «а читается ли».
#
#   # только проверить, что бэкап целый и расшифровывается (НИЧЕГО не меняет):
#   /usr/local/bin/unbox-db-restore.sh --check /var/backups/unbox-db/unbox-*.sql.gz.gpg
#
#   # развернуть в ЗАПАСНУЮ базу и сравнить с боевой (тоже безопасно):
#   /usr/local/bin/unbox-db-restore.sh --to-scratch <файл>
#
#   # развернуть в БОЕВУЮ базу (опасно, спросит подтверждение):
#   /usr/local/bin/unbox-db-restore.sh --to-prod <файл>
#
# Пароль берётся из /root/.config/unbox-backup-key. Без него зашифрованный
# бэкап не открыть ничем — копия пароля должна быть у владельца в .secrets.md.
set -euo pipefail

KEYFILE=/root/.config/unbox-backup-key
SCRATCH_DB=unboxdb_restore_test

MODE="${1:-}"
FILE="${2:-}"
if [ -z "$MODE" ] || [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "Использование: $0 --check|--to-scratch|--to-prod <файл-бэкапа>"; exit 2
fi

# Поток дампа на stdout: расшифровать (если надо) и разжать.
stream() {
  case "$FILE" in
    *.gpg)
      [ -s "$KEYFILE" ] || { echo "ОШИБКА: нет $KEYFILE — расшифровать нечем"; exit 1; }
      gpg --quiet --batch --pinentry-mode loopback --passphrase-file "$KEYFILE" \
          --decrypt "$FILE" 2>/dev/null | gunzip ;;
    *.gz) gunzip -c "$FILE" ;;
    *)    cat "$FILE" ;;
  esac
}

case "$MODE" in
  --check)
    echo "Проверяю $FILE …"
    # ОДИН проход и никаких head/grep -q: они закрывают канал раньше времени,
    # gpg с gunzip получают SIGPIPE, и скрипт падает с кодом 141, хотя бэкап
    # целый. Считаем всё сразу одним awk.
    read -r LINES TABLES NOTES ROWS <<<"$(stream | awk '
        {l++}
        /^CREATE TABLE/ {t++}
        /therapist_notes/ {n=1}
        /^COPY /{r++}
        END {print l+0, t+0, n+0, r+0}')"
    [ "$LINES" -gt 100 ] || { echo "ОШИБКА: поток пустой или битый ($LINES строк)"; exit 1; }
    echo "  расшифровывается и разжимается: да ($LINES строк)"
    echo "  таблиц в дампе: $TABLES, блоков данных: $ROWS"
    [ "$NOTES" = "1" ] && echo "  таблица заметок на месте: да" \
                       || echo "  ВНИМАНИЕ: таблицы заметок в дампе НЕТ"
    echo "ИТОГ: бэкап пригоден к восстановлению"
    ;;

  --to-scratch)
    DB_URL=$(grep '^DATABASE_URL=' /var/www/unbox/backend/.env | cut -d= -f2- | tr -d '"'\''')
    echo "Разворачиваю в ЗАПАСНУЮ базу $SCRATCH_DB (боевую не трогаю) …"
    sudo -u postgres dropdb --if-exists "$SCRATCH_DB"
    sudo -u postgres createdb "$SCRATCH_DB"
    stream | sudo -u postgres psql -q "$SCRATCH_DB" >/dev/null 2>&1 || true
    echo "Сравнение (боевая → запасная):"
    for t in "user" booking cashbox_transactions therapist_clients therapy_sessions therapist_payments; do
      A=$(psql "$DB_URL" -At -c "SELECT count(*) FROM \"$t\";" 2>/dev/null || echo "?")
      B=$(sudo -u postgres psql -At -d "$SCRATCH_DB" -c "SELECT count(*) FROM \"$t\";" 2>/dev/null || echo "?")
      [ "$A" = "$B" ] && M="✓" || M="✗ РАСХОЖДЕНИЕ"
      printf "  %-24s боевая=%-8s из бэкапа=%-8s %s\n" "$t" "$A" "$B" "$M"
    done
    echo "Убрать запасную базу: sudo -u postgres dropdb $SCRATCH_DB"
    ;;

  --to-prod)
    echo "!!! Это ПЕРЕЗАПИШЕТ боевую базу данными из $FILE"
    read -r -p "Напишите ДА заглавными, чтобы продолжить: " ANS
    [ "$ANS" = "ДА" ] || { echo "отменено"; exit 1; }
    DB_URL=$(grep '^DATABASE_URL=' /var/www/unbox/backend/.env | cut -d= -f2- | tr -d '"'\''')
    systemctl stop unbox-api || true
    stream | psql "$DB_URL"
    systemctl start unbox-api
    echo "готово, сервис перезапущен"
    ;;

  *) echo "неизвестный режим: $MODE"; exit 2 ;;
esac
