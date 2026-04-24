# Деплой

Вся инфраструктура Unbox живёт на **DigitalOcean Droplet** `138.68.111.248`.
Больше никаких Vercel / Render / Neon — если где-то встретите упоминание, это артефакт старого кода, можно смело игнорировать или удалить.

## TL;DR

```bash
./scripts/deploy.sh           # фронт + бэк
./scripts/deploy.sh front     # только фронт
./scripts/deploy.sh back      # только бэк
```

## Что где живёт

| Сервис | Путь на Droplet | Замечание |
|---|---|---|
| Статика фронта (nginx root) | `/var/www/unbox/dist` | Отсюда `unbox.com.ge` отдаёт index.html + assets |
| Исходники фронта (сборка) | `/var/www/unbox-beta` | `package.json`, `node_modules`, `src/`. Build обычно делаем **локально** — Droplet имеет только 458 MB RAM, Vite у него OOM-ит. |
| Бэкенд (FastAPI/Uvicorn) | `/var/www/unbox/backend` | Отсюда systemd запускает uvicorn. Venv: `venv/bin/python3`. |
| Бэкенд (зеркало, git pull здесь) | `/var/www/unbox-beta/backend` | Второй чекаут — исторически. `git pull` делаем в обе папки. |
| Nginx config | `/etc/nginx/sites-enabled/unbox` | unbox.com.ge → `:8000` (uvicorn) + статика из `dist/` |
| Лог бэка | `/var/log/unbox.log` | Пишется через systemd unit `StandardOutput=append:…` |
| Postgres | `localhost:5432/unboxdb` | Пароль в `/var/www/unbox/backend/.env` (DATABASE_URL) |

## systemd unit

`/etc/systemd/system/unbox-api.service` — запускает uvicorn из `/var/www/unbox/backend/venv/bin/uvicorn` с параметрами `app.main:app --host 127.0.0.1 --port 8000`, `Restart=always`, логи в `/var/log/unbox.log`.

```bash
systemctl restart unbox-api.service
systemctl status  unbox-api.service
tail -30 /var/log/unbox.log
```

## SSH

```bash
ssh root@138.68.111.248 -i ~/.ssh/unbox_droplet_ed25519
```

Если ключа у вас на машине нет — его можно сгенерировать и добавить в `~/.ssh/authorized_keys` на Droplet через Web Console в панели DigitalOcean.

## Как фронт деплоится вручную (без скрипта)

```bash
# 1. Локально
cd ~/Desktop/Projects/UnboxCRM
npm run build
tar czf /tmp/unbox-dist.tgz -C dist .
scp -i ~/.ssh/unbox_droplet_ed25519 /tmp/unbox-dist.tgz root@138.68.111.248:/tmp/

# 2. На Droplet
ssh -i ~/.ssh/unbox_droplet_ed25519 root@138.68.111.248 '
  TS=$(date +%Y%m%d-%H%M%S)
  mkdir /tmp/dist-new && tar xzf /tmp/unbox-dist.tgz -C /tmp/dist-new
  mv /var/www/unbox/dist /var/www/unbox/dist-backup-$TS
  mv /tmp/dist-new /var/www/unbox/dist
  nginx -t && systemctl reload nginx
'
```

## Как бэк деплоится вручную

```bash
ssh -i ~/.ssh/unbox_droplet_ed25519 root@138.68.111.248 '
  cd /var/www/unbox/backend && git pull --ff-only origin main
  cd /var/www/unbox-beta/backend && git pull --ff-only origin main
  systemctl restart unbox-api.service
  sleep 4 && systemctl is-active unbox-api.service
  tail -15 /var/log/unbox.log
'
```

## Откат фронта

Бэкапы сохраняются в `/var/www/unbox/dist-backup-<timestamp>`. Откат:

```bash
ssh -i ~/.ssh/unbox_droplet_ed25519 root@138.68.111.248 '
  latest=$(ls -t /var/www/unbox/dist-backup-* -d | head -1)
  rm -rf /var/www/unbox/dist
  mv "$latest" /var/www/unbox/dist
  systemctl reload nginx
'
```

## База данных

Postgres `unboxdb` на `localhost:5432` Droplet'а. Полный `DATABASE_URL` (с паролем) лежит в:

- На Droplet: `/var/www/unbox/backend/.env` → строка `DATABASE_URL=…`
- У вас локально: в корне проекта файл `.secrets.md` (он в `.gitignore`, в публичный репо не уходит).

Подключение:

```bash
# На Droplet — без передачи пароля, читаем из .env
ssh -i ~/.ssh/unbox_droplet_ed25519 root@138.68.111.248 \
  'export $(grep DATABASE_URL /var/www/unbox/backend/.env); psql "$DATABASE_URL"'

# Локально через SSH-туннель
ssh -L 5432:localhost:5432 root@138.68.111.248 -i ~/.ssh/unbox_droplet_ed25519
# В другом терминале:
# psql "postgresql://unbox:<PASSWORD>@localhost:5432/unboxdb"
```

## Бэкапы БД

Автобэкапа сейчас нет (тех. долг). Ручной дамп:

```bash
ssh -i ~/.ssh/unbox_droplet_ed25519 root@138.68.111.248 \
  'export $(grep DATABASE_URL /var/www/unbox/backend/.env); pg_dump "$DATABASE_URL" | gzip' \
  > ~/unbox-$(date +%Y%m%d).sql.gz
```

## Ограничения Droplet

- RAM всего 458 MB — **Vite build на сервере OOM-ит**, собираем локально
- Диск почти полный (88%) — периодически чистим `/var/www/unbox/dist-backup-*`
- 1 CPU, 2 GB swap — прод нагружается по мере роста, думаем про upgrade
