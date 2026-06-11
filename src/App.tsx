import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { MinimalLayout } from './components/MinimalLayout';
import { Summary } from './components/Summary';
// Wizard Steps
import { ChessboardStep } from './components/Wizard/ChessboardStep';
import { OptionsStep } from './components/Wizard/OptionsStep';
import { ConfirmationStep } from './components/Wizard/ConfirmationStep';
// Store
import { useBookingStore } from './store/bookingStore';
import { useUserStore } from './store/userStore';

// Public pages (loaded eagerly — critical path)
import { ExplorePage } from './pages/ExplorePage';
import { SpecialistsPage } from './pages/SpecialistsPage';
import { SpecialistProfilePage } from './pages/SpecialistProfilePage';
import { LocationDetailsPage } from './pages/LocationDetailsPage';
import { CabinetPage } from './pages/CabinetPage';
import { LoginPage } from './pages/LoginPage';
import { DashboardLayout } from './components/DashboardLayout';
import { MyBookingsPage } from './pages/MyBookingsPage';
import { MyWaitlistPage } from './pages/MyWaitlistPage';
import { BonusesInfoPage } from './pages/BonusesInfoPage';
import { ProfilePage } from './pages/ProfilePage';
import { DashboardOverview } from './pages/DashboardOverview';
import { TestPage } from './pages/TestPage';
import { SubscriptionsPage } from './pages/SubscriptionsPage';
import { BookingRulesPage } from './pages/BookingRulesPage';
const BecomeSpecialistPage = lazy(() => import('./pages/BecomeSpecialistPage').then(m => ({ default: m.BecomeSpecialistPage })));

// Admin pages (lazy loaded — only for admins)
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout').then(m => ({ default: m.AdminLayout })));
const AdminUsers = lazy(() => import('./pages/admin/Users').then(m => ({ default: m.AdminUsers })));
const AdminBookings = lazy(() => import('./pages/admin/Bookings').then(m => ({ default: m.AdminBookings })));
const AdminDashboard = lazy(() => import('./pages/admin/Dashboard').then(m => ({ default: m.AdminDashboard })));
const AdminWaitlist = lazy(() => import('./pages/admin/Waitlist').then(m => ({ default: m.AdminWaitlist })));
const AdminUserDetails = lazy(() => import('./pages/admin/UserDetails').then(m => ({ default: m.AdminUserDetails })));
const AdminCabinets = lazy(() => import('./pages/admin/Cabinets').then(m => ({ default: m.AdminCabinets })));
const AdminMaintenance = lazy(() => import('./pages/admin/Maintenance').then(m => ({ default: m.AdminMaintenance })));
const AdminKnowledgeBase = lazy(() => import('./pages/admin/KnowledgeBase').then(m => ({ default: m.AdminKnowledgeBase })));
const AdminTasksBoard = lazy(() => import('./pages/admin/TasksBoard').then(m => ({ default: m.AdminTasksBoard })));
const AdminCrm = lazy(() => import('./pages/admin/AdminCrm').then(m => ({ default: m.AdminCrm })));
const AdminAccessRights = lazy(() => import('./pages/admin/AccessRights').then(m => ({ default: m.AdminAccessRights })));
const AdminFinance = lazy(() => import('./pages/admin/Finance').then(m => ({ default: m.AdminFinance })));
const AdminTeam = lazy(() => import('./pages/admin/AdminTeam').then(m => ({ default: m.AdminTeam })));
const AdminSpecialists = lazy(() => import('./pages/admin/AdminSpecialists').then(m => ({ default: m.AdminSpecialists })));

// CRM pages (lazy loaded — only for specialists)
const CrmLayout = lazy(() => import('./pages/crm/CrmLayout').then(m => ({ default: m.CrmLayout })));
const CrmDashboard = lazy(() => import('./pages/crm/CrmDashboard').then(m => ({ default: m.CrmDashboard })));
const CrmClients = lazy(() => import('./pages/crm/CrmClients').then(m => ({ default: m.CrmClients })));
const CrmClientDetail = lazy(() => import('./pages/crm/CrmClientDetail').then(m => ({ default: m.CrmClientDetail })));
const CrmSessions = lazy(() => import('./pages/crm/CrmSessions').then(m => ({ default: m.CrmSessions })));
const CrmBookings = lazy(() => import('./pages/crm/CrmBookings').then(m => ({ default: m.CrmBookings })));
const CrmFinances = lazy(() => import('./pages/crm/CrmFinances').then(m => ({ default: m.CrmFinances })));
const CrmNotes = lazy(() => import('./pages/crm/CrmNotes').then(m => ({ default: m.CrmNotes })));
const CrmSchedule = lazy(() => import('./pages/crm/CrmSchedule').then(m => ({ default: m.CrmSchedule })));
const CrmSettings = lazy(() => import('./pages/crm/CrmSettings').then(m => ({ default: m.CrmSettings })));
const CrmProfile = lazy(() => import('./pages/crm/CrmProfile').then(m => ({ default: m.CrmProfile })));

// Mobile beta — admin/owner-gated alternative interface; chunked separately
// so it doesn't bloat the main bundle for regular users.
const MobileLayout = lazy(() => import('./pages/mobile/MobileLayout').then(m => ({ default: m.MobileLayout })));
const MobileToday = lazy(() => import('./pages/mobile/MobileToday').then(m => ({ default: m.MobileToday })));
const MobileMyBookings = lazy(() => import('./pages/mobile/MobileMyBookings').then(m => ({ default: m.MobileMyBookings })));
const MobileFind = lazy(() => import('./pages/mobile/MobileFind').then(m => ({ default: m.MobileFind })));
const MobileProfile = lazy(() => import('./pages/mobile/MobileProfile').then(m => ({ default: m.MobileProfile })));
const MobileCheckout = lazy(() => import('./pages/mobile/MobileCheckout').then(m => ({ default: m.MobileCheckout })));
const MobileCalendar = lazy(() => import('./pages/mobile/MobileCalendar').then(m => ({ default: m.MobileCalendar })));
const MobileCrmLayout = lazy(() => import('./pages/mobile/crm/MobileCrmLayout').then(m => ({ default: m.MobileCrmLayout })));
const MobileCrmToday = lazy(() => import('./pages/mobile/crm/MobileCrmToday').then(m => ({ default: m.MobileCrmToday })));
const MobileCrmClients = lazy(() => import('./pages/mobile/crm/MobileCrmClients').then(m => ({ default: m.MobileCrmClients })));
const MobileCrmClient = lazy(() => import('./pages/mobile/crm/MobileCrmClient').then(m => ({ default: m.MobileCrmClient })));
const MobileCrmNotes = lazy(() => import('./pages/mobile/crm/MobileCrmNotes').then(m => ({ default: m.MobileCrmNotes })));
const MobileCrmProfile = lazy(() => import('./pages/mobile/crm/MobileCrmProfile').then(m => ({ default: m.MobileCrmProfile })));
const MobileCrmFinance = lazy(() => import('./pages/mobile/crm/MobileCrmFinance').then(m => ({ default: m.MobileCrmFinance })));
const MobileCrmSessions = lazy(() => import('./pages/mobile/crm/MobileCrmSessions').then(m => ({ default: m.MobileCrmSessions })));
const MobileAdminLayout = lazy(() => import('./pages/mobile/admin/MobileAdminLayout').then(m => ({ default: m.MobileAdminLayout })));
const MobileAdminDashboard = lazy(() => import('./pages/mobile/admin/MobileAdminDashboard').then(m => ({ default: m.MobileAdminDashboard })));
const MobileAdminUsers = lazy(() => import('./pages/mobile/admin/MobileAdminUsers').then(m => ({ default: m.MobileAdminUsers })));
const MobileAdminInbox = lazy(() => import('./pages/mobile/admin/MobileAdminInbox').then(m => ({ default: m.MobileAdminInbox })));
const MobileAdminTasks = lazy(() => import('./pages/mobile/admin/MobileAdminTasks').then(m => ({ default: m.MobileAdminTasks })));
const MobileAdminFinance = lazy(() => import('./pages/mobile/admin/MobileAdminFinance').then(m => ({ default: m.MobileAdminFinance })));
const MobileAdminCabinets = lazy(() => import('./pages/mobile/admin/MobileAdminCabinets').then(m => ({ default: m.MobileAdminCabinets })));
const MobileAdminTeam = lazy(() => import('./pages/mobile/admin/MobileAdminTeam').then(m => ({ default: m.MobileAdminTeam })));
const MobileAdminSpecialists = lazy(() => import('./pages/mobile/admin/MobileAdminSpecialists').then(m => ({ default: m.MobileAdminSpecialists })));
const MobileAdminKB = lazy(() => import('./pages/mobile/admin/MobileAdminKB').then(m => ({ default: m.MobileAdminKB })));
const MobileAdminBookings = lazy(() => import('./pages/mobile/admin/MobileAdminBookings').then(m => ({ default: m.MobileAdminBookings })));
const MobileAdminCrm = lazy(() => import('./pages/mobile/admin/MobileAdminCrm').then(m => ({ default: m.MobileAdminCrm })));
const MobileAdminWaitlist = lazy(() => import('./pages/mobile/admin/MobileAdminWaitlist').then(m => ({ default: m.MobileAdminWaitlist })));
const MobileSpecialists = lazy(() => import('./pages/mobile/MobileSpecialists').then(m => ({ default: m.MobileSpecialists })));
const MobileSubscription = lazy(() => import('./pages/mobile/MobileSubscription').then(m => ({ default: m.MobileSubscription })));
const MobileBonuses = lazy(() => import('./pages/mobile/MobileBonuses').then(m => ({ default: m.MobileBonuses })));
const MobilePlaces = lazy(() => import('./pages/mobile/MobilePlaces').then(m => ({ default: m.MobilePlaces })));

import { GH, GH_SANS } from './hooks/useDesignFlag';

// Booking Flow Wrapper
function BookingWizard() {
  const { step, editBookingId, bookingForUser, setBookingForUser, reset } = useBookingStore();
  const wizardMode = useBookingStore(s => s.mode);
  const selectedSlots = useBookingStore(s => s.selectedSlots);
  const users = useUserStore(s => s.users);

  // Excel #73 — warn before leaving an in-progress booking.
  // Browser-native confirm via beforeunload covers: tab close, page reload,
  // external navigation (typing a new URL). For internal React Router
  // navigation we rely on the fact that most exit points in the wizard are
  // explicit buttons — they reset the store themselves. Having the full
  // useBlocker solution would need upgrading to a data router; beforeunload
  // already catches the real "oh no I closed the tab" case.
  useEffect(() => {
    const hasUnsavedWork = selectedSlots.length > 0 && step >= 2 && !editBookingId;
    if (!hasUnsavedWork) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Chrome/Edge require setting returnValue explicitly. Modern browsers
      // ignore the custom string and show their own generic prompt.
      e.returnValue = 'Вы не завершили процесс бронирования. Уйти со страницы?';
      return e.returnValue;
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [selectedSlots.length, step, editBookingId]);

  // Resolve friendly name for the "booking-for" admin-proxy banner
  const proxyUser = bookingForUser
    ? users.find(u => u.email === bookingForUser || u.id === bookingForUser)
    : null;

  /* GH card style */
  const ghCard: React.CSSProperties = {
    background: '#fff',
    border: `1px solid ${GH.ink8}`,
    borderRadius: 12,
    overflow: 'hidden',
  };

  return (
    <MinimalLayout glassMode fullWidth={step === 2} noPadding>

      {/* The reschedule dup-creation bug was fixed & verified
          (CLAUDE.md → "Решённые баги": фикс 2026-05-23, проверка 2026-05-26 —
          0 дублей на 50 новых броней). The old red "может создать дубль"
          warning banner was removed so it stops eroding trust on every
          reschedule. The neutral edit banner below still covers reschedule via
          its `editBookingId` condition. */}
      {editBookingId && (
        <div className={`${step === 2 ? 'max-w-[1920px] px-8' : 'max-w-6xl px-4'} mx-auto mb-4`}>
          <div style={{
            background: '#FEF3C7', border: `1px solid ${GH.ink10}`, color: '#92400E',
            padding: '12px 16px', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            fontFamily: GH_SANS, fontSize: 14,
          }}>
            <span style={{ fontWeight: 500 }}>
              {wizardMode === 'reschedule'
                ? 'Вы переносите существующее бронирование'
                : 'Вы редактируете существующее бронирование'}
            </span>
            <button onClick={() => reset()}
              style={{ fontSize: 13, fontWeight: 700, textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', color: '#92400E' }}>
              {wizardMode === 'reschedule' ? 'Отменить перенос' : 'Отменить редактирование'}
            </button>
          </div>
        </div>
      )}

      {/* Admin-proxy booking banner — visible on every step so the admin
          can't forget whose booking they're creating. Click "Сбросить" to
          clear target and book for themselves. */}
      {bookingForUser && (
        <div
          className={`${step === 2 ? 'max-w-[1920px] px-8' : 'max-w-6xl px-4'} mx-auto mb-4`}
          style={{ position: 'sticky', top: 8, zIndex: 20 }}
        >
          <div style={{
            background: '#EDE9FE',
            border: `1px solid ${GH.ink10}`,
            color: '#5B21B6',
            padding: '12px 16px',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            fontFamily: GH_SANS,
            fontSize: 14,
            boxShadow: '0 4px 12px rgba(91,33,182,0.08)',
          }}>
            <span>
              <strong style={{ fontWeight: 700 }}>
                Бронь для клиента: {proxyUser?.name || bookingForUser}
              </strong>
              {proxyUser?.email && proxyUser.email !== proxyUser.name && (
                <span style={{ marginLeft: 8, opacity: 0.7, fontSize: 13 }}>
                  {proxyUser.email}
                </span>
              )}
            </span>
            <button
              onClick={() => setBookingForUser(null)}
              style={{
                fontSize: 13,
                fontWeight: 700,
                textDecoration: 'underline',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: '#5B21B6',
              }}
            >
              Сбросить → бронь для себя
            </button>
          </div>
        </div>
      )}

      {step === 2 ? (
        /* ── Step 2: Full-width chessboard ── */
        <div className="max-w-[1920px] mx-auto px-6 md:px-12">
          <div style={ghCard}>
            <ChessboardStep />
          </div>
        </div>
      ) : (
        /* ── Steps 3 & 4: two-column layout ── */
        <div className="max-w-6xl mx-auto px-4 md:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-8">
              {step === 1 && <Navigate to="/" replace />}
              {/* Owner 2026-05-27: merged Options step into Confirmation —
                  Format is already pickable on the chessboard, Extras are
                  only 4 items, the gap step felt redundant. Render
                  ConfirmationStep for both step==3 and step==4 so every
                  caller that still navigates to step:3 keeps working. */}
              {(step === 3 || step === 4) && (
                <div style={{ ...ghCard, padding: 32 }}>
                  <ConfirmationStep />
                </div>
              )}
            </div>
            {step < 5 && (
              <div className="lg:col-span-4 hidden lg:block">
                <div style={{ ...ghCard, position: 'sticky' as const, top: 80 }}>
                  <Summary />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

    </MinimalLayout>
  );
}

import { Toaster } from 'sonner';
import { ConfirmDialogProvider } from './components/ui/ConfirmDialogProvider';
import { CmdKProvider } from './components/admin/CmdKSearch';
import { ModuleErrorBoundary } from './components/ui/ModuleErrorBoundary';

function App() {
  const { fetchBookings, fetchCurrentUser, fetchWaitlist } = useUserStore();

  useEffect(() => {
    // 1. Check for token in URL (from Telegram Redirect Auth)
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('token');
    if (urlToken) {
      localStorage.setItem('token', urlToken);
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    // 2. Fetch user data if token exists
    const token = localStorage.getItem('token');
    if (token) {
      fetchCurrentUser();
      fetchBookings();
      fetchWaitlist();
    }

  }, [fetchBookings, fetchCurrentUser, fetchWaitlist]);

  // Phone-width auto-redirect to /m.
  //
  // Trigger paths:
  //   1. Standalone PWA launch (iOS/Android home-screen). iOS caches the
  //      shortcut's start_url, so users may still land on /dashboard from
  //      old installs — we patch at runtime.
  //   2. Phone-width browser (≤768px viewport). Once /m is the primary
  //      mobile interface, opening /dashboard on a phone should always
  //      bounce to /m unless the user explicitly opted back in.
  //
  // Opt-out: tapping "Полный кабинет (десктоп)" in /m/me sets
  // `sessionStorage.forceDesktop=1`, suppressing the redirect for the rest
  // of the tab session. Per-session is deliberate — they shouldn't have to
  // re-opt-out every navigation, but a fresh tab puts them back on /m.
  //
  // Wait for `currentUser` so we don't kick a non-canBook user into /m
  // (where MobileLayout bounces them back, looping). When they're loaded
  // and qualify, replace the URL — using replaceState keeps the back-stack
  // clean.
  const currentUser = useUserStore(s => s.currentUser);
  useEffect(() => {
    if (!currentUser) return;
    // 2026-06-02 owner: убрали canBook-гейт и forceDesktop-эскейп.
    // /m теперь ЕДИНСТВЕННЫЙ мобильный интерфейс — старая «десктоп-в-
    // мобиле» больше не доступна юзерам, чтобы они не путались между
    // двумя версиями. Эскейп остался ТОЛЬКО через явный URL-параметр
    // ?forceDesktop=1 (для админов на момент отладки), без UI-кнопки.
    if (new URLSearchParams(window.location.search).get('forceDesktop') === '1') return;
    try {
      const inStandalone = window.matchMedia?.('(display-mode: standalone)').matches
        || (window.navigator as any).standalone === true;
      const isPhoneWidth = window.matchMedia?.('(max-width: 768px)').matches;
      const path = window.location.pathname;
      const redirectMap: Array<[RegExp, string]> = [
        [/^\/(?:dashboard)?\/?$/, '/m'],
        [/^\/dashboard\/bookings\/?$/, '/m/bookings'],
        [/^\/dashboard\/waitlist\/?$/, '/m/waitlist'],
        [/^\/dashboard\/bonuses\/?$/, '/m/bonuses'],
        [/^\/subscriptions\/?$/, '/m/subscription'],
        [/^\/booking-rules\/?$/, '/m/booking-rules'],
        [/^\/admin\/?$/, '/m/admin'],
        [/^\/admin\/bookings\/?$/, '/m/admin/bookings'],
        [/^\/admin\/[^/]+\/?$/, '/m/admin'],  // /admin/finance, /admin/users, etc.
        [/^\/crm\/?$/, '/m/crm'],
        [/^\/crm\/[^/]+\/?$/, '/m/crm'],
        [/^\/profile\/?$/, '/m/me'],
        [/^\/explore\/?$/, '/m/find'],
        [/^\/specialists\/?$/, '/m/specialists'],
        [/^\/specialists\/([^/]+)\/?$/, '/m/specialists/$1'],
        [/^\/location\/([^/]+)\/?$/, '/m/location/$1'],
        [/^\/cabinet\/([^/]+)\/?$/, '/m/cabinet/$1'],
      ];
      const isMobileEntry = inStandalone || isPhoneWidth;
      if (isMobileEntry) {
        for (const [re, target] of redirectMap) {
          const match = path.match(re);
          if (match) {
            // Substitute $1 captures (for location/cabinet ids)
            const resolved = target.replace(/\$(\d+)/g, (_, n) => match[Number(n)] || '');
            // Preserve query+hash — deep-links like ?series=<group_id>
            // from Telegram reminders rely on the param surviving the
            // /dashboard/* → /m/* hop.
            const tail = window.location.search + window.location.hash;
            window.history.replaceState({}, '', resolved + tail);
            window.dispatchEvent(new PopStateEvent('popstate'));
            break;
          }
        }
      }
    } catch { /* matchMedia unavailable in some embedded webviews — ignore */ }
  }, [currentUser]);

  const lazyFallback = (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin" />
    </div>
  );

  return (
    <ConfirmDialogProvider>
      <Toaster position="top-center" richColors closeButton />
      <CmdKProvider />
      <Suspense fallback={lazyFallback}>
      <Routes>
        {/* Public Booking Flow */}
        <Route path="/" element={<ExplorePage />} />
        <Route path="/explore" element={<Navigate to="/" replace />} />
        <Route path="/location/:locationId" element={<LocationDetailsPage />} />
        <Route path="/cabinet/:resourceId" element={<CabinetPage />} />

        {/* Specialists Marketplace */}
        <Route path="/specialists" element={<SpecialistsPage />} />
        <Route path="/specialists/:id" element={<SpecialistProfilePage />} />
        <Route path="/become-specialist" element={<Suspense fallback={null}><BecomeSpecialistPage /></Suspense>} />

        {/* Subscriptions */}
        <Route path="/subscriptions" element={<SubscriptionsPage />} />
        <Route path="/booking-rules" element={<BookingRulesPage />} />

        {/* Self-assessment tests */}
        <Route path="/tests/:testId" element={<TestPage />} />

        {/* Legacy Checkout Wizard Route (for backward compat / direct checkout) */}
        <Route path="/checkout" element={<ModuleErrorBoundary moduleName="Бронирование"><BookingWizard /></ModuleErrorBoundary>} />

        {/* Auth */}
        <Route path="/login" element={<LoginPage />} />

        {/* Short-link aliases (used by TG bot, emails, external links) */}
        <Route path="/profile" element={<Navigate to="/dashboard/profile" replace />} />
        <Route path="/bookings" element={<Navigate to="/dashboard/bookings" replace />} />

        {/* Dashboard */}
        <Route path="/dashboard" element={<DashboardLayout />}>
          <Route index element={<DashboardOverview />} />
          <Route path="bookings" element={<MyBookingsPage />} />
          <Route path="waitlist" element={<MyWaitlistPage />} />
          <Route path="bonuses" element={<BonusesInfoPage />} />
          <Route path="profile" element={<ProfilePage />} />
        </Route>

        {/* CRM — Specialist Personal Cabinet */}
        <Route path="/crm" element={<ModuleErrorBoundary moduleName="CRM"><CrmLayout /></ModuleErrorBoundary>}>
          <Route index element={<CrmDashboard />} />
          <Route path="clients" element={<CrmClients />} />
          <Route path="clients/:clientId" element={<CrmClientDetail />} />
          <Route path="sessions" element={<CrmSessions />} />
          <Route path="bookings" element={<CrmBookings />} />
          <Route path="finances" element={<CrmFinances />} />
          <Route path="notes" element={<CrmNotes />} />
          <Route path="schedule" element={<CrmSchedule />} />
          <Route path="settings" element={<CrmSettings />} />
          <Route path="profile" element={<CrmProfile />} />
          {/* 2026-06-05 owner: личные функции теперь живут внутри /crm
              шелла. Специалист не покидает CRM ради абонемента / бонусов
              / профиля / waitlist'а — все эти страницы рендерятся под тем
              же sidebar'ом. /dashboard остаётся только для роли user. */}
          <Route path="subscription" element={<SubscriptionsPage />} />
          <Route path="bonuses" element={<BonusesInfoPage />} />
          <Route path="waitlist" element={<MyWaitlistPage />} />
          <Route path="account" element={<ProfilePage />} />
        </Route>

        <Route path="/admin" element={<ModuleErrorBoundary moduleName="Админ-панель"><AdminLayout /></ModuleErrorBoundary>}>
          <Route index element={<AdminDashboard />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="users/:email" element={<AdminUserDetails />} />
          <Route path="cabinets" element={<AdminCabinets />} />
          <Route path="maintenance" element={<AdminMaintenance />} />
          <Route path="bookings" element={<AdminBookings />} />
          <Route path="waitlist" element={<AdminWaitlist />} />
          <Route path="knowledge-base" element={<AdminKnowledgeBase />} />
          <Route path="tasks" element={<AdminTasksBoard />} />
          <Route path="crm" element={<AdminCrm />} />
          <Route path="finance" element={<AdminFinance />} />
          <Route path="team" element={<AdminTeam />} />
          <Route path="specialists" element={<AdminSpecialists />} />
          <Route path="access-rights" element={<AdminAccessRights />} />
          {/* Личные функции под админским шеллом — симметрично с /crm. */}
          <Route path="subscription" element={<SubscriptionsPage />} />
          <Route path="bonuses" element={<BonusesInfoPage />} />
          <Route path="my-waitlist" element={<MyWaitlistPage />} />
          <Route path="account" element={<ProfilePage />} />
        </Route>

        {/* Mobile beta — admin-gated interface for prototyping the phone-first
            specialist experience. The MobileLayout itself enforces the role
            check and redirects non-admins to /dashboard. */}
        <Route path="/m" element={<ModuleErrorBoundary moduleName="Mobile"><MobileLayout /></ModuleErrorBoundary>}>
          <Route index element={<Navigate to="today" replace />} />
          <Route path="today" element={<MobileToday />} />
          <Route path="bookings" element={<MobileMyBookings />} />
          <Route path="find" element={<MobileFind />} />
          <Route path="me" element={<MobileProfile />} />
          <Route path="subscription" element={<MobileSubscription />} />
          <Route path="bonuses" element={<MobileBonuses />} />
          <Route path="checkout" element={<MobileCheckout />} />
          <Route path="calendar" element={<MobileCalendar />} />
          {/* Client-facing pages that reuse the desktop component
              inside the mobile shell. They're already responsive enough
              for phone width; a native mobile rewrite is planned later. */}
          <Route path="waitlist" element={<MyWaitlistPage />} />
          <Route path="specialists" element={<MobileSpecialists />} />
          <Route path="specialists/:id" element={<SpecialistProfilePage />} />
          <Route path="places" element={<MobilePlaces />} />
          <Route path="location/:locationId" element={<LocationDetailsPage />} />
          <Route path="cabinet/:resourceId" element={<CabinetPage />} />
          <Route path="booking-rules" element={<BookingRulesPage />} />
        </Route>

        {/* Mobile CRM workspace — separate shell, separate tab bar. */}
        <Route path="/m/crm" element={<ModuleErrorBoundary moduleName="Mobile CRM"><MobileCrmLayout /></ModuleErrorBoundary>}>
          <Route index element={<Navigate to="today" replace />} />
          <Route path="today" element={<MobileCrmToday />} />
          <Route path="clients" element={<MobileCrmClients />} />
          <Route path="clients/:clientId" element={<MobileCrmClient />} />
          <Route path="notes" element={<MobileCrmNotes />} />
          <Route path="finance" element={<MobileCrmFinance />} />
          <Route path="sessions" element={<MobileCrmSessions />} />
          <Route path="profile" element={<MobileCrmProfile />} />
        </Route>

        {/* Mobile admin workspace — admin/owner only, gated inside layout. */}
        <Route path="/m/admin" element={<ModuleErrorBoundary moduleName="Mobile admin"><MobileAdminLayout /></ModuleErrorBoundary>}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<MobileAdminDashboard />} />
          <Route path="tasks" element={<MobileAdminTasks />} />
          <Route path="users" element={<MobileAdminUsers />} />
          <Route path="users/:email" element={<AdminUserDetails />} />
          <Route path="inbox" element={<MobileAdminInbox />} />
          <Route path="finance" element={<MobileAdminFinance />} />
          <Route path="cabinets" element={<MobileAdminCabinets />} />
          <Route path="team" element={<MobileAdminTeam />} />
          <Route path="specialists" element={<MobileAdminSpecialists />} />
          <Route path="kb" element={<MobileAdminKB />} />
          {/* Native mobile views — chessboard и Kanban на 375px не работают,
              сделали отдельные mobile-first версии (список с фильтрами /
              stage-selector). Остальные админские страницы (waitlist,
              access-rights, users/:email) переиспользуют desktop component,
              т.к. их верстка уже flex-based и нормально работает. */}
          <Route path="bookings" element={<MobileAdminBookings />} />
          <Route path="crm" element={<MobileAdminCrm />} />
          <Route path="access-rights" element={<AdminAccessRights />} />
          <Route path="waitlist" element={<MobileAdminWaitlist />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </ConfirmDialogProvider>
  );
}

export default App;
