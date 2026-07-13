# Конфиги прод-сервера (эталон в git)

Забраны с дроплета 2026-07-14. Раньше существовали ТОЛЬКО на сервере —
пересоздание дроплета означало восстановление по памяти.

| Файл в репо | Где живёт на сервере |
|---|---|
| `ops/nginx/unbox.conf` | `/etc/nginx/sites-enabled/unbox` |
| `ops/systemd/unbox-api.service` | `/etc/systemd/system/unbox-api.service` |
| `ops/crontab` | `crontab -l` (root) |
| `ops/unbox-cron-watchdog.sh` | `/usr/local/bin/unbox-cron-watchdog.sh` |
| `scripts/unbox-db-backup.sh` | `/usr/local/bin/unbox-db-backup.sh` |

## Что подтвердил systemd-юнит

`WorkingDirectory=/var/www/unbox/backend` — вот почему прод не страдал от бага
с относительным путём к `.env` (см. коммит про config.py): сервис всегда
стартовал из нужной папки. А вот разовые скрипты и cron без `cd` — страдали.

`Restart=always`, `RestartSec=3`, логи в `/var/log/unbox.log`.
Лимитов памяти (`MemoryMax`) нет — при OOM ядро выбирает жертву по размеру,
и это обычно Postgres. Открытая задача.

## ⚠️ ОТКРЫТО: gzip не жмёт JS/CSS

В `/etc/nginx/nginx.conf` стоит `gzip on`, но `gzip_types` **закомментирован**.
По умолчанию nginx жмёт только `text/html`, поэтому бандл едет несжатым:

```
$ curl -H "Accept-Encoding: gzip" -o /dev/null -w '%{size_download}' \
    https://unbox.com.ge/assets/index-*.js
589 KB      # content-encoding отсутствует
```

Ожидаемый эффект от включения: **589 KB → ~150 KB** на каждого посетителя.
Правка (в `/etc/nginx/nginx.conf`, блок Gzip Settings):

```nginx
gzip on;
gzip_vary on;
gzip_proxied any;
gzip_comp_level 5;
gzip_min_length 1024;
gzip_types text/plain text/css text/xml text/javascript
           application/json application/javascript application/xml
           application/xml+rss image/svg+xml;
```
Затем `nginx -t && systemctl reload nginx`. Ждёт решения владельца.

## ⚠️ ОТКРЫТО: /health не проксируется наружу

Бэкенд отдаёт честный `/health` (с проверкой БД), но nginx этот путь не
проксирует — снаружи `https://unbox.com.ge/health` возвращает фронтенд.
Для внешнего аптайм-мониторинга нужен `location = /health { proxy_pass
http://127.0.0.1:8000/health; }`.
