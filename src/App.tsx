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

// Public pages (loaded eagerly — critical path)
import { ExplorePage } from './pages/ExplorePage';
import { SpecialistsPage } from './pages/SpecialistsPage';
import { SpecialistProfilePage } from './pages/SpecialistProfilePage';
import { LocationDetailsPage } from './pages/LocationDetailsPage';
import { LoginPage } from './pages/LoginPage';
import { DashboardLayout } from './components/DashboardLayout';
import { MyBookingsPage } from './pages/MyBookingsPage';
import { ProfilePage } from './pages/ProfilePage';
import { DashboardOverview } from './pages/DashboardOverview';
import { TestPage } from './pages/TestPage';
import { SubscriptionsPage } from './pages/SubscriptionsPage';

// Admin pages (lazy loaded — only for admins)
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout').then(m => ({ default: m.AdminLayout })));
const AdminUsers = lazy(() => import('./pages/admin/Users').then(m => ({ default: m.AdminUsers })));
const AdminBookings = lazy(() => import('./pages/admin/Bookings').then(m => ({ default: m.AdminBookings })));
const AdminDashboard = lazy(() => import('./pages/admin/Dashboard').then(m => ({ default: m.AdminDashboard })));
const AdminWaitlist = lazy(() => import('./pages/admin/Waitlist').then(m => ({ default: m.AdminWaitlist })));
const AdminUserDetails = lazy(() => import('./pages/admin/UserDetails').then(m => ({ default: m.AdminUserDetails })));
const AdminCabinets = lazy(() => import('./pages/admin/Cabinets').then(m => ({ default: m.AdminCabinets })));
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

import { glassPanel, glassSummary } from './utils/styles';
import { useDesignFlag, GH, GH_SANS } from './hooks/useDesignFlag';

// Booking Flow Wrapper
function BookingWizard() {
  const { step, editBookingId, reset } = useBookingStore();
  const isGH = useDesignFlag();

  /* GH card style */
  const ghCard: React.CSSProperties = {
    background: '#fff',
    border: `1px solid ${GH.ink8}`,
    borderRadius: 12,
    overflow: 'hidden',
  };

  return (
    <MinimalLayout glassMode fullWidth={step === 2} noPadding>

      {/* Edit mode banner */}
      {editBookingId && (
        <div className={`${step === 2 ? 'max-w-[1920px] px-8' : 'max-w-6xl px-4'} mx-auto mb-4`}>
          <div style={isGH ? {
            background: '#FEF3C7', border: `1px solid ${GH.ink10}`, color: '#92400E',
            padding: '12px 16px', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            fontFamily: GH_SANS, fontSize: 14,
          } : undefined}
               className={isGH ? '' : "bg-amber-50/90 backdrop-blur-sm border border-amber-200 text-amber-800 px-4 py-3 rounded-xl flex items-center justify-between"}>
            <span style={isGH ? { fontWeight: 500 } : undefined} className={isGH ? '' : "font-medium"}>Вы редактируете существующее бронирование</span>
            <button onClick={() => reset()}
              style={isGH ? { fontSize: 13, fontWeight: 700, textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', color: '#92400E' } : undefined}
              className={isGH ? '' : "text-sm font-bold underline hover:no-underline"}>
              Отменить редактирование
            </button>
          </div>
        </div>
      )}

      {step === 2 ? (
        /* ── Step 2: Full-width chessboard ── */
        <div className="max-w-[1920px] mx-auto px-6 md:px-12">
          <div style={isGH ? ghCard : glassPanel} className={isGH ? '' : "rounded-[28px] overflow-hidden"}>
            <ChessboardStep />
          </div>
        </div>
      ) : (
        /* ── Steps 3 & 4: two-column layout ── */
        <div className="max-w-6xl mx-auto px-4 md:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-8">
              {step === 1 && <Navigate to="/" replace />}
              {step === 3 && (
                <div style={isGH ? { ...ghCard, padding: 32 } : glassPanel} className={isGH ? '' : "rounded-[28px] overflow-hidden p-8"}>
                  <OptionsStep />
                </div>
              )}
              {step === 4 && (
                <div style={isGH ? { ...ghCard, padding: 32 } : glassPanel} className={isGH ? '' : "rounded-[28px] overflow-hidden p-8"}>
                  <ConfirmationStep />
                </div>
              )}
            </div>
            {step < 5 && (
              <div className="lg:col-span-4 hidden lg:block">
                <div style={isGH ? { ...ghCard, position: 'sticky' as const, top: 80 } : glassSummary}
                     className={isGH ? '' : "rounded-[28px] overflow-hidden sticky top-[148px]"}>
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

import { useUserStore } from './store/userStore';
import { Toaster } from 'sonner';
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

  const lazyFallback = (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin" />
    </div>
  );

  return (
    <>
      <Toaster position="top-center" richColors closeButton />
      <Suspense fallback={lazyFallback}>
      <Routes>
        {/* Public Booking Flow */}
        <Route path="/" element={<ExplorePage />} />
        <Route path="/explore" element={<Navigate to="/" replace />} />
        <Route path="/location/:locationId" element={<LocationDetailsPage />} />

        {/* Specialists Marketplace */}
        <Route path="/specialists" element={<SpecialistsPage />} />
        <Route path="/specialists/:id" element={<SpecialistProfilePage />} />

        {/* Subscriptions */}
        <Route path="/subscriptions" element={<SubscriptionsPage />} />

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
        </Route>

        <Route path="/admin" element={<ModuleErrorBoundary moduleName="Админ-панель"><AdminLayout /></ModuleErrorBoundary>}>
          <Route index element={<AdminDashboard />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="users/:email" element={<AdminUserDetails />} />
          <Route path="cabinets" element={<AdminCabinets />} />
          <Route path="bookings" element={<AdminBookings />} />
          <Route path="waitlist" element={<AdminWaitlist />} />
          <Route path="knowledge-base" element={<AdminKnowledgeBase />} />
          <Route path="tasks" element={<AdminTasksBoard />} />
          <Route path="crm" element={<AdminCrm />} />
          <Route path="finance" element={<AdminFinance />} />
          <Route path="team" element={<AdminTeam />} />
          <Route path="specialists" element={<AdminSpecialists />} />
          <Route path="access-rights" element={<AdminAccessRights />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </>
  );
}

export default App;
