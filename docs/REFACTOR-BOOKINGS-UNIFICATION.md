# Унификация бронь-страниц (Task 6, в работе)

## Статус

- ✅ **Фаза 1 — извлечь общие утилиты** (`src/utils/bookingHelpers.ts`,
  bundle `index-DLHa6CwX.js`). MyBookingsPage и CrmBookings импортят
  общий `safeFormat`, `parseUTC`, `getSafeBookingDate`,
  `BOOKING_STATUS_LABELS`. Mobile-страницы готовы к подключению —
  `formatBookingDuration`, `isPastStatus`, `PAST_STATUSES` доступны.
- ⏸ **Фаза 2 — унификация `BookingCard`** — НЕ сделано. Изучение
  показало что каждая реализация ~350-400 строк с разной сигнатурой
  и логикой (серии · CRM-клиент · код двери · re-rent). Честная
  оценка времени: 3-4ч фокуса, не «между делом».
- 🟡 **Фаза 3 — шахматка** — частично (вариант 1, аудит + extract безопасных
  утилит). Извлечены: `TIME_SLOTS`, `timeToMin`, `parseUTC` (через
  re-export из dateUtils). AdminChessboardView и CrmChessboardView
  импортят из `bookingHelpers`. Bundle `index-CU7Hn-ta.js`. Полный
  merge UI (~4-5ч фокуса) — отложен.
- ⏸ **Фаза 4 — единый Pages-компонент** — НЕ сделано.
- ⏸ **Фаза 5 — финальная проверка** — НЕ сделано.



## Контекст

После архитектурного коллапса /dashboard и /crm (2026-06-05) у нас два
независимых компонента, делающих одно и то же для разных аудиторий:

| Файл | Строк | Роль |
|---|---|---|
| `src/pages/MyBookingsPage.tsx` | 3769 | Клиент / админ как «себя» |
| `src/pages/crm/CrmBookings.tsx` | 1329 | Специалист как «работника» |

Имена функций совпадают (`BookingCard`, `safeFormat`), но реализации
разные. Это **концептуальный дубль**, а не код-дубль.

## Что уникально для каждой

### MyBookingsPage (клиентская оптика)
- Код двери · Wi-Fi пароль (из data.ts)
- Депозит (баланс / кредит-инфо)
- CTA «Оформить абонемент» / «Скидки и бонусы»
- «Новая бронь» через wizard (BookingWizard)
- BookingCard с детализацией оплаты

### CrmBookings (специалистская оптика)
- KPI-полоса: «впереди N · с клиентом M · без клиента K · всего T»
- Привязка к CRM-клиенту (LinkClientModal)
- «+ Бронь» через CrmChessboardView (отдельный компонент)
- Серии через GHSeriesView (свой компонент)
- Фильтры по «есть/нет CRM-клиент», «прошедшие»

### Общее
- Структура: tabs «Список / Шахматка / Серии»
- API: `bookingsApi.getMyBookings` + `bookingsApi.getPublicBookings`
- Действия: cancel · reschedule · re-rent · extend
- Группировка по серии (recurring_group_id)

## Стратегия миграции

### Фаза 1 — извлечь общие утилиты (~1 час)

В `src/utils/bookingHelpers.ts`:
- `parseBookingDate(b)` — централизованная безопасная парсилка (есть в обоих)
- `formatBookingDuration(min)` — «780 мин» → «13 ч»
- `getStatusLabel(status)` — единый словарь
- `groupBySeries(bookings)` — группировка для Series view
- `isPastBooking(b)` — расчёт «прошедшая»

Обновить оба файла на использование. После — проверить что ничего не сломалось.

### Фаза 2 — унифицировать BookingCard (~1.5 часа)

Один компонент с props:

```tsx
<BookingCard
    booking={b}
    role="client" | "specialist" | "admin"
    showAccessCode={role === 'client'}
    showCrmClientLink={role === 'specialist'}
    showAdminActions={role === 'admin'}
    onCancel onReschedule onReRent onEditPrice
/>
```

Удалить локальные `BookingCard` из обоих файлов, заменить на импорт.

### Фаза 3 — унифицировать шахматку (~2 часа)

Сейчас три варианта:
- `<CrmChessboardView>` — для спецов
- `<AdminChessboardView>` — для админов
- Кастомная сетка внутри MyBookingsPage — для клиентов

Слить в один `<ChessboardView role={...} />`. Это самая сложная часть.

### Фаза 4 — единый Pages-компонент (~1 час)

```tsx
function BookingsPage({ role }: { role: 'client' | 'specialist' | 'admin' }) {
    const [tab, setTab] = useState('list');
    // ...
}

// Routes:
// /dashboard/bookings → <BookingsPage role="client" />
// /crm/bookings        → <BookingsPage role="specialist" />
// /admin/bookings      → <BookingsPage role="admin" />
```

Удалить MyBookingsPage.tsx и CrmBookings.tsx.

### Фаза 5 — финальная проверка (~30 мин)

Каждый из трёх роутов под нужной ролью:
- Список рендерится
- Шахматка работает
- Серии группируются
- Действия выполняются
- Нет визуальных регрессий

## Риски

- **Шахматка** — самый сложный кусок, drag-and-drop через множество ячеек
- **State management** — у каждой страницы свой набор useState; нужно
  свести без перекрёстных багов
- **Performance** — добавление role-conditional рендеринга может
  замедлить пере-рендеры если делать неаккуратно

## Когда делать

Отдельная сессия 4-6 часов фокуса. Не «между делом» в смешанном тике.
Лучше когда не висит горящих юзер-багов и есть запас времени на откат
через git restore.

## Что НЕ делать

- Не объединять «снизу» через скопировать-вставить — увеличит дубль
- Не выносить в общий компонент, не определив сначала role-API
- Не делать без явного git commit'а перед каждой фазой
