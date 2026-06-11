# User Scenario Matrix — UnboxCRM Pre-Deploy QA

Every route with expected elements for snapshot verification.
Elements are checked via `preview_snapshot` accessibility tree text content.

## Priority Levels

- **P0 (Critical)**: Public-facing pages, auth, booking flow. Block deploy if broken.
- **P1 (High)**: Admin core — finance, bookings, users. Block deploy if broken.
- **P2 (Medium)**: Admin secondary — tasks, waitlist, team. Warning if broken.
- **P3 (Low)**: CRM specialist pages. Warning only (auth-gated, smaller audience).

---

## PUBLIC ROUTES (P0)

### SC-01: Landing `/`
```
Navigate: http://localhost:5175/
Expected in snapshot:
  - "Unbox" (brand name in header)
  - Link or button to specialists/booking
  - At least one section heading
Mobile (375px):
  - Same elements present
  - No horizontal scrollbar (check via eval: document.body.scrollWidth <= 375)
```

### SC-02: Specialists Page `/specialists`
```
Navigate: http://localhost:5175/specialists
Expected in snapshot:
  - Heading containing specialist-related text
  - At least one specialist card or name
Mobile:
  - Cards stack vertically (1 column)
  - No overflow
```

### SC-03: Location Detail `/location/:id`
```
Navigate: http://localhost:5175/location/1
Expected in snapshot:
  - Location name or address
  - Photo or description section
  - Booking/contact info
Note: If location doesn't exist, should show graceful fallback, not crash
```

### SC-04: Specialist Profile `/specialists/:id`
```
Navigate: http://localhost:5175/specialists/1
Expected in snapshot:
  - Specialist name
  - Description or bio section
  - Booking button or schedule
Note: Non-existent ID should not produce console errors
```

### SC-05: Subscriptions `/subscriptions`
```
Navigate: http://localhost:5175/subscriptions
Expected in snapshot:
  - Page heading (subscription/pricing related)
  - At least one plan/card element
Mobile:
  - Cards readable at 375px
```

### SC-06: Login `/login`
```
Navigate: http://localhost:5175/login
Expected in snapshot:
  - "Вход" or "Войти" text
  - Email input (textbox)
  - Password input (textbox)
  - Submit button ("ВОЙТИ")
  - Google auth button
  - Telegram auth button
  - Registration link
Mobile:
  - Form centered, inputs full-width
  - Both social buttons visible
```

---

## AUTH-GATED REDIRECT CHECKS (P0)

These routes should redirect to `/login` when not authenticated.
The check is: navigate → snapshot → see login page elements.

### SC-07: Dashboard redirect `/dashboard`
```
Navigate: http://localhost:5175/dashboard
Expected: Redirect to /login — snapshot contains "Вход" and login form
```

### SC-08: CRM redirect `/crm`
```
Navigate: http://localhost:5175/crm
Expected: Redirect to /login
```

### SC-09: Admin redirect `/admin`
```
Navigate: http://localhost:5175/admin
Expected: Redirect to /login
```

---

## ADMIN PAGES — checked via snapshot after navigating (P1-P2)

Since we can't authenticate in preview, we verify the ROUTE EXISTS
and the redirect to login works. If the dev server has a session/token,
we check full content.

**Strategy for admin pages:**
1. Navigate to admin route
2. If snapshot shows login page → PASS (auth redirect works)
3. If snapshot shows admin content → verify expected elements below
4. If snapshot shows blank/error → FAIL

### SC-10: Admin Dashboard `/admin` (P1)
```
Expected if authenticated:
  - KPI numbers (revenue, bookings count)
  - "Дашборд" or dashboard heading
  - Recent bookings section
Mobile:
  - KPI grid: 2 columns (not 4)
  - Cards stack vertically
```

### SC-11: Admin Users `/admin/users` (P1)
```
Expected if authenticated:
  - User count or "Клиенты" heading
  - Search/filter controls
  - User cards or table rows
Mobile:
  - Compact card view (not wide table)
  - Sort buttons visible (Имя/Баланс/Дата)
  - Должники toggle
```

### SC-12: Admin Bookings `/admin/bookings` (P1)
```
Expected if authenticated:
  - "Бронирования" heading
  - Status filter tabs
  - Booking entries (cards or table)
Mobile:
  - Card view with date, status, price
  - Action buttons (Принять/Отклонить)
  - Status tabs scrollable horizontally
```

### SC-13: Admin Finance `/admin/finance` (P1)
```
Expected if authenticated:
  - "Финансы" or "Касса" heading
  - Balance cards (Наличные, Карта TBC, Карта BOG, Итого)
  - Branch selector (Общая касса / Unbox Uni / Unbox One / Neo School)
  - Period selector (День/Неделя/Месяц/Диапазон)
  - Transaction list
  - "Закрыть смену" button
  - "Новая операция" button
Mobile:
  - Balance cards 2x2 grid
  - Branch selector functional
  - Tabs scrollable
```

### SC-14: Admin Tasks `/admin/tasks` (P2)
```
Expected if authenticated:
  - Task board with columns (К выполнению/В работе/Выполнено)
  - Task cards with titles
  - Add task button
Mobile:
  - Column tab switcher (not 3 columns side by side)
  - Single column visible at a time
  - Tab buttons with column names
```

### SC-15: Admin Waitlist `/admin/waitlist` (P2)
```
Expected if authenticated:
  - Waitlist entries
  - Status badges
  - Уведомить/Удалить buttons
Mobile:
  - Card view (not wide table)
  - Actions visible on each card
```

### SC-16: Admin Cabinets `/admin/cabinets` (P2)
```
Expected if authenticated:
  - Cabinet/resource cards in grid
  - Filter tabs (location-based)
  - Cabinet names and photos
Mobile:
  - Grid: 1 column
  - Filter tabs scrollable horizontally
```

### SC-17: Admin Team `/admin/team` (P2)
```
Expected if authenticated:
  - Team member cards
  - Role labels
  - "Добавить" button
Mobile:
  - Grid: 2 columns (not auto-fill wider)
```

### SC-18: Admin Specialists `/admin/specialists` (P2)
```
Expected if authenticated:
  - Specialist cards with photos
  - Visibility toggles
  - Sort/reorder controls
```

### SC-19: Admin Access Rights `/admin/access-rights` (P2)
```
Expected if authenticated:
  - Permission matrix or role list
  - User assignments
```

### SC-20: Admin Knowledge Base `/admin/knowledge-base` (P2)
```
Expected if authenticated:
  - Article list or categories
  - Search/filter
```

### SC-21: Admin CRM `/admin/crm` (P2)
```
Expected if authenticated:
  - CRM overview or specialist list
```

---

## CRM SPECIALIST PAGES (P3)

### SC-22: CRM Dashboard `/crm`
### SC-23: CRM Clients `/crm/clients`
### SC-24: CRM Client Detail `/crm/clients/:id`
### SC-25: CRM Sessions `/crm/sessions`
### SC-26: CRM Bookings `/crm/bookings`
### SC-27: CRM Finances `/crm/finances`
### SC-28: CRM Notes `/crm/notes`
### SC-29: CRM Schedule `/crm/schedule`
### SC-30: CRM Settings `/crm/settings`
### SC-31: CRM Profile `/crm/profile`

All CRM routes: redirect to `/login` when unauthenticated.
If authenticated as specialist:
- Each should render without console errors
- Mobile layout should not overflow

---

## MOBILE-SPECIFIC CHECKS (cross-cutting)

For every page tested at 375px width:

```javascript
// Run via preview_eval after resize to 375x812:
(() => {
  const overflow = document.documentElement.scrollWidth > 375;
  const body = document.body.scrollWidth > 375;
  return { overflow, body, docWidth: document.documentElement.scrollWidth };
})()
```

- `overflow: true` → WARNING: horizontal scroll detected
- Check that no text is clipped (snapshot should show same key text)
- Check that nav/sidebar is collapsed (not overlapping content)

---

## SCENARIO EXECUTION ORDER

Optimized for speed (minimize navigations):

1. **Build gate** (Phase 1)
2. Start dev server
3. Public pages desktop: SC-01 → SC-06
4. Auth redirects: SC-07 → SC-09
5. Resize to 375px
6. Public pages mobile: SC-01 → SC-06
7. Admin pages mobile: SC-10 → SC-21 (redirect checks)
8. Resize back to 1280px
9. Admin pages desktop: SC-10 → SC-21
10. CRM pages: SC-22 → SC-31
11. Design system check (Phase 4)
12. Generate report (Phase 5)

Total: ~31 route checks x 2 viewports = ~62 verifications
Expected time: 3-5 minutes
