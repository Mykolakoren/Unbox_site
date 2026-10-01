import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
// Мастер брони (/checkout) — в своём файле (волна 2, шаг 0).
import { BookingWizard } from './components/Wizard/BookingWizard';
// Store
import { useUserStore } from './store/userStore';

// "/" — the only page on the critical path, so it is the only eager one.
// Everything below used to be eager too, which meant a visitor landing on "/"
// downloaded MyBookingsPage (3.9k lines), the dashboard and its @dnd-kit board
// before the map could render. They all sit behind their own routes (most behind
// auth), and the whole <Routes> tree is already wrapped in <Suspense>, so lazy()
// is a drop-in here.
import { ExplorePage } from './pages/ExplorePage';
import { DashboardLayout } from './components/DashboardLayout';

const SpecialistsPage = lazy(() => import('./pages/SpecialistsPage').then(m => ({ default: m.SpecialistsPage })));
const SpecialistProfilePage = lazy(() => import('./pages/SpecialistProfilePage').then(m => ({ default: m.SpecialistProfilePage })));
const LocationDetailsPage = lazy(() => import('./pages/LocationDetailsPage').then(m => ({ default: m.LocationDetailsPage })));
const CabinetPage = lazy(() => import('./pages/CabinetPage').then(m => ({ default: m.CabinetPage })));
const LoginPage = lazy(() => import('./pages/LoginPage').then(m => ({ default: m.LoginPage })));
const MyBookingsPage = lazy(() => import('./pages/MyBookingsPage').then(m => ({ default: m.MyBookingsPage })));
const MyWaitlistPage = lazy(() => import('./pages/MyWaitlistPage').then(m => ({ default: m.MyWaitlistPage })));
const BonusesInfoPage = lazy(() => import('./pages/BonusesInfoPage').then(m => ({ default: m.BonusesInfoPage })));
const ProfilePage = lazy(() => import('./pages/ProfilePage').then(m => ({ default: m.ProfilePage })));
const DashboardOverview = lazy(() => import('./pages/DashboardOverview').then(m => ({ default: m.DashboardOverview })));
const TestPage = lazy(() => import('./pages/TestPage').then(m => ({ default: m.TestPage })));
const SubscriptionsPage = lazy(() => import('./pages/SubscriptionsPage').then(m => ({ default: m.SubscriptionsPage })));
const BookingRulesPage = lazy(() => import('./pages/BookingRulesPage').then(m => ({ default: m.BookingRulesPage })));
const BecomeSpecialistPage = lazy(() => import('./pages/BecomeSpecialistPage').then(m => ({ default: m.BecomeSpecialistPage })));
// Контент-блок: новости/анонсы + статьи специалистов (lazy — публичный, но не на каждой сессии)
const PostListPage = lazy(() => import('./pages/content/PostListPage').then(m => ({ default: m.PostListPage })));
const PostDetailPage = lazy(() => import('./pages/content/PostDetailPage').then(m => ({ default: m.PostDetailPage })));

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
const OwnerAnalytics = lazy(() => import('./pages/admin/OwnerAnalytics').then(m => ({ default: m.OwnerAnalytics })));
const AdminTeam = lazy(() => import('./pages/admin/AdminTeam').then(m => ({ default: m.AdminTeam })));
const AdminSpecialists = lazy(() => import('./pages/admin/AdminSpecialists').then(m => ({ default: m.AdminSpecialists })));
const AdminPosts = lazy(() => import('./pages/admin/AdminPosts').then(m => ({ default: m.AdminPosts })));

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
const MobileProfileEdit = lazy(() => import('./pages/mobile/MobileProfileEdit').then(m => ({ default: m.MobileProfileEdit })));
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
const MobileAdminUserCard = lazy(() => import('./pages/mobile/admin/MobileAdminUserCard').then(m => ({ default: m.MobileAdminUserCard })));
const MobileAdminAccessRights = lazy(() => import('./pages/mobile/admin/MobileAdminAccessRights').then(m => ({ default: m.MobileAdminAccessRights })));
const MobileSpecialists = lazy(() => import('./pages/mobile/MobileSpecialists').then(m => ({ default: m.MobileSpecialists })));
const MobileSubscription = lazy(() => import('./pages/mobile/MobileSubscription').then(m => ({ default: m.MobileSubscription })));
const MobileBonuses = lazy(() => import('./pages/mobile/MobileBonuses').then(m => ({ default: m.MobileBonuses })));
const MobilePlaces = lazy(() => import('./pages/mobile/MobilePlaces').then(m => ({ default: m.MobilePlaces })));

import { Toaster } from 'sonner';
import { MotionConfig } from 'framer-motion';
import { ConfirmDialogProvider } from './components/ui/ConfirmDialogProvider';
import { CmdKProvider } from './components/admin/CmdKSearch';
import { ModuleErrorBoundary } from './components/ui/ModuleErrorBoundary';
import { FONT, Z } from './design/tokens';

// Витрина дизайн-системы — только в `npm run dev`. В прод-сборке
// import.meta.env.DEV === false, ветка и сам чанк выбрасываются сборщиком.
const DevUiPage = import.meta.env.DEV
  ? lazy(() => import('./dev/DevUiPage').then(m => ({ default: m.DevUiPage })))
  : null;

// ?forceDesktop=1 однажды в этой вкладке — больше не переадресуем на /m
// до её закрытия (отладка админами). В памяти, не в sessionStorage.
let forceDesktopThisTab = false;

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
  // Волна 2 (X2-02): проверяем адрес не один раз при загрузке пользователя,
  // а при КАЖДОЙ смене адреса — иначе ссылка из колокольчика или из бота,
  // открытая уже внутри приложения (/crm/clients/5, /profile), оставалась
  // компьютерной страницей на телефоне.
  const { pathname } = useLocation();
  useEffect(() => {
    if (!currentUser) return;
    if (new URLSearchParams(window.location.search).get('forceDesktop') === '1') forceDesktopThisTab = true;
    if (forceDesktopThisTab) return;
    // 2026-06-02 owner: убрали canBook-гейт и forceDesktop-эскейп.
    // /m теперь ЕДИНСТВЕННЫЙ мобильный интерфейс — старая «десктоп-в-
    // мобиле» больше не доступна юзерам, чтобы они не путались между
    // двумя версиями. Эскейп остался ТОЛЬКО через явный URL-параметр
    // ?forceDesktop=1 (для админов на момент отладки), без UI-кнопки.
    // Волна 2: флаг помним до закрытия вкладки (forceDesktopThisTab) —
    // проверка теперь идёт на каждом переходе, а параметр в адресе теряется.
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
        // G3-23 / X2-02: профиль из бота (/profile → /dashboard/profile) на
        // телефоне — мобильный «Я», а не компьютерный кабинет.
        [/^\/dashboard\/profile\/?$/, '/m/me'],
        // /subscriptions — витрина тарифов (как catalogPath), не «мой абонемент».
        [/^\/subscriptions\/?$/, '/m/tariffs'],
        [/^\/booking-rules\/?$/, '/m/booking-rules'],
        [/^\/admin\/?$/, '/m/admin'],
        // Точные двойники мобильной админки (X2-02) — раньше всё сворачивалось
        // в /m/admin/dashboard, и заявку/пользователя приходилось искать.
        [/^\/admin\/users\/([^/]+)\/?$/, '/m/admin/users/$1'],
        [/^\/admin\/knowledge-base\/?$/, '/m/admin/kb'],
        // Волна 4 (G8-06): «Обслуживание» на телефоне — вкладка в «Кабинетах».
        [/^\/admin\/maintenance\/?$/, '/m/admin/cabinets?tab=maintenance'],
        [/^\/admin\/(bookings|users|finance|tasks|specialists|crm|cabinets|team|waitlist|access-rights)\/?$/, '/m/admin/$1'],
        [/^\/admin\/[^/]+\/?$/, '/m/admin'],  // остальные разделы админки
        [/^\/crm\/?$/, '/m/crm'],
        // Расписание — до общего правила ниже, иначе ссылка «Расписание»
        // с телефона молча открывала «Сегодня».
        [/^\/crm\/schedule\/?$/, '/m/crm/schedule'],
        // Точные двойники мобильной CRM (X2-02): карточка клиента из
        // уведомления открывается карточкой, а не «Сегодня».
        [/^\/crm\/clients\/([^/]+)\/?$/, '/m/crm/clients/$1'],
        [/^\/crm\/finances\/?$/, '/m/crm/finance'],
        [/^\/crm\/(clients|sessions|notes|profile)\/?$/, '/m/crm/$1'],
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
            // У цели может быть свой ?tab= — тогда параметры адреса через «&».
            const search = window.location.search;
            const tail = (resolved.includes('?') && search ? '&' + search.slice(1) : search) + window.location.hash;
            window.history.replaceState({}, '', resolved + tail);
            window.dispatchEvent(new PopStateEvent('popstate'));
            break;
          }
        }
      }
    } catch { /* matchMedia unavailable in some embedded webviews — ignore */ }
  }, [currentUser, pathname]);

  const lazyFallback = (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin" />
    </div>
  );

  return (
    // reducedMotion="user": при «уменьшить движение» в системе framer-motion
    // убирает сдвиги и масштаб, оставляя только прозрачность.
    <MotionConfig reducedMotion="user">
    <ConfirmDialogProvider>
      <Toaster position="top-center" richColors closeButton style={{ zIndex: Z.toast, fontFamily: FONT.sans }} />
      <CmdKProvider />
      <Suspense fallback={lazyFallback}>
      <Routes>
        {DevUiPage && <Route path="/dev/ui" element={<DevUiPage />} />}
        {/* Public Booking Flow */}
        {/* Лендинг теперь ленивый: при устаревшем чанке после деплоя — автоперезагрузка из ModuleErrorBoundary. */}
        <Route path="/" element={<ModuleErrorBoundary moduleName="Главная"><ExplorePage /></ModuleErrorBoundary>} />
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

        {/* Контент: новости/анонсы + тексты специалистов */}
        <Route path="/news" element={<Suspense fallback={null}><PostListPage type="news" /></Suspense>} />
        <Route path="/news/:slug" element={<Suspense fallback={null}><PostDetailPage /></Suspense>} />
        <Route path="/articles" element={<Suspense fallback={null}><PostListPage type="article" /></Suspense>} />
        <Route path="/articles/:slug" element={<Suspense fallback={null}><PostDetailPage /></Suspense>} />

        {/* Self-assessment tests */}
        <Route path="/tests/:testId" element={<TestPage />} />

        {/* Legacy Checkout Wizard Route (for backward compat / direct checkout).
            Гейт по ширине НА САМОМ РОУТЕ (аудит 30.08): раньше каждый CTA был
            обязан сам помнить про редирект на /m/find, и один забытый FAB
            уводил мобильного клиента в нечитаемую десктопную шахматку.
            Теперь любой путь в /checkout с телефона попадает в мобильный
            мастер — класс ошибок закрыт целиком. */}
        <Route path="/checkout" element={
            typeof window !== 'undefined' && window.innerWidth < 768
                ? <Navigate to="/m/find" replace />
                : <ModuleErrorBoundary moduleName="Бронирование"><BookingWizard /></ModuleErrorBoundary>
        } />

        {/* Auth */}
        <Route path="/login" element={<LoginPage />} />

        {/* Short-link aliases (used by TG bot, emails, external links) */}
        <Route path="/profile" element={<Navigate to="/dashboard/profile" replace />} />
        <Route path="/bookings" element={<Navigate to="/dashboard/bookings" replace />} />

        {/* Dashboard */}
        <Route path="/dashboard" element={<ModuleErrorBoundary moduleName="Личный кабинет"><DashboardLayout /></ModuleErrorBoundary>}>
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
          <Route path="analytics" element={<OwnerAnalytics />} />
          <Route path="team" element={<AdminTeam />} />
          <Route path="specialists" element={<AdminSpecialists />} />
          <Route path="posts" element={<AdminPosts />} />
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
          {/* Имя и телефон с телефона — тот же PATCH /users/me, что на компьютере. */}
          <Route path="profile" element={<MobileProfileEdit />} />
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
          {/* Анкета специалиста внутри мобильной оболочки: раньше с телефона
              она открывалась компьютерной страницей без нижнего меню. */}
          <Route path="become-specialist" element={<BecomeSpecialistPage />} />
          {/* Тарифы внутри мобильной оболочки: раньше кнопки вели на /subscriptions
              и клиент вылетал в «компьютерный» вид без нижнего меню. */}
          <Route path="tariffs" element={<SubscriptionsPage />} />
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
          {/* Часы приёма с телефона — тот же экран, что /crm/schedule,
              в узкой раскладке. Раньше на телефоне расписание было
              недоступно: /crm/schedule уводил на «Сегодня». */}
          <Route path="schedule" element={<CrmSchedule compact />} />
        </Route>

        {/* Mobile admin workspace — admin/owner only, gated inside layout. */}
        <Route path="/m/admin" element={<ModuleErrorBoundary moduleName="Mobile admin"><MobileAdminLayout /></ModuleErrorBoundary>}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<MobileAdminDashboard />} />
          <Route path="tasks" element={<MobileAdminTasks />} />
          <Route path="users" element={<MobileAdminUsers />} />
          {/* Волна 4 (G9-04): нативная карточка — баланс первым, не десктопная страница. */}
          <Route path="users/:email" element={<MobileAdminUserCard />} />
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
          <Route path="access-rights" element={<MobileAdminAccessRights />} />
          <Route path="waitlist" element={<MobileAdminWaitlist />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </ConfirmDialogProvider>
    </MotionConfig>
  );
}

export default App;
