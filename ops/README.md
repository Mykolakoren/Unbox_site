# ops/ — операционка прод-дроплета

Файлы для восстановления/сопровождения прод-сервера `138.68.111.248`.

## Содержимое

- **`crontab`** — эталонная копия crontab прод-дроплета (root). Секреты
  заредактированы (`<REMINDER_SECRET>`) — реальные в `/var/www/unbox/backend/.env`.
- **`unbox-cron-watchdog.sh`** — сторож денежного крона `charge-due`
  (dead-man's-switch, аудит §5#6). Ставится в `/usr/local/bin/`.
- **`../scripts/unbox-db-backup.sh`** — ночной бэкап БД (уже в `scripts/`).
  С 2026-07-21 дамп **шифруется** (GPG AES256), файлы `*.sql.gz.gpg`.
  Пароль: `/root/.config/unbox-backup-key` (root-only) + копия в `.secrets.md`.
  **Потеря пароля = бэкапы не восстановить.** Нет файла с паролем → бэкап
  делается открытым с воплем в лог (остаться без бэкапа хуже) и наружу НЕ
  выгружается.
- **`../scripts/unbox-db-restore.sh`** — восстановление и проверка бэкапа:
  `--check <файл>` (ничего не меняет), `--to-scratch <файл>` (разворачивает
  в запасную базу и сверяет счётчики с боевой), `--to-prod <файл>` (перезапись
  боевой, спросит подтверждение). Проверять бэкапы полезно регулярно —
  непроверенный бэкап это не бэкап.

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

## Off-box бэкап БД → DigitalOcean Spaces (§5#3)

Ночной `unbox-db-backup.sh` пишет локально в `/var/backups/unbox-db` И (если
настроено) выгружает свежий дамп в DO Spaces через `rclone`. Локальный бэкап
защищает от DROP/битой миграции; off-box — от полной потери дроплета.
Пока не настроено — off-box просто пропускается (локальный работает как раньше).

**Что сделать владельцу (панель DigitalOcean):**
1. **Spaces Object Storage → Create a Space:** регион (напр. Frankfurt `fra1`),
   имя бакета (напр. `unbox-backups`), доступ — Private.
2. **API → Spaces Keys → Generate New Key:** скопировать **Access Key** и
   **Secret Key** (секрет показывается один раз!).
3. **Droplet → Backups → Enable** (weekly snapshots всего дроплета).

**На сервере (ключи вставляются тут, НЕ в переписку):**
```bash
ssh root@138.68.111.248
nano /root/.config/rclone/rclone.conf     # вписать access_key_id, secret_access_key,
                                          # endpoint = <регион>.digitaloceanspaces.com
nano /root/.config/unbox-offsite.env      # раскомментить: UNBOX_OFFSITE_REMOTE=spaces:unbox-backups/db
/usr/local/bin/unbox-db-backup.sh         # тест → строка "OFFSITE-OK ..."
rclone ls spaces:unbox-backups/db         # проверить, что дамп там появился
```
Дальше выгрузка идёт автоматически ночью (существующий cron `0 2`). Удалённая
ретенция — 30 дней (`UNBOX_OFFSITE_KEEP_DAYS`). Восстановление off-box:
`rclone copy spaces:unbox-backups/db/unbox-<ts>.sql.gz .` → `zcat ... | psql "$DATABASE_URL"`.

## Открытые ops-задачи (см. docs/PROJECT-STATE-AND-AUDIT.md §5)

- §5#4 — Alembic (сейчас работает `run_migrations` через ALTER IF NOT EXISTS).
