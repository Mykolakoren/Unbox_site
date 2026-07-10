#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────
# unbox-cron-watchdog.sh — dead-man's-switch для денежного крона charge-due.
#
# Аудит §5#6: если списание за 24ч (`billing/charge-due`, каждые 10 мин) тихо
# перестанет работать — деньги перестанут списываться, и никто не узнает.
# In-app алерт (в самом charge-due) ловит сбои ВНУТРИ успешного запуска, но НЕ
# ловит «крон вообще не запустился» или «эндпоинт отдаёт 401/503» (тогда код
# приложения не выполняется). Этот сторож ловит именно это.
#
# Проверяет по логу крона (`>> /var/log/unbox-billing-cron.log`):
#   1) свежесть — лог не обновлялся > STALE_MIN мин → крон не запускается;
#   2) здоровье — в хвосте лога нет `"ok":true` → эндпоинт отвечает ошибкой.
# Алерт шлётся админу в Telegram НАПРЯМУЮ через bot API (не через наш backend —
# чтобы поймать и его падение). Дедуп через флаг: один алерт на инцидент.
#
# Установка: /usr/local/bin/unbox-cron-watchdog.sh + cron каждые 15 мин.
# Тест без отправки: WATCHDOG_DRY_RUN=1 ./unbox-cron-watchdog.sh
# ──────────────────────────────────────────────────────────────────────────
set -uo pipefail

LOG="${WATCHDOG_LOG:-/var/log/unbox-billing-cron.log}"
ENV_FILE="${WATCHDOG_ENV:-/var/www/unbox/backend/.env}"
STATE="${WATCHDOG_STATE:-/run/unbox-cron-watchdog.alerted}"
STALE_MIN="${WATCHDOG_STALE_MIN:-30}"

read_env() {
  grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- \
    | sed -e 's/^[[:space:]"'"'"']*//' -e 's/[[:space:]"'"'"']*$//'
}

alert() {
  local msg="$1"
  if [ "${WATCHDOG_DRY_RUN:-0}" = "1" ]; then
    echo "[DRY_RUN alert] $msg"
    return
  fi
  local bot chat
  bot="$(read_env TELEGRAM_BOT_TOKEN)"
  chat="$(read_env TELEGRAM_ADMIN_CHAT_ID)"
  [ -n "$bot" ] && [ -n "$chat" ] && curl -s -m 15 \
    "https://api.telegram.org/bot${bot}/sendMessage" \
    --data-urlencode "chat_id=${chat}" \
    --data-urlencode "text=${msg}" >/dev/null 2>&1 || true
}

problem=""
if [ ! -f "$LOG" ]; then
  problem="лог billing-крона не найден ($LOG)"
else
  age_min=$(( ( $(date +%s) - $(stat -c %Y "$LOG") ) / 60 ))
  if [ "$age_min" -ge "$STALE_MIN" ]; then
    problem="charge-due не писал в лог ${age_min} мин (порог ${STALE_MIN}) — крон не запускается?"
  elif ! tail -c 250 "$LOG" | grep -q '"ok":true'; then
    problem="charge-due отвечает ошибкой (нет ok в хвосте лога) — секрет протух / 401 / 503?"
  fi
fi

if [ -n "$problem" ]; then
  if [ ! -f "$STATE" ]; then
    alert "🚨 Денежный крон (списание за 24ч) — проблема: ${problem}. Списания могли остановиться, проверьте сервер/cron."
    touch "$STATE" 2>/dev/null || true
    echo "ALERT: $problem"
  else
    echo "still-problem (already alerted): $problem"
  fi
else
  rm -f "$STATE" 2>/dev/null || true
  echo "ok: billing cron healthy"
fi
