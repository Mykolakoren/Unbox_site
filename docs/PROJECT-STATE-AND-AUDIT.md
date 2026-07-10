# UnboxCRM — Состояние проекта, аудит и открытые задачи

> **Обновлено: 2026-07-10.** Этот документ — «точка входа» для работы над проектом
> (в т.ч. с Claude в VS Code). Прочитай его целиком перед тем, как что-то менять:
> здесь описаны нетривиальные нюансы прод-окружения, которые легко сломать.
> Основные инструкции проекта — в [CLAUDE.md](../CLAUDE.md).
>
> **2026-07-10: закрыто 8 задач аудита** — §5#1, #2, #5, #6, #7, #8, #9, #12
> (см. отметки ✅ в §5) + баг GCal-событий за полночь (23:00) + подпись времени
> «Батуми» вместо «Тбилиси». Прод-код сведён с git (проверено побайтово по
> ключевым файлам). Остаётся §5#3, #4, #11 (см. §5).

---

## 0. TL;DR для быстрого старта

- **Прод-код сведён с git** (2026-07-10, проверено). НО серверный git-checkout всё
  ещё отстаёт/грязный, а бэкенд деплоился через `scp` (не коммит на сервере).
  Поэтому **всё ещё: деплой бэкенда ТОЛЬКО хирургически по файлам (scp), НЕ
  `deploy.sh back` и НЕ `git pull` на сервере** (см. §3).
- **Фронтенд деплоится целиком** (`deploy.sh front`) — это безопасно (сборка локально →
  scp → swap dist с бэкапом).
- **Бэкап БД теперь есть** (ночной `pg_dump`), но пока только локально на дроплете —
  off-box копии нет (см. §5 и открытую задачу).
- Сборка фронта = `npm run build` (это `tsc -b && vite build`). **Не полагайся на
  `vite build` в одиночку — он не проверяет типы** (этим я один раз уронил деплой).

---

## 1. Стек и топология

- **Frontend:** React 19 + TypeScript + Vite + Zustand + TailwindCSS. Дизайн-система «Grid House» (GH).
- **Backend:** FastAPI + SQLModel + PostgreSQL.
- **Прод:** DigitalOcean droplet `138.68.111.248` (домен `unbox.com.ge`), Ubuntu + nginx.
  - Фронт: статика в `/var/www/unbox/dist`.
  - Бэк: `/var/www/unbox/backend`, systemd `unbox-api.service`, uvicorn на `127.0.0.1:8000`.
  - БД: Postgres `localhost:5432/unboxdb` на том же дроплете (~22 МБ).
- **SSH:** `root@138.68.111.248`, ключ `~/.ssh/unbox_droplet_ed25519`.

---

## 2. ⚠️ Прод/локальная дивергенция — читать обязательно

Обнаружено 2026-06-11. Прод-бэкенд **правился прямо на сервере** (десятки uncommitted
файлов) и разошёлся с локальной веткой в **обе стороны**:

- На проде есть код, которого НЕ было локально (легко снести «навалом»):
  - эндпоинт `set_vacation` в `backend/app/api/v1/users/profile.py`;
  - эндпоинт `correct_user_balance` (`/balance-correction`) в `backend/app/api/v1/users/admin.py`;
  - фильтр `include_inactive`/`is_active` в `backend/app/api/v1/resources.py` и `locations.py`
    (скрывает неактивные филиалы/кабинеты от клиентов).
- `deploy.sh back` делает `git pull --ff-only origin main` — на сервере ветка `main`
  застряла на апреле, working tree грязный. **`git pull` на сервере опасен** (снесёт
  живые патчи или упадёт).

**Вывод:** прод-бэкенд = источник правды для «что реально в проде». Локаль — для разработки.
Перед деплоем любого backend-файла всегда сверяй серверную версию (см. §3).

---

## 3. Как правильно деплоить

### Фронтенд (безопасно, целиком)
```bash
export UNBOX_SSH_KEY="$HOME/.ssh/unbox_droplet_ed25519"
npm run build            # ОБЯЗАТЕЛЬНО tsc -b && vite build — проверь exit 0, 0 TS errors
./scripts/deploy.sh front  # сборка локально → scp → swap dist с бэкапом dist-backup-<ts> → nginx reload
# проверка: curl -s https://unbox.com.ge/ | grep -oE 'index-[A-Za-z0-9_-]+\.js'  (совпадает с локальным dist)
```
Откат фронта: на сервере `mv /var/www/unbox/dist-backup-<ts> /var/www/unbox/dist && systemctl reload nginx`.

### Бэкенд (ТОЛЬКО хирургически, по файлам)
```bash
KEY=$HOME/.ssh/unbox_droplet_ed25519
# 1) сверить серверную версию файла с локальной — убедиться, что разница = только твои правки
scp -q -i "$KEY" root@138.68.111.248:/var/www/unbox/backend/app/<path>.py /tmp/srv.py
diff /tmp/srv.py backend/app/<path>.py
# 2) бэкап на сервере + заливка + рестарт с авто-откатом при падении сервиса
ssh -i "$KEY" root@138.68.111.248 'cp /var/www/unbox/backend/app/<path>.py /var/www/unbox/backend/<name>.bak-$(date +%s)'
scp -q -i "$KEY" backend/app/<path>.py root@138.68.111.248:/var/www/unbox/backend/app/<path>.py
ssh -i "$KEY" root@138.68.111.248 'systemctl restart unbox-api.service; sleep 8; systemctl is-active unbox-api.service'
# 3) health-check: curl https://unbox.com.ge/api/v1/specialists -L  → 200
```
> `systemctl is-active` возвращает `active`, даже если uvicorn ещё стартует —
> сразу после рестарта curl может дать `000`. Подожди ~8–15 сек и проверяй по
> реальному эндпоинту (`/api/v1/specialists` → 200).

---

## 4. Что сделано (сессии июнь–июль 2026)

Ключевые изменения этой большой сессии (все закоммичены, запушены, задеплоены):

| Область | Что |
|---|---|
| **Скидка** | Comp-аккаунты (`koren.nikolas@gmail.com`, `irina.cbtpsy@gmail.com`) — 100% бесплатно на всё, включая пик. `COMP_ACCOUNTS` в `backend/app/services/pricing.py`. |
| **Маячок** | Админ-алерт «много будущих броней у клиента» (>20, вкл. серии) — `_maybe_alert_booking_overload` в `bookings/routes.py`. |
| **Безопасность** | `telegram_id` убран из самообновления профиля; вебхук/крон-секреты fail-closed (без bot-token фолбэка); скидка зажата 0–100 + право `set_discount`; аплоад task-файлов по белому списку (stored-XSS). |
| **Логика броней** | TZ-фикс CRM-синка; отмена серии (правило 24ч + отвязка сессий + пересчёт цепочек); мульти-слот camelCase; reschedule pending без двойного списания; окна Neo School на бэке; mark-all-paid на UTC. |
| **Прошлые даты** | Бэкенд-гард `_assert_start_not_past` во всех 3 путях создания: не-админ — нельзя в прошлое, админ — до 12ч назад. |
| **Частичная отмена (trim)** | `POST /bookings/{id}/trim` — режет часть блока, оставляет остатки ≥1ч, пересчитывает скидку, возвращает разницу. UI — модалка «Отменить часть» в `MyBookingsPage`, `CrmChessboardView`, `mobile/BookingDetailSheet`. Усилен: row-lock, возврат от `charge_amount`, возврат пиковой надбавки абонемента, GCal в фон после коммита, отвязка CRM-сессий. |
| **CRM бронь под сессию** | Починен регресс `da8a601`: кнопка ведёт на `/dashboard/bookings` (там подсветка+привязка), `DashboardLayout` пропускает специалиста при `crmMode` (оба редиректа). |
| **Стабильность фронта** | `/dashboard` обёрнут в `ModuleErrorBoundary`; `ProfilePage` не падает без имени; защита от двойного клика на «Продлить +30 мин» и «Оплатить сессию». |
| **SEO/PWA** | `lang=ru`, meta description, Open Graph, JSON-LD LocalBusiness, `robots.txt`, `sitemap.xml`, `og-cover.jpg`, фикс stale-shell в service worker. |
| **Мобайл** | Глобальный `font-size:16px` (iOS зум), pull-to-refresh на реальном контейнере, scroll-lock bottom-sheet, InstallBanner на всех вкладках. |
| **Ops** | Ночной бэкап БД (`scripts/unbox-db-backup.sh` → `/usr/local/bin` + cron 02:00, 14 дней). |

---

## 5. Задачи из аудита (приоритизировано)

Аудит 2026-07-06 (4 агента). **2026-07-10 закрыто 8 задач** — отмечены ✅ с коммитом.
Каждый фикс деплоился хирургически и проверялся на проде (rollback/e2e-тесты).

### 🔴 Критично

1. ✅ **[закрыто `f1b2da8`] Абонемент→баланс при списании за 24ч давал бесплатную комнату.**
   `billing_defer.settle_pending_charge`: в fallback-ветке теперь пересчитываем реальную
   кэш-цену через `PricingService.calculate_price` (а не stored `final_price` ≈0). Проверено:
   истёкший абон → списывает 36₾, не 0; валидный абон жжёт часы; balance не затронут.

2. ✅ **[закрыто `2107199`] Серии зовут Google Calendar синхронно в цикле.**
   Убран синхронный `create_event` из цикла; после `session.commit()` планируется
   `_gcal_create_in_background` для каждой закоммиченной брони (эндпоинт получил
   `background_tasks`). E2e: серия из 2 за 0.18–0.26с, event_id в фоне, призраков нет.
   CRM-push (stamp TS инлайн) оставлен синхронным — отдельная мелкая задача.

3. ⏳ **Off-box бэкап БД + снапшоты дроплета.** Ночной дамп на том же дроплете — от потери
   сервера не спасает. Нужны доступы владельца: (а) weekly snapshots в панели DigitalOcean;
   (б) выгрузка дампов в DO Spaces (`s3cmd`) / `rsync` на другой хост. **ОТКРЫТО (инфра).**

4. ⏳ **Alembic-миграции.** Уточнение: `run_migrations()` в `create_tables.py` УЖЕ добавляет
   колонки через `ALTER TABLE ADD COLUMN IF NOT EXISTS` (им добавляли documents/badges/
   контакты — работает). «Молчаливого 500 на новой колонке» нет. Alembic желателен, но не
   срочен. **ОТКРЫТО (инфра, низкий приоритет).**

### 🟠 Важно

5. ✅ **[закрыто `fd65a26`] Трекинг ошибок бэкенда.** Опт-ин Sentry в `main.py` (полный
   no-op без пакета/DSN). **Активация на проде:** `venv/bin/pip install "sentry-sdk[fastapi]"`
   + `SENTRY_DSN=...` в `.env`. (Пакет пока НЕ установлен — код готов, включение за владельцем.)

6. ✅ **[закрыто `fd65a26`] Крон-мониторинг.** `charge-due` теперь пингует админа в TG при
   непустых `failures`. Внешний dead-man's-switch (healthchecks.io на «крон не запустился»)
   — остаётся открытым (нужен аккаунт).

7. ✅ **[закрыто `d990ad8`] `create_booking` широкий except → 400.** Теперь `ValueError`
   (известные валидации) → 400, непредвиденное → 500 generic + `logger.exception`.

8. ✅ **[закрыто `fd65a26`] Деплой-health-gate.** `deploy.sh front`: после swap `curl / == 200`
   с авто-откатом, откат при битом `nginx -t`, прунинг `dist-backup-*` до 3.

### 🟡 Мелочи

9. ✅ **[закрыто `d990ad8`] `_is_peak_time` падал на битой строке времени** — try-guard,
   на ошибке «не пик». Проверено: `''`/`bad`/`None` → False без исключения.
10. ⏳ **Overload-алерт может ошибиться в счёте** при админ-брони через полночь. Не критично
    (только уведомление). **ОТКРЫТО (минор, оставлено осознанно).**
11. ⏳ **`payment_method='bonus'` + defer >24ч** списывает баланс, а не бонусный пул
    (`billing_defer` bonus-ветка). Нет готового FIFO-хелпера — это мини-фича с денежной
    бухгалтерией, делать отдельным заходом (согласовать: частичное покрытие? отмена?).
    **ОТКРЫТО (риск, требует дизайна).**
12. ✅ **[закрыто `2efab6a`] `waive_charge` sub→balance** — возврат часов только если
    `hours_deducted>0`; иначе возврат ДЕНЕГ. settle помечает `hours_deducted=0` при fallback.
    Проверено: (A) sub+часы → часы; (B) sub→баланс → +36₾; (C) balance → +36₾.
13. ✅ **Concurrency двух trim'ов** — закрыто row-lock'ом (полная availability остатка не
    делается осознанно — остаток внутри уже занятого слота).

### 🆕 Найдено/сделано вне списка аудита

- ✅ **[закрыто `0bc3d67`] GCal 400 для брони 23:00** — `create_event` считал конец как
  `end_h = total_minutes // 60` → «T24:00:00» (невалидно) для брони, уходящей за полночь.
  Теперь конец = `start + timedelta(duration)`, полночь обрабатывается. E2e-проверено.
- ✅ **[закрыто `0d22618`] Подпись времени «Батуми» вместо «Тбилиси»** (тот же UTC+4, клиенты
  путались) — во всех 3 user-facing местах (CRM-шит, 2 TG-сообщения).

---

## 6. Операционка: доступы, env, cron, бэкап

### Env-переменные (сервер: `/var/www/unbox/backend/.env`)
Выставлены и нужны для загрузки/фич: `DATABASE_URL`, `SECRET_KEY`, `ENVIRONMENT=production`,
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_REMINDER_SECRET`,
`TELEGRAM_ADMIN_CHAT_ID`, Google Calendar creds.
- ⚠️ **`DATABASE_URL` пропал → приложение молча падает на SQLite** (`db/session.py`) —
  выглядит здоровым, но данные не те. Самая коварная переменная.
- ⚠️ `TELEGRAM_REMINDER_SECRET` — fail-closed: без него billing-крон и напоминания = 503.
  Если ротируешь — обнови и в crontab (`charge-due` и `daily-summary`).
- `.env.example` устарел — не отражает половину нужных переменных (открытая задача).

### Cron (на сервере, `crontab -l`)
- `*/10 * * * *` → `billing/charge-due` (списание за 24ч, **деньги**).
- `0 5 * * *` → `telegram/daily-summary`.
- `0 1 * * 1` → `run_weekly_rebate.py`.
- `0 2 * * *` → `/usr/local/bin/unbox-db-backup.sh` (**бэкап БД**, добавлен 2026-07-06).
- `0 3 * * *` → `certbot renew`.
> Crontab живёт только на сервере (не в git) — при пересоздании дроплета потеряется.
> Задача: вынести в `ops/crontab` + `install-cron.sh`.

### Бэкап БД
- Скрипт: `scripts/unbox-db-backup.sh` (в репо) = `/usr/local/bin/unbox-db-backup.sh` (на сервере).
- Дампы: `/var/backups/unbox-db/unbox-<ts>.sql.gz`, хранение 14 дней, проверка размера.
- Ручной прогон: `ssh root@138.68.111.248 /usr/local/bin/unbox-db-backup.sh`.
- Восстановление: `zcat unbox-<ts>.sql.gz | psql "$DATABASE_URL"` (на пустую/пересозданную БД).
- **Off-box копии пока НЕТ** — см. открытую задачу №3.
- Старые ручные дампы перед рисковыми операциями: `/var/backups/unbox-pre-*.sql.gz`.

---

## 7. Заметки для локальной разработки

- `.env.local` иногда указывает `VITE_API_URL` на **прод** (для визуальных тестов) —
  **верни на `http://127.0.0.1:8000/api/v1`** перед локальным запуском, иначе формы уйдут в прод.
- Локальная БД — SQLite (`backend/database.db`), пустая. Прод — Postgres.
- Локальный venv неполный (нет `slowapi` и др.) — полный бэкенд локально не поднимется без
  доустановки. `app.services.pricing` импортируется автономно (удобно для юнит-тестов логики).
- Запуск: `npm run dev` (5173) + `uvicorn app.main:app --reload --port 8000` (нужен полный venv).

---

## 8. Git

- Работа велась на `feature/mobile-experience` / `main` (истории местами разъезжались —
  см. CLAUDE.md про «один trunk»). Всё запушено в `origin/feature/mobile-experience`.
- Любая разрушающая git-операция (force-push, reset) — только с бэкапом ветки и
  `--force-with-lease`, см. CLAUDE.md.
