# UnboxCRM — Контекст проекта

## Что это
Fullstack CRM + система бронирования кабинетов для центра психологии Unbox (unbox.com.ge).
- **Frontend**: React 19 + TypeScript + Vite + Zustand + TailwindCSS
- **Backend**: Python FastAPI + SQLModel + PostgreSQL
- **Хостинг**: DigitalOcean Droplet (138.68.111.248), Ubuntu + nginx, домен unbox.com.ge
- **Деплой**: `./scripts/deploy.sh` (см. [docs/DEPLOY.md](docs/DEPLOY.md)). Vercel/Render НЕ используются.
- **Доступы (SSH-ключ, пароль БД, токены)**: локальный файл `.secrets.md` в корне — в `.gitignore`, в публичный репо не уходит.

## Структура
```
/Users/mykola/Desktop/Projects/UnboxCRM/
├── backend/           # FastAPI app
│   ├── app/
│   │   ├── api/v1/    # Endpoints (bookings, users, crm, cashbox, bonuses)
│   │   ├── models/    # SQLModel models
│   │   ├── services/  # Pricing, booking, google_calendar, crm_calendar
│   │   ├── core/      # Config, security, permissions
│   │   └── db/        # Session, init_data
│   └── .env           # DATABASE_URL=postgresql://unbox:…@localhost:5432/unboxdb (пароль в .secrets.md)
├── src/               # React frontend
│   ├── pages/         # Pages (admin/, crm/, ExplorePage, etc.)
│   ├── components/    # UI components (Wizard/, admin/, crm/, landing/)
│   ├── store/         # Zustand stores (userStore, bookingStore, crmStore)
│   ├── api/           # API clients (bookings, crm, cashbox, bonuses)
│   └── utils/         # Pricing, currency, data, calendar
└── public/            # Static assets
```

## Деплой

Полная документация (пути, systemd, откат, БД) — [`docs/DEPLOY.md`](docs/DEPLOY.md).

### Коротко
```bash
./scripts/deploy.sh           # фронт + бэк
./scripts/deploy.sh front     # только фронт (local build → scp → swap)
./scripts/deploy.sh back      # только бэк (git pull + systemctl restart)
```

### Серверная топология
- **unbox.com.ge** (prod) → nginx → `/var/www/unbox/dist` (статика фронта) + `127.0.0.1:8000` (uvicorn через systemd `unbox-api.service`).
- Фронт собирается **локально** (на Droplet 458 MB RAM, Vite OOM-ит), заливается `scp`, свопается с бэкапом `dist-backup-<ts>`.
- Бэк живёт в `/var/www/unbox/backend` (там venv + код). `git pull` — в `/var/www/unbox/backend` и `/var/www/unbox-beta/backend` (два зеркала исторически).


## Ключевые модули

### Бронирования
- `POST /bookings/` — создание брони (balance/subscription/bonus)
- `POST /bookings/recurring` — повторяющиеся еженедельные брони
- `DELETE /bookings/recurring/{group_id}` — отмена серии
- Шахматка: AdminChessboardView (админ), CrmChessboardView (CRM)
- Админы могут бронировать задним числом (12 часов)

### CRM (Psy-CRM)
- Клиенты, сессии, платежи, заметки
- Google Calendar sync (двусторонний через alias codes #XXXX)
- Strict name matching (не путает "Александр" и "Александр Петров")
- `mark-all-paid` не трогает будущие сессии

### Финансы (Cashbox)
- Транзакции с фильтром по периоду
- Категории (при выборе "Абонементы" → выбор тарифа с автозаполнением суммы)
- Баланс по методам оплаты

### Бонусы
- Welcome bonus: 1 час бесплатно при регистрации (90 дней)
- Оплата бронирования бонусами (payment_method='bonus')
- FIFO списание при использовании

### Абонементы (тарифы)
- Пробный: 4ч + 1ч капсула, 70₾, 14 дней
- Тёплый старт: 10ч + 4ч капсула, 180₾, 30 дней
- Регулярный практик: 20ч + 6ч капсула, 350₾, 30 дней
- Профи+: 40ч + 10ч капсула, 650₾, 45 дней
- Групповой мастер: 20ч груп. + 4ч инд., 450₾, 45 дней

## Известные баги (TODO)
1. **Перенос бронирования (reschedule)** — wizard показывает старое время вместо нового, создаёт дубликат вместо обновления. Нужен глубокий рефакторинг flow в ConfirmationStep.tsx
2. **Задолженности в CRM Финансы** — показывает долг только за выбранный месяц, а не общий

## Текущие задачи (контент)
1. Скачать фото кабинетов с unbox.center и загрузить на сервер
2. Создать галерею кабинетов (несколько фото + видео)
3. Обновить специалистов реальными данными (17 человек с unbox.center)
4. Улучшить страницу кабинетов с детальными описаниями
5. Добавить инфографику ценовой политики и скидок на страницу тарифов

## Реальные данные кабинетов (с unbox.center)

### UNBOX ONE (Палиашвили 4, Батуми)
- Кабинет 1: 9м², 4 чел., 20₾/ч, песочная терапия, фото: /img/offices/miniature_cab_1_pal.jpg
- Кабинет 2: 12м², 4 чел., 20₾/ч, нейтральные тона, фото: /img/offices/miniature_cab_2_pal.jpg

### UNBOX UNI (Тбел Абусеридзе 38, Батуми)
- Кабинет 5: 10м², 4 чел., 20₾/ч, фото: /img/offices/cabinet_5_ira.jpg
- Кабинет 6: 16м², 4 чел., 20₾/ч, песочная терапия, фото: /img/offices/cabinet_6_ira.jpg
- Кабинет 7: 25м², 20 чел., 30₾/ч, групповой, фото: /img/offices/cabinet_7_liza.webp
- Кабинет 8: 20м², 20 чел., 30₾/ч, групповой, фото: /img/offices/cabinet_8_liza.webp
- Капсула 1: 2м², 1 чел., 10₾/ч, фото: /img/offices/miniature_capsule.jpeg

### Кабинет 9: 16м², 10 чел., 20₾/ч (нет фото на старом сайте)
### Капсула 2: 2м², 1 чел., 10₾/ч (нет фото на старом сайте)

## Реальные специалисты (с unbox.center, 17 человек)
Яна Педан, Николай Корен, Галина Иващенко, Елена Райская, Ольга Малыш,
Галина Баженова, Евгения Трофименко, Екатерина Слобода, Марина Бусина,
Алина Ларионова, Катерина Кариманидзе, София Дегтярева, Тамарико Габаидзе,
Светлана Розова, Юлия Рожек (коуч), Мария Августовских (невролог),
Валерия Костенецкая (психиатр)

## Команда Unbox
- Николай — основатель, психолог, гештальт-терапевт
- Юлия — сооснователь, ICF коуч
- Яна — партнёр, клинический психолог
- Максим — руководитель проектов, психолог
- Ирина — директор клиентского сервиса

## Цены
- Индивидуальный кабинет: 20₾/час
- Групповой кабинет: 35₾/час (7, 8)
- Капсула: 10₾/час
- Кофе Меама: 3₾/капсула
- Курсы обмена: USD=2.7, EUR=2.95, RUB=0.03

## Контакты и соцсети Unbox
- Почта: unbox.psy@gmail.com
- Телефон: +995 599 324 668 (Telegram, WhatsApp)
- Telegram: @UnboxCenter (https://t.me/UnboxCenter)
- Instagram: https://www.instagram.com/unbox.center/
- Facebook: https://www.facebook.com/UnboxYourself1

## Тестовые аккаунты (prod)
- Owner: koren.nikolas@gmail.com (Google OAuth)
- Для бета-доступа — запроси пароль у владельца (встроенный bootstrap-аккаунт отключён).
