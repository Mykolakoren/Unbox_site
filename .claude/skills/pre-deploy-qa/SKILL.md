---
name: pre-deploy-qa
description: >
  ALWAYS invoke this skill BEFORE deploying UnboxCRM to production. Triggers on: "деплой", "deploy", "задеплой", "rsync", "залей на сервер", "выкатывай", "push to prod", "pre-deploy check", "проверь перед деплоем", "qa check", "проверка сайта", "проверь работу сайта". Runs full pre-deploy QA: build validation, page render verification (desktop + mobile 375px), API health, console error scan, design system token checks across all critical routes. Do NOT trigger for: local dev setup, code review, git operations, partial testing of one component.
---

# Pre-Deploy QA — UnboxCRM

Automated pre-deploy verification via user-experience scenarios.
Every deploy must pass this gate. Zero tolerance for broken routes and console errors.

## Architecture

```
UnboxCRM Stack:
  Frontend:  React 19 + TypeScript + Vite + Zustand + TailwindCSS
  Backend:   Python FastAPI + SQLModel + PostgreSQL
  Design:    Grid House (GH) — default. Legacy via ?design=off
  Deploy:    rsync dist/ → 138.68.111.248 + PM2 restart
  Branches:  Unbox Uni | Unbox One | Neo School
```

## Execution Protocol

Run phases sequentially. Stop on CRITICAL failures. Collect WARNINGS for report.

### Phase 1: Build Gate

```bash
cd /Users/mykola/Desktop/Projects/UnboxCRM
npx vite build 2>&1
```

**Pass criteria:**
- Exit code 0
- No TypeScript errors in output
- `dist/index.html` exists after build
- No chunks exceed 1.5MB (warning threshold)

CRITICAL: if build fails, STOP. Report errors. Do not proceed.

### Phase 2: Dev Server + Page Render Matrix

Start dev server via `preview_start(name: "unbox")`.

For EACH route in the scenario matrix:
1. Navigate via `preview_eval` (`window.location.href = url`)
2. Wait 2s for hydration
3. Take `preview_snapshot` (accessibility tree)
4. Check `preview_console_logs(level: "error")` — filter out known noise (GSI_LOGGER)
5. Verify expected elements exist in snapshot
6. If admin/CRM route: verify auth redirect to `/login` (unauthenticated is OK — we check the redirect works)

**Desktop viewport:** default (1280px)
**Mobile viewport:** resize to 375x812 via `preview_resize`, re-check same route

→ Full scenario matrix with expected elements: read `references/scenarios.md`

### Phase 3: API Health

For each backend endpoint category, verify the route is registered:
- Hit endpoint from preview via `preview_eval` + fetch()
- Expected: HTTP response (any status — 401/403 means route exists and auth works)
- CRITICAL: network error / connection refused = backend down

→ Full API endpoint list and expected responses: read `references/api-checks.md`

### Phase 4: Design System Integrity

Verify Grid House tokens render correctly:
1. Navigate to `/` (landing — always GH)
2. `preview_eval`: check `document.fonts.check('16px "IBM Plex Sans"')` → should be true
3. `preview_eval`: check computed styles of key elements against GH tokens
4. Navigate with `?design=off` → verify legacy variant loads (no GH elements)

→ Token values and verification selectors: read `references/visual-matrix.md`

### Phase 5: Report

Generate a structured report:

```
═══════════════════════════════════════════
  PRE-DEPLOY QA REPORT — UnboxCRM
  Date: {date}  Branch: {git branch}
═══════════════════════════════════════════

BUILD .................. {PASS/FAIL}
  Build time: Xs | Chunks: N | Largest: XkB

PAGES (desktop) ........ {N/N PASS}
  ✓ / (landing)
  ✓ /specialists
  ✗ /admin/finance — missing BalanceCard
  ...

PAGES (mobile 375px) ... {N/N PASS}
  ✓ / (landing)
  ✗ /admin/bookings — horizontal overflow detected
  ...

CONSOLE ERRORS ......... {N errors across M pages}
  ⚠ /admin/tasks — "Cannot read property 'map' of undefined"
  ...

API HEALTH ............. {N/N endpoints alive}
  ✓ /auth/login (POST → 422)
  ✓ /cashbox/balance (GET → 401)
  ✗ /crm/clients (GET → connection refused)
  ...

DESIGN SYSTEM .......... {PASS/FAIL}
  IBM Plex Sans loaded: {yes/no}
  GH tokens verified: {yes/no}
  Legacy fallback: {yes/no}

═══════════════════════════════════════════
  VERDICT: {DEPLOY OK / BLOCKED — N critical issues}
═══════════════════════════════════════════
```

**Verdict rules:**
- Any CRITICAL → BLOCKED
- Console errors on public pages → BLOCKED
- Console errors only on auth-gated pages with 401 → WARNING (acceptable)
- Mobile overflow on admin pages → WARNING
- All pass → DEPLOY OK

## Known Noise (ignore these)

- `[GSI_LOGGER]: FedCM get() rejects` — Google Sign-In, external
- `[TanStack Query] No queryClient` — appears briefly during SSR hydration
- `favicon.ico 404` — harmless
- HTTP 401/403 on protected endpoints without auth — expected behavior

## Anti-Patterns

- Do NOT skip mobile checks — "it works on desktop" is not sufficient
- Do NOT ignore console errors — each one is a potential runtime crash
- Do NOT deploy if build has TS errors — even if dist/ exists from prior build
- Do NOT test only changed pages — regression happens elsewhere
- Do NOT count 401 on auth endpoints as failures — that IS the correct behavior
