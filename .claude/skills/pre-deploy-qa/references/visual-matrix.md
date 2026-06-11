# Visual & Design System Verification — UnboxCRM

## Grid House Design Tokens

Source: `src/hooks/useDesignFlag.ts`

```
GH.ink      = '#0F0F10'               (primary text)
GH.paper    = '#FAFAF7'               (page background)
GH.ink5     = 'rgba(15,15,16,0.05)'   (subtle borders)
GH.ink8     = 'rgba(15,15,16,0.08)'   (hover states)
GH.ink10    = 'rgba(15,15,16,0.10)'   (borders, dividers)
GH.ink30    = 'rgba(15,15,16,0.30)'   (secondary text)
GH.ink60    = 'rgba(15,15,16,0.60)'   (muted text)
GH.cellDead = '#F6F2E8'               (inactive cells)
GH.accent   = '#476D6B'               (primary actions, links)
GH.danger   = '#B84A2F'               (destructive actions, errors)
```

### Fonts
```
GH_SANS = 'IBM Plex Sans'    (headings, body)
GH_MONO = 'IBM Plex Mono'    (labels, numbers, badges)
```

### Font Loading Check (run in preview_eval)
```javascript
(() => {
  const sans = document.fonts.check('16px "IBM Plex Sans"');
  const mono = document.fonts.check('12px "IBM Plex Mono"');
  return { 'IBM Plex Sans': sans, 'IBM Plex Mono': mono };
})()
```
- Both `true` → PASS
- `false` → WARNING: font not loaded, fallback rendering

---

## Design Flag Verification

### GH Default Check
```
Navigate: http://localhost:5175/
Expected: Grid House renders by default (no ?design=grid needed)
Check via snapshot: look for GH-specific elements like mono-spaced labels
```

### Legacy Fallback Check
```
Navigate: http://localhost:5175/?design=off
Expected: Classic Tailwind variant renders
Check: elements should differ from GH variant (e.g., rounded-2xl cards vs. sharp borders)
Navigate back: http://localhost:5175/?design=grid → should restore GH
```

---

## Viewport Matrix

### Desktop (default ~1280px)
All pages should render with:
- Sidebar visible (admin pages)
- Tables with proper column alignment
- Grid layouts with multiple columns

### Mobile (375x812)
Resize via: `preview_resize(width: 375, height: 812)`

Critical mobile checks per area:

#### Admin Sidebar (`/admin/*`)
```javascript
// Check sidebar is collapsed (not overlapping main content)
// Sidebar should be off-screen by default on mobile
// Menu hamburger button should be visible
```
**Expected in snapshot:** Menu/hamburger button visible, sidebar NOT visible by default

#### Admin Tables → Cards
Pages that must show card view (not table) at 375px:
- `/admin/users` — compact card with avatar initial + name + balance
- `/admin/bookings` — card with date/time, status, price, action buttons
- `/admin/waitlist` — card with name, date, status badge, action buttons
- `/admin/finance` — transaction list (table OK with horizontal scroll)

#### Admin Grids → Responsive
- `/admin/dashboard` — KPI: 2 columns (not 4)
- `/admin/cabinets` — grid: 1 column (not auto-fill)
- `/admin/team` — grid: 2 columns (not auto-fill wider)

#### Admin Tasks → Tab Switcher
- `/admin/tasks` — 3-column kanban → single column with tab switcher
  Expected: tab buttons for К выполнению / В работе / Выполнено

#### Finance Branch Selector
- `/admin/finance` at 375px — branch selector dropdown must be visible and functional

### Overflow Detection (all pages at 375px)
```javascript
(() => {
  const docW = document.documentElement.scrollWidth;
  const viewW = window.innerWidth; // should be 375
  return {
    hasOverflow: docW > viewW,
    documentWidth: docW,
    viewportWidth: viewW,
    overflowPx: docW - viewW
  };
})()
```
- `hasOverflow: false` → PASS
- `hasOverflow: true, overflowPx < 10` → WARNING (minor, may be scrollbar)
- `hasOverflow: true, overflowPx >= 10` → FAIL (broken layout)

---

## Admin Sidebar Opacity Check

Known recurring issue: sidebar becomes transparent on mobile.

**Verification at 375px on any admin page:**
```javascript
// After opening sidebar (click menu button)
(() => {
  // Find sidebar element — typically first child of admin layout with position fixed/absolute
  const sidebar = document.querySelector('[style*="position: fixed"]') ||
                  document.querySelector('[style*="translateX"]') ||
                  document.querySelector('nav');
  if (!sidebar) return { error: 'sidebar not found' };

  const style = getComputedStyle(sidebar);
  return {
    background: style.backgroundColor,
    opacity: style.opacity,
    isTransparent: style.backgroundColor === 'rgba(0, 0, 0, 0)' ||
                   style.backgroundColor === 'transparent' ||
                   style.opacity === '0',
    position: style.position,
    zIndex: style.zIndex,
  };
})()
```
- `isTransparent: false` → PASS
- `isTransparent: true` → CRITICAL: sidebar transparency bug is back!

Expected values:
- Mobile sidebar background: `#F3EFE2` (solid, opaque)
- Desktop sidebar background: `#F0ECDD` (solid, opaque)
- Mobile zIndex: 60
- Mobile border-right: `2px solid #0F0F10` (GH.ink)

---

## Console Error Filtering

### Known Noise (IGNORE)
```
/GSI_LOGGER/           — Google Sign-In FedCM
/TanStack/             — Query devtools
/favicon\.ico.*404/    — Missing favicon
/ResizeObserver loop/  — Browser layout engine (benign)
/Loading chunk .* failed/ — Lazy load retry (network flake)
```

### Real Errors (FLAG)
```
/Cannot read prop/     — Runtime null reference
/is not a function/    — Type mismatch
/Uncaught/             — Unhandled exception
/TypeError/            — Type error
/ReferenceError/       — Missing variable
/SyntaxError/          — Parse error (critical!)
/ChunkLoadError/       — Broken code split (critical!)
/FATAL/                — Application crash
```

### Error Classification
```javascript
const isNoise = (msg) => {
  const noise = [
    /GSI_LOGGER/i,
    /FedCM/i,
    /TanStack/i,
    /favicon/i,
    /ResizeObserver/i,
    /Loading chunk .* failed/i,
    /Download the React DevTools/i,
  ];
  return noise.some(re => re.test(msg));
};
```

---

## Color Contrast Reference

For accessibility spot-checks:

| Token pair              | Contrast ratio | WCAG AA |
|------------------------|---------------|---------|
| GH.ink on GH.paper     | ~19.5:1       | Pass    |
| GH.ink60 on GH.paper   | ~7.5:1        | Pass    |
| GH.ink30 on GH.paper   | ~3.8:1        | Fail*   |
| GH.accent on GH.paper  | ~5.2:1        | Pass    |
| GH.danger on GH.paper  | ~4.8:1        | Pass    |

*GH.ink30 is used only for decorative/supplementary text, not primary content.
