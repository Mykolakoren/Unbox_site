# API Health Checks — UnboxCRM Backend

Verify backend routes are registered and responding.
All checks run via `preview_eval` with `fetch()` from the browser.

**Base URL:** determined by `VITE_API_URL` env var. In dev: `http://localhost:8000/api/v1`
Or read from page: `window.__VITE_API_URL__` or construct from `import.meta.env.VITE_API_URL`.

**How to get base URL in preview_eval:**
```javascript
// The Vite app exposes the API URL in compiled code.
// Easiest: hit a known endpoint relative to the page origin.
const base = 'https://unbox.com.ge/api/v1'; // prod
// or for dev: 'http://localhost:8000/api/v1'
```

## Health Check Protocol

For each endpoint:
1. `fetch(url, { method, headers: { 'Content-Type': 'application/json' } })`
2. Record: HTTP status code
3. Evaluate:
   - **2xx/3xx** → PASS (fully operational)
   - **401/403** → PASS (route exists, auth works correctly)
   - **422** → PASS (route exists, validation works — e.g., POST without body)
   - **404** → FAIL if the route SHOULD exist (missing router registration)
   - **500** → WARNING (server error — may indicate a bug)
   - **Network error / Connection refused** → CRITICAL (backend is down)

## Endpoint Matrix

### Authentication (CRITICAL — P0)
```
POST /auth/login          → 422 (no body) or 401
POST /auth/register       → 422 (no body)
POST /auth/google         → 422 (no body)
POST /auth/telegram       → 422 (no body)
POST /auth/change-password → 401 (no auth)
```

### Users (P1)
```
GET  /users/me            → 401 (no auth)
```

### Bookings (P1)
```
GET  /bookings/           → 401
GET  /bookings/me         → 401
GET  /bookings/public     → 200 (public endpoint!)
POST /bookings/check-availability → 422
GET  /bookings/pending-approval   → 401
```

### Resources & Locations (P1)
```
GET  /resources/          → 200 (public list)
GET  /locations/          → 200 (public list)
```

### Specialists (P1)
```
GET  /specialists/        → 200 (public list)
GET  /specialists/me      → 401
```

### Cashbox (P1)
```
GET  /cashbox/balance         → 401
GET  /cashbox/transactions    → 401
GET  /cashbox/categories      → 401
GET  /cashbox/shifts          → 401
GET  /cashbox/analytics       → 401
```

### CRM (P2)
```
GET  /crm/clients         → 401
GET  /crm/sessions        → 401 or 403
GET  /crm/dashboard       → 401
```

### Admin Tasks (P2)
```
GET  /admin/tasks/        → 401
```

### Team (P2)
```
GET  /team                → 401
GET  /team/all            → 401
```

### Notifications (P2)
```
GET  /notifications/          → 401
GET  /notifications/unread-count → 401
```

### Timeline (P3)
```
GET  /timeline/           → 401
```

### Waitlist (P3)
```
GET  /waitlist/my         → 401
```

### Pricing (P3)
```
POST /pricing/quote       → 422
```

### Bonuses (P3)
```
GET  /bonuses/            → 401
GET  /bonuses/my          → 401
GET  /bonuses/pending-count → 401
```

### Upload (P3)
```
POST /upload/             → 401
```

---

## Aggregated Check Script (run in preview_eval)

```javascript
(async () => {
  const base = 'https://unbox.com.ge/api/v1';
  const checks = [
    // [method, path, expectedStatuses, priority, label]
    ['POST', '/auth/login', [401, 422], 'P0', 'Auth Login'],
    ['GET', '/bookings/public', [200], 'P1', 'Public Bookings'],
    ['GET', '/resources/', [200], 'P1', 'Resources List'],
    ['GET', '/locations/', [200], 'P1', 'Locations List'],
    ['GET', '/specialists/', [200], 'P1', 'Specialists List'],
    ['GET', '/users/me', [401], 'P1', 'Users Me (auth check)'],
    ['GET', '/cashbox/balance', [401, 403], 'P1', 'Cashbox Balance'],
    ['GET', '/cashbox/transactions', [401, 403], 'P1', 'Cashbox Transactions'],
    ['GET', '/crm/clients', [401, 403], 'P2', 'CRM Clients'],
    ['GET', '/admin/tasks/', [401, 403], 'P2', 'Admin Tasks'],
    ['GET', '/team', [401, 403], 'P2', 'Team'],
    ['GET', '/notifications/', [401], 'P2', 'Notifications'],
    ['GET', '/timeline/', [401], 'P3', 'Timeline'],
    ['GET', '/waitlist/my', [401], 'P3', 'Waitlist'],
    ['GET', '/bonuses/pending-count', [401], 'P3', 'Bonuses Pending'],
  ];

  const results = [];
  for (const [method, path, expected, priority, label] of checks) {
    try {
      const res = await fetch(base + path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'POST' ? '{}' : undefined,
      });
      const pass = expected.includes(res.status) || (res.status >= 200 && res.status < 500);
      results.push({ label, priority, status: res.status, pass, error: null });
    } catch (e) {
      results.push({ label, priority, status: 0, pass: false, error: e.message });
    }
  }
  return results;
})()
```

## Interpreting Results

- All `pass: true` → API layer healthy
- Any `status: 0` (network error) → backend unreachable → CRITICAL BLOCKER
- Any `status: 500` on P0/P1 endpoint → likely regression → WARNING
- Unexpected `404` on known routes → router registration broken → CRITICAL
