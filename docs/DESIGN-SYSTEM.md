# Дизайн-система Unbox (Grid House)

Волна 1, шаг 1 (30.09.2026): основа. Бренд прежний — тёплая бумага, IBM Plex Sans + Mono,
тонкие линии, монохром, цвет только для статуса. Живая витрина всех компонентов —
`npm run dev` → **http://localhost:5173/dev/ui** (в прод-сборку не попадает).

Где что лежит:

| Что | Файл |
|---|---|
| Токены (единственный источник) | `src/index.css` → `@theme static { … }` |
| Те же токены для inline-стилей | `src/design/tokens.ts` (`COLOR`, `STATUS`, `FONT`, `TEXT`, `SPACE`, `RADIUS`, `SHADOW`, `Z`, `MOTION`) |
| Стили компонентов | `src/styles/ui.css` (классы `ui-*`, только токены) |
| Компоненты | `src/components/ui/*` |
| Словарь статусов | `src/design/statuses.ts` |
| Деньги и даты | `src/utils/format.ts` |
| Сторож | `backend/tests/guard_wave1_foundation.py` (сверяет CSS ↔ TS, контраст, шрифт, слои) |

`GH` из `hooks/useDesignFlag.ts` теперь берёт значения из `tokens.ts` — старые экраны Grid House
получают новую палитру без правок.

## Цвет

| Токен (CSS / TS) | Значение | Для чего | Контраст на бумаге |
|---|---|---|---|
| `--color-paper` / `COLOR.paper` | `#FAFAF7` | фон страницы | — |
| `--color-card` / `COLOR.card` | `#FDFDFB` | карточки, шторки, поля (вместо `#FFF`) | — |
| `--color-sunken` / `COLOR.sunken` | `#F4F4F2` | углублённое: чипы, скелетон, фон оболочки | — |
| `--color-ink` / `COLOR.ink` | `#0F0F10` | основной текст | 18:1 |
| `--color-ink-80` | ink 80 % | текст чуть тише основного | 10:1 |
| `--color-ink-60` | ink 60 % | **вторичный текст — минимум для любого текста** | 5.0:1 |
| `--color-ink-40 / 30 / 20 / 10` | ink 40–10 % | **только** линии, рамки, иконки, неактивное | 2.6–1.2:1 |
| `--color-accent` | `#476D6B` | «выбрано», фокус, главная кнопка | 5.5:1 |
| `--color-accent-ink` | `#2F5F5E` | мелкий текст акцентом | 6.9:1 |
| `--color-accent-soft` | `#E7ECEA` | подложка выбранного чипа | — |
| `--color-unbox-grey` | `#636A74` | легаси `text-unbox-grey` (был `#9299A3`, 2.75:1) | 5.2:1 |
| `--status-ok-*` | `#E6F4EA` / `#1B6E36` | оплачено, подтверждено | 5.6:1 на своём фоне |
| `--status-pending-*` | `#FEF3C7` / `#8A5A00` | ждём | 5.3:1 |
| `--status-danger-*` | `#FEE2E2` / `#991B1B` | долг, отмена, опасно | 6.8:1 |
| `--status-info-*` | `#DBEAFE` / `#1E40AF` | запланировано | 7.1:1 |
| `--status-muted-*` | `#EEEEEE` / `#555555` | прошло | 6.4:1 |
| `--status-danger-solid` | `#C8253A` | заливка опасной кнопки | 5.3:1 (текст на ней) |

## Текст

IBM Plex Sans — весь текст; IBM Plex Mono — деньги и время (класс `.num` или `<Money>`).
Веса только **400 / 500 / 600**. Строка 1.5 у текста, 1.2 у заголовков.

| Токен | px | Tailwind | Где |
|---|---|---|---|
| caption | 12 | `text-caption` | подписи, вкладки меню, бейджи (минимум!) |
| small | 14 | `text-small` | вторичный текст, плотные таблицы, подписи полей |
| body | 16 | `text-body` | основной текст, поля на телефоне |
| title | 20 | `text-title` | заголовок карточки, шапка /m, шторки |
| heading | 28 | `text-heading` | заголовок экрана |
| display | 40 | `text-display` | только публичные страницы |
| hero | 56 | `text-hero` | только hero |

Отступы — шаг 4: **4 / 8 / 12 / 16 / 24 / 32 / 48** (`--space-1…7`, в Tailwind `p-1/2/3/4/6/8/12`),
поля экрана на телефоне 16. Скругления — три: **0** (десктоп Grid House: карточки, таблицы, окна),
**8** (кнопки, поля, чипы, бейджи), **16** (шторки и карточки на телефоне). Тень одна —
`--shadow-pop`, только для всплывающего. Слои: `dropdown 40 · sticky 90 · nav 100 ·
sheet 200/201 · dialog 10050 · toast 10100 · tooltip 10200`.

Высота управления берётся из `--control-h`: **44 px** на телефоне и во всём `/m`
(оболочки ставят `html[data-density="touch"]`), **36 px** на компьютере.

## Компоненты — когда что брать

| Компонент | Когда |
|---|---|
| `Button` | Любая кнопка. `primary` — одно главное действие на экран/шторку; `secondary` — второе («Оставить»); `quiet` — третье; `danger` — необратимое. `loading` на время запроса (блокирует повторный тап). `block` — во всю ширину в шторке. |
| `Sheet` | Любое окно/шторка. Снизу на телефоне, по центру на компьютере, выше нижнего меню, Esc, свайп, фокус внутри, подвал с кнопкой всегда виден. Главную кнопку — в `footer`, первой. |
| `useConfirmDialog().confirm({…})` | Вместо `confirm()`. Кнопки называют действие; `tone: 'danger'` для необратимого. Вне компонентов — `confirmAction({…})`. |
| `undoToast(msg, onUndo)` | После мелкого удаления/отмены — «Вернуть» 5 секунд вместо «Вы уверены?». |
| `StatusBadge` | Любой статус брони/оплаты/сессии. `kind="booking" \| "payment" \| "session"`, `audience="staff"` для админки, `variant="dot"` для таблиц. Слова — только из `statuses.ts`. |
| `Field` + `Input/TextArea/Select` | Любое поле. Подпись всегда видна, ошибка под полем говорит, что сделать. `kind` = `money / integer / phone / email / search / name / password` — правильная клавиатура и автозаполнение. |
| `Chip`, `Segmented` | Фильтры (много, с переносом) и выбор 1 из 2–4 в строку. |
| `Skeleton`, `SkeletonList` | Пока данные грузятся. **Никогда** не показывать «пусто» / «0 ₾» до ответа сервера. |
| `ErrorBar` | Загрузка упала. С `staleAt` — «Показаны данные на 14:05», хорошие данные не затираем. |
| `EmptyState` | Данные загрузились, и их правда нет. Всегда с подсказкой, что делать, и действием, если оно есть. |
| `PageHeader` / `MobilePageHeader` | Шапка экрана. На /m стрелка «←» только возвращает назад. |
| `Money`, `formatGel`, `formatDateLabel`, `formatDayMonth`, `formatTime` | Все суммы и даты: «1 250 ₾», «вт, 29 сентября», «29 сентября», «14:05». Дата из базы (UTC) — `{ timeZone: BATUMI_TZ }`. |

## Правила

1. **Текст не бледнее ink-60.** ink-40/30/20/10 — только линии, рамки, иконки, неактивное.
2. **Меньше 12 px — нельзя.** Размеры только из шкалы.
3. **Цвет только для статуса.** Зелёный — оплачено/ок, янтарный — ждём, красный — долг/отмена/опасно.
   Бирюза — «выбрано», фокус и главная кнопка, больше нигде. Никаких фиолетовых, синих и градиентов для красоты.
4. **Кнопки называют действие**: «Отменить 6 броней» / «Оставить», а не «ОК» / «Да» / «Отмена».
5. **Обращение — «вы»** (с маленькой буквы), везде, включая /m. Состояния — от «мы»: «Сохраняем…», «Бронируем…».
6. **Загрузка ≠ ошибка ≠ пусто.** Три разных состояния: Skeleton → ErrorBar → EmptyState.
7. **Никаких `confirm()` / `prompt()` / `alert()`** в новом коде. Числа — полем `Input kind="integer|money"` в шторке.
8. **Никакого `#fff` и `#000`** — только токены. Новый цвет сначала появляется в `@theme` и `tokens.ts`.
9. **Одна тень** (`--shadow-pop`) и только у всплывающего; остальное разделяем тонкими линиями.
10. **Нажатие — 0.97 за 140 мс**, шторка 220/180 мс, без «лесенок» списков. При «уменьшить движение» — без сдвигов (MotionConfig `reducedMotion="user"` в App).

## Шаг 2 — чек-лист миграции экрана

Переводим по одному экрану, от частых к редким: /m/today, /m/bookings, /m/find, /m/me,
/m/crm/*, /m/admin/*, потом десктоп.

- [ ] Шрифт: убрать локальные `fontFamily` (`ui-monospace`, «SF Mono») — наследуется Plex; суммы и время → `.num` / `<Money>`.
- [ ] Цвета: `#fff` → `COLOR.card`, `#F4F4F2` → `COLOR.sunken`, `#0E0E0E` → `COLOR.ink`; серый текст (`#999`, `#888`, `GH.ink30`, `text-gray-400`) → `COLOR.ink60`; красные оттенки → `--status-danger-*`.
- [ ] Размеры: `fontSize` 8–11 → 12; остальное прижать к 12/14/16/20/28; `fontWeight` 700/800 → 600.
- [ ] Кнопки: самодельные `<button style=…>` и `LegacyButton` → `Button`; в конце удалить `components/ui/LegacyButton.tsx` (сейчас им пользуются 21 файл).
- [ ] Окна: самодельные `fixed inset-0` оверлеи и копии BottomSheet → `Sheet` (затем удалить `pages/mobile/admin/sheetLayers.ts` и локальные `zIndex`).
- [ ] `confirm()` (45), `prompt()` (21), `alert()` (4) → `confirm({…})` / поле в шторке / `toast`. Начать с `prompt()` для чисел.
- [ ] Статусы: локальные карты (`STATUS_COLORS`, `PaymentBadge`, `Tag`, `StatusBadge` в MobileAdminBookings) → `StatusBadge`; сырые коды (`{item.status}`) → `statusLabel()`.
- [ ] Загрузка: `LoadStates.tsx` (`SkeletonRows`/`LoadErrorCard`/`StaleBar`) переписать поверх `SkeletonList`/`ErrorBar`; спиннеры на списках → `SkeletonList`.
- [ ] Поля: локальные `Field`/`inputStyle` → `Field` + `Input kind=…`.
- [ ] Чипы/фильтры: → `Chip` / `Segmented` (44 px, `aria-pressed`).
- [ ] Шапки: → `MobilePageHeader` / `PageHeader`; убрать декоративные «01 / № 01», «GRID HOUSE», ID.
- [ ] Даты и деньги: `toFixed(2)`, «GEL», ручные `${x} ₾`, `toLocaleDateString` → `formatGel` / `formatDateLabel` / `formatDayMonth`.
- [ ] Тон: «ты» → «вы» (Выбери → Выберите, Пополни → Пополните, Подожди → Секунду…).
- [ ] Эмодзи в интерфейсе → иконки Lucide.
- [ ] Проверить экран в /dev/ui-стиле: 390 и 1440, нет горизонтального скролла, текст ≥ 4.5:1, цели ≥ 44 px.

Словарь статусов (`statuses.ts`) и слово «Прошла» вместо «Завершена» — **на утверждение владельцу**;
менять слова только там.

## Волна 3 — шторки Psy-CRM (шаг 0, 01.10)

Три общие шторки в `src/components/crm/` — на них строятся экраны CRM (телефон и компьютер),
своих форм для этих действий не делаем. Все на `Sheet`, пишут только существующими вызовами,
ошибки — `toastApiError`, после успеха зовут колбэк родителя (список обновляет родитель).

| Шторка | Пропсы | Что делает |
|---|---|---|
| `NewSessionSheet` | `open, onClose, onCreated(session)`, `client?` (нет — поиск), `clients?`, `lastSession?` (undefined — найдёт сама, null — истории нет), `profileDurationMin?`, `successToast?` | Чипы «+1 нед · +2 нед · Другая дата», время, длительность, цена. Мягкие предупреждения «В это время уже …», «Вы в отпуске до …», «Это время уже прошло». Галочка «Добавить в Google Календарь» (В3) — только если календарь подключён (`settings.calendarId`), по умолчанию включена → `pushToCalendar`. Только `createSession`, без заметок. |
| `NewClientSheet` | `open, onClose, onCreated(client)`, `clients?`, `initialName?`, `successToast?` | Имя, телефон, Telegram, код, ставка + валюта; «Ещё» — e-mail, теги, счёт. Код (В2) — сразу свободный `generateAliasCode`, занятый (в т.ч. у слитой карточки) не пускаем. Только `createClient`. |
| `UnpaidSessionsSheet` | `open, onClose, client`, `sessions?`, `onChanged?` | Прошедшие неоплаченные сессии клиента. «Отметить оплату · 140 ₾» — `quickPaySession` из стора (защита от двойного тапа); «Отметить все (N) · 280 ₾» — `markAllPaid` с вопросом как в карточке клиента. Суммы по валютам раздельно. |

`src/utils/crmNextSession.ts` — без импортов (сторож гоняет его через node):
`suggestNextSession({ lastSession, client, profileDurationMin, weeks?, now? })` → `{ date, time, durationMinutes, price, currency, fromLastSession }`
(тот же день недели и время по Батуми через неделю; длительность: прошлая → анкета → 60; цена — ставка клиента);
`toTbilisiNaive(date, time)` → `'2026-10-07T19:00:00'` — так дата уходит на сервер (он сам переводит в UTC), **никогда не `toISOString()`**;
`utcNaiveToTbilisi(dbDate)` → `{ date, time }` по Батуми; `generateAliasCode(existingCodes)` → свободный `'4821'`.

Список клиентов `getClients(…, withStats=true)` теперь отдаёт `nextSessionDate` и `lastPastSessionDate`
(UTC-naive, читать через `parseUTC`). `html, body` — `overflow-x: clip` (не `hidden`: тот ломал `sticky`).
Сторож: `backend/tests/guard_wave3_foundation.py`.

## Волна 4 — админка (шаг 0, 01.10)

### «К оплате» и «✓ оплачено» (решение владельца В2)

Владелец: неоплаченные брони должны бросаться в глаза, чтобы админы были внимательнее.
Сумма «к оплате» по брони — только из `computeDueByBooking` (`src/utils/dueAmounts.ts`), своих формул нет.

| Состояние | Когда | Как выглядит |
|---|---|---|
| **к оплате** | `due > 0` — прошедшая или будущая | тон **danger**: заливка/рамка `--status-danger-bg`, текст `--status-danger-fg` «к оплате 36 ₾» + значок `AlertCircle` |
| **✓ оплачено** | запись в dueMap есть, `due ≤ 0` | спокойный тон **ok**: `--status-ok-bg` / `--status-ok-fg`, «✓ оплачено» |
| ничего | записи нет (абонемент без доплаты, обслуживание, прощённая) | не рисуем ни цвета, ни подписи |

Всегда цвет **и** текст (и значок), не только цвет. Где показывать: шахматка (на каждой брони;
на 30-минутной — значок в углу с той же подписью в `aria-label`/`title`), «Сегодня» на компьютере
и телефоне, список броней. Легенда шахматки объясняет оба состояния словами «к оплате» / «✓ оплачено».

Прошедшие брони (сервер отдаёт их как `completed`) теперь тоже получают запись в dueMap:
долг ложится на самые свежие списанные брони, покрытые прошедшие — «✓ оплачено». Долг
клиента от этого не меняется, только то, на какие брони он разложен.

Общий компонент — `src/components/admin/DueBadge.tsx` (не в `ui/*`):

```tsx
const info = dueMap.get(b.id);
<DueBadge due={info?.due} paid={!!info} />            // плашка
<DueBadge due={info?.due} paid={!!info} variant="dot" /> // плотная таблица Grid House
```

### Основа для пакетов A–D

| Модуль | Что даёт |
|---|---|
| `maintenanceApi` (`src/api/maintenance.ts`) | `list({dateFrom,dateTo,resourceId})`, `create(input)`, `remove(id)`, `removeGroup(groupId)`. На пересечение с бронями `create` бросает `MaintenanceConflictError` (`isMaintenanceConflict(e)`, `e.conflicts`). |
| `MaintenanceConflictSheet` (`src/components/admin/`) | Шторка на `Sheet`: «В это время есть брони — сначала перенесите или отмените их», список (дата, время, клиент, «к оплате / оплачено»), ссылка из `linkFor(booking)`, кнопка «Понятно». Сама ничего не отменяет (В1). |
| `src/utils/adminToday.ts` (без импортов) | `todayRows({bookings, users, dueMap, dayKey, resources?})` → строки дня (время, клиент, телефон, кабинет, статус, due); `todaySummary(rows)` → «взять 86 ₾ с 2 клиентов»; `byClient(rows, users)` → «Взять сегодня»: за сегодня, весь долг, лимит, «сверх лимита»; `batumiDayKey()` — «сегодня» по Батуми. Обслуживание исключено, `completed` остаётся. |
| `src/utils/ledgerReasons.ts` | `REASON_LABELS` — подписи движений баланса (общие для карточки на компьютере и телефоне). |

Сервер: `POST /maintenance-blocks` поверх брони клиента (`confirmed` / `pending_approval`) → **409**
`{message, conflicts: [{booking_id, date, start_time, duration, client: {name, email}, payment_status, final_price}]}`,
ничего не создаёт; `DELETE /maintenance-blocks/group/{id}` снимает серию (только строки обслуживания).
Сторож: `backend/tests/guard_wave4_foundation.py`.
