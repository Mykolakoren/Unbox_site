#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────
# unbox-cron-run.sh — запуск задачи крона с тревогой при сбое.
#
# 12.10: счёт за неделю (weekly_invoices.py) в первый же понедельник упал
# «No module named 'app'», и никто не узнал — сторож крона следил только за
# списаниями (unbox-cron-watchdog.sh). Эта обёртка: пишет вывод в свой лог и,
# если команда завершилась с ошибкой (код ≠ 0), шлёт в «Ленту» админов
# (TELEGRAM_ADMIN_CHAT_ID) имя задачи и хвост ошибки — напрямую через bot API,
# без backend (чтобы поймать и его падение).
#
# Крон:  0 5 * * 1 /usr/local/bin/unbox-cron-run.sh weekly-invoices \
#            /var/www/unbox/backend/venv/bin/python3 scripts/weekly_invoices.py
# Рабочая папка — /var/www/unbox/backend. Лог — /var/log/unbox-<имя>.log.
# Тест без отправки: CRON_RUN_DRY=1 unbox-cron-run.sh test false
# CRON_RUN_OK_CODES="0 1" — коды, которые сбоем не считаются (money_audit
# возвращает 1, когда нашёл нарушения, — у него своя тревога). Трассировка
# Python в выводе («Traceback») — сбой при любом коде.
# ──────────────────────────────────────────────────────────────────────────
set -uo pipefail

NAME="${1:?имя задачи}"; shift
WORKDIR="${CRON_RUN_WORKDIR:-/var/www/unbox/backend}"
LOG="${CRON_RUN_LOG:-/var/log/unbox-${NAME}.log}"
ENV_FILE="${CRON_RUN_ENV:-/var/www/unbox/backend/.env}"

read_env() {
  grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- \
    | sed -e 's/^[[:space:]"'"'"']*//' -e 's/[[:space:]"'"'"']*$//'
}

out="$(mktemp)"
cd "$WORKDIR" || { echo "[cron-run] нет папки $WORKDIR" >>"$LOG"; exit 1; }
"$@" >"$out" 2>&1
code=$?
{ echo "── $(date -u '+%F %T') UTC · $NAME · код $code"; cat "$out"; } >>"$LOG"

OK_CODES=" ${CRON_RUN_OK_CODES:-0} "
failed=0
case "$OK_CODES" in *" $code "*) ;; *) failed=1 ;; esac
grep -q "Traceback (most recent call last)" "$out" && failed=1

if [ "$failed" -eq 1 ]; then
  tail_txt="$(tail -n 6 "$out" | cut -c1-300)"
  msg="🚨 Задача по расписанию «${NAME}» упала (код ${code}). Хвост ошибки:
${tail_txt}
Лог на сервере: ${LOG}"
  if [ "${CRON_RUN_DRY:-0}" = "1" ]; then
    echo "[DRY alert] $msg"
  else
    bot="$(read_env TELEGRAM_BOT_TOKEN)"
    chat="$(read_env TELEGRAM_ADMIN_CHAT_ID)"
    [ -n "$bot" ] && [ -n "$chat" ] && curl -s -m 15 \
      "https://api.telegram.org/bot${bot}/sendMessage" \
      --data-urlencode "chat_id=${chat}" \
      --data-urlencode "text=${msg}" >/dev/null 2>&1 || true
  fi
fi
rm -f "$out"
exit "$code"
