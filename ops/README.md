# ops/ — операционка прод-дроплета

Файлы для восстановления/сопровождения прод-сервера `138.68.111.248`.

## Содержимое

- **`crontab`** — эталонная копия crontab прод-дроплета (root). Секреты
  заредактированы (`<REMINDER_SECRET>`) — реальные в `/var/www/unbox/backend/.env`.
- **`unbox-cron-watchdog.sh`** — сторож денежного крона `charge-due`
  (dead-man's-switch, аудит §5#6). Ставится в `/usr/local/bin/`.
- **`../scripts/unbox-db-backup.sh`** — ночной бэкап БД (уже в `scripts/`).

## Установка на сервере

```bash
# 1) Сторож крона
scp ops/unbox-cron-watchdog.sh root@138.68.111.248:/usr/local/bin/
ssh root@138.68.111.248 'chmod +x /usr/local/bin/unbox-cron-watchdog.sh'
# самопроверка без отправки:
ssh root@138.68.111.248 'WATCHDOG_DRY_RUN=1 /usr/local/bin/unbox-cron-watchdog.sh'  # → "ok: billing cron healthy"

# 2) Крон — сверить/восстановить (секреты подставить из .env!)
ssh root@138.68.111.248 'crontab -l'   # сверить с ops/crontab
# при восстановлении дроплета: отредактировать ops/crontab (вписать секрет),
# затем: crontab ops/crontab
```

## Сторож крона — как работает

`charge-due` (списание за 24ч, `*/10`) пишет в `/var/log/unbox-billing-cron.log`.
Сторож (`*/15`) проверяет:
1. **свежесть** — лог не обновлялся > 30 мин → крон не запускается;
2. **здоровье** — в хвосте лога нет `"ok":true` → эндпоинт отвечает ошибкой (401/503, протухший секрет).

При проблеме шлёт **один** алерт админу в Telegram напрямую через bot API
(не через backend — чтобы поймать и его падение). Флаг `/run/unbox-cron-watchdog.alerted`
не даёт спамить; снимается автоматически, когда крон снова здоров.

Тест: `WATCHDOG_DRY_RUN=1 WATCHDOG_LOG=<файл> WATCHDOG_STATE=/tmp/x ./unbox-cron-watchdog.sh`.

## Открытые ops-задачи (см. docs/PROJECT-STATE-AND-AUDIT.md §5)

- §5#3 — off-box бэкап БД (DO Spaces / другой хост) + weekly snapshots DigitalOcean. Нужны доступы.
- §5#4 — Alembic (сейчас работает `run_migrations` через ALTER IF NOT EXISTS).
