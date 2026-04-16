# UnboxCRM — Контекст проекта

## Что это
Fullstack CRM + система бронирования кабинетов для центра психологии Unbox (unbox.com.ge).
- **Frontend**: React 19 + TypeScript + Vite + Zustand + TailwindCSS
- **Backend**: Python FastAPI + SQLModel + PostgreSQL
- **Хостинг**: DigitalOcean Droplet (138.68.111.248), Ubuntu + nginx, домен unbox.com.ge через domenebi.ge
- **Деплой фронта**: локальный `npm run build` → `rsync` в `/var/www/unbox/dist` (не git-репо на сервере)
- **Деплой бэка**: git pull в `/var/www/unbox-beta/backend` + `systemctl restart unbox-api`

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
│   └── .env           # DATABASE_URL=postgresql://unbox:UnboxCRM2026!@localhost:5432/unboxdb
├── src/               # React frontend
│   ├── pages/         # Pages (admin/, crm/, ExplorePage, etc.)
│   ├── components/    # UI components (Wizard/, admin/, crm/, landing/)
│   ├── store/         # Zustand stores (userStore, bookingStore, crmStore)
│   ├── api/           # API clients (bookings, crm, cashbox, bonuses)
│   └── utils/         # Pricing, currency, data, calendar
└── public/            # Static assets
```

## Деплой

### Серверная топология
- **Продакшн домен**: https://unbox.com.ge (nginx → `/var/www/unbox/dist`)
- **Бета**: http://138.68.111.248:8080 (nginx → `/var/www/unbox-beta/dist`)
- `/var/www/unbox/` — **не git-репо**, это папка для артефактов rsync'а (owner `501:staff` = локальный Mac-юзер).
- `/var/www/unbox-beta/` — git-репо на ветке `beta` (`origin = github.com/Mykolakoren/Unbox_site.git`).
- Бэкенд продакшна и беты **общий**: `/var/www/unbox/backend` — симлинк на `/var/www/unbox-beta/backend`. Значит любой `git pull` в `unbox-beta` обновляет бэкенд на обоих окружениях.
- Systemd-юнит: `unbox-api.service` → uvicorn на `127.0.0.1:8000`, `WorkingDirectory=/var/www/unbox/backend`, venv `/var/www/unbox/backend/venv/`.
- Nginx конфиги: `/etc/nginx/sites-enabled/unbox` и `/etc/nginx/sites-enabled/unbox-beta`. SSL — Let's Encrypt (auto-renew).

### Фронтенд — деплой с локальной машины
```bash
# Локально:
cd /Users/mykola/Desktop/Projects/UnboxCRM
NODE_OPTIONS='--max-old-space-size=1536' npm run build

# Бэкап + выкатка (rsync только меняет diff, --delete чистит удалённое):
ssh root@138.68.111.248 "cp -r /var/www/unbox/dist /var/www/unbox/dist-backup-$(date +%Y%m%d-%H%M%S)"
rsync -avz --delete dist/ root@138.68.111.248:/var/www/unbox/dist/

# Проверка, что новый бандл живой:
curl -s https://unbox.com.ge/ | grep -Eo 'assets/index-[A-Za-z0-9_-]+\.js'
```
На проде НИКОГДА не делаем `git pull` во фронт — `/var/www/unbox` не git-репо.

### Бэкенд — деплой на сервере
```bash
ssh root@138.68.111.248
cd /var/www/unbox-beta
git pull origin beta     # или нужная ветка — прод-бэк берёт код отсюда
systemctl restart unbox-api
systemctl status unbox-api
journalctl -u unbox-api -f
```

### Бета-фронтенд
```bash
ssh root@138.68.111.248
cd /var/www/unbox-beta
git pull origin beta
NODE_OPTIONS='--max-old-space-size=1536' npm run build   # билд прямо на сервере
# dist уже в нужном месте — nginx подхватит сразу
```

### Откат
```bash
ssh root@138.68.111.248 "ls -dt /var/www/unbox/dist-backup-* | head -5"   # увидеть бэкапы
ssh root@138.68.111.248 "rm -rf /var/www/unbox/dist && mv /var/www/unbox/dist-backup-YYYYMMDD-HHMMSS /var/www/unbox/dist"
```


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
- Бета: admin@unbox.com / admin123
