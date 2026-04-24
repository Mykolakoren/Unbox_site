# Руководство по локальной разработке (Development Guide)

Чтобы быстро вносить правки и видеть результат мгновенно (без деплоя), запускайте проект локально.

## 1. Подготовка
Убедитесь, что у вас установлены:
*   Python 3.10+
*   Node.js 18+

## 2. Запуск Бэкенда (Сервер)
Откройте **Терминал 1** и выполните:

```bash
cd backend
source venv/bin/activate  # Если venv еще не создан: python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

*   Сервер запустится на `http://127.0.0.1:8000`.
*   Флаг `--reload` означает, что сервер будет сам перезагружаться при изменении кода python.

## 3. Запуск Фронтенда (Сайт)
Откройте **Терминал 2** (новую вкладку) и выполните:

```bash
npm install
npm run dev
```

*   Сайт откроется на `http://localhost:5173`.
*   Все изменения в `.tsx` / `.css` файлах будут видны мгновенно (HMR).

## 4. Настройка связи (Важно!)
Чтобы ваш локальный сайт (localhost) общался с вашим локальным бэкендом (localhost), создайте файл `.env.local` в корне проекта (рядом с package.json):

```env
VITE_API_URL=http://127.0.0.1:8000/api/v1
```

## 5. База данных
По умолчанию локальный бэкенд создаст пустую базу `database.db` (SQLite) в папке `backend/`.

Если хотите работать с **продовой** базой локально — можно подключиться к Postgres на Droplet через SSH-туннель:

```bash
ssh -L 5432:localhost:5432 root@138.68.111.248 -i ~/.ssh/unbox_droplet_ed25519
# в другом терминале:
# DATABASE_URL=postgresql://unbox:PASSWORD@localhost:5432/unboxdb
```

*Осторожно: вы будете менять реальные данные клиентов.*

## Workflow (Рабочий процесс)
1.  Пишете код, смотрите результат в браузере на `localhost:5173`.
2.  `git add .`, `git commit`, `git push` в `feature/grid-house` или `main`.
3.  Деплой на прод — вручную, **скриптом `scripts/deploy.sh`** (см. [DEPLOY.md](./docs/DEPLOY.md)).

## Деплой — коротко
Продакшн живёт на **DigitalOcean Droplet** `138.68.111.248` (IP — постоянный).
Автоматического CI нет — деплой через SSH.

```bash
./scripts/deploy.sh         # фронт + бэк
./scripts/deploy.sh front   # только фронт
./scripts/deploy.sh back    # только бэк
```

Полные детали (пути, сервис, бэкапы, откат) — в [`docs/DEPLOY.md`](./docs/DEPLOY.md).
