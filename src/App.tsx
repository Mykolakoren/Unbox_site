import { Routes, Route, Navigate } from 'react-router-dom';
import { MinimalLayout } from './components/MinimalLayout';
import { Summary } from './components/Summary';
// Wizard Steps
import { ChessboardStep } from './components/Wizard/ChessboardStep';
import { OptionsStep } from './components/Wizard/OptionsStep';
import { ConfirmationStep } from './components/Wizard/ConfirmationStep';
// Store
import { useBookingStore } from './store/bookingStore';

// New Pages
import { ExplorePage } from './pages/ExplorePage';
import { SpecialistsPage } from './pages/SpecialistsPage';
import { SpecialistProfilePage } from './pages/SpecialistProfilePage';
import { LocationDetailsPage } from './pages/LocationDetailsPage';
import { LoginPage } from './pages/LoginPage';
import { DashboardLayout } from './components/DashboardLayout';
import { MyBookingsPage } from './pages/MyBookingsPage';
import { ProfilePage } from './pages/ProfilePage';
import { DashboardOverview } from './pages/DashboardOverview';
import { AdminLayout } from './pages/admin/AdminLayout';
import { AdminUsers } from './pages/admin/Users';
import { AdminBookings } from './pages/admin/Bookings';
import { AdminDashboard } from './pages/admin/Dashboard';
import { AdminWaitlist } from './pages/admin/Waitlist';
import { AdminUserDetails } from './pages/admin/UserDetails';
import { AdminCabinets } from './pages/admin/Cabinets';
import { AdminKnowledgeBase } from './pages/admin/KnowledgeBase';
import { AdminTasksBoard } from './pages/admin/TasksBoard';

// CRM Pages (Specialist Personal Cabinet)
import { CrmLayout } from './pages/crm/CrmLayout';
import { CrmDashboard } from './pages/crm/CrmDashboard';
import { CrmClients } from './pages/crm/CrmClients';
import { CrmClientDetail } from './pages/crm/CrmClientDetail';
import { CrmSessions } from './pages/crm/CrmSessions';
import { CrmFinances } from './pages/crm/CrmFinances';
import { CrmNotes } from './pages/crm/CrmNotes';

// Admin CRM
import { AdminCrm } from './pages/admin/AdminCrm';
import { AdminAccessRights } from './pages/admin/AccessRights';
import { AdminFinance } from './pages/admin/Finance';
import { AdminTeam } from './pages/admin/AdminTeam';
import { AdminSpecialists } from './pages/admin/AdminSpecialists';
import { TestPage } from './pages/TestPage';

// ── Glass panel style for wizard steps (mirrors ExplorePage) ───────────────
const glassPanel: React.CSSProperties = {
  background: 'rgba(255,255,255,0.14)',
  backdropFilter: 'blur(36px) saturate(160%)',
  WebkitBackdropFilter: 'blur(36px) saturate(160%)',
  border: '1px solid rgba(255,255,255,0.28)',
  boxShadow: '0 20px 60px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.45)',
};
const glassSummary: React.CSSProperties = {
  background: 'rgba(255,255,255,0.22)',
  backdropFilter: 'blur(24px) saturate(150%)',
  WebkitBackdropFilter: 'blur(24px) saturate(150%)',
  border: '1px solid rgba(255,255,255,0.35)',
  boxShadow: '0 8px 32px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.50)',
};
// ────────────────────────────────────────────────────────────────────────────

// Booking Flow Wrapper
function BookingWizard() {
  const { step, editBookingId, reset } = useBookingStore();

  return (
    <MinimalLayout glassMode fullWidth={step === 2} noPadding>

      {/* Edit mode banner */}
      {editBookingId && (
        <div className={`${step === 2 ? 'max-w-[1920px] px-8' : 'max-w-6xl px-4'} mx-auto mb-4`}>
          <div className="bg-amber-50/90 backdrop-blur-sm border border-amber-200 text-amber-800 px-4 py-3 rounded-xl flex items-center justify-between">
            <span className="font-medium">✏️ Вы редактируете существующее бронирование</span>
            <button onClick={() => reset()} className="text-sm font-bold underline hover:no-underline">
              Отменить редактирование
            </button>
          </div>
        </div>
      )}

      {step === 2 ? (
        /* ── Step 2: Full-width chessboard in one big glass panel ── */
        <div className="max-w-[1920px] mx-auto px-6 md:px-12">
          <div className="rounded-[28px] overflow-hidden" style={glassPanel}>
            <ChessboardStep />
          </div>
        </div>
      ) : (
        /* ── Steps 3 & 4: two-column glass layout ── */
        <div className="max-w-6xl mx-auto px-4 md:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-8">
              {step === 1 && <Navigate to="/" replace />}
              {step === 3 && (
                <div className="rounded-[28px] overflow-hidden p-8" style={glassPanel}>
                  <OptionsStep />
                </div>
              )}
              {step === 4 && (
                <div className="rounded-[28px] overflow-hidden p-8" style={glassPanel}>
                  <ConfirmationStep />
                </div>
              )}
            </div>
            {step < 5 && (
              <div className="lg:col-span-4 hidden lg:block">
                <div className="rounded-[28px] overflow-hidden sticky top-[148px]" style={glassSummary}>
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

import { useEffect } from 'react';
import { useUserStore } from './store/userStore';
import { Toaster } from 'sonner';

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

  return (
    <>
      <Toaster position="top-center" richColors closeButton />
      <Routes>
        {/* Public Booking Flow */}
        <Route path="/" element={<ExplorePage />} />
        <Route path="/explore" element={<Navigate to="/" replace />} />
        <Route path="/location/:locationId" element={<LocationDetailsPage />} />

        {/* Specialists Marketplace */}
        <Route path="/specialists" element={<SpecialistsPage />} />
        <Route path="/specialists/:id" element={<SpecialistProfilePage />} />

        {/* Self-assessment tests */}
        <Route path="/tests/:testId" element={<TestPage />} />

        {/* Legacy Checkout Wizard Route (for backward compat / direct checkout) */}
        <Route path="/checkout" element={<BookingWizard />} />

        {/* Auth */}
        <Route path="/login" element={<LoginPage />} />

        {/* Dashboard */}
        <Route path="/dashboard" element={<DashboardLayout />}>
          <Route index element={<DashboardOverview />} />
          <Route path="bookings" element={<MyBookingsPage />} />
          <Route path="profile" element={<ProfilePage />} />
        </Route>

        {/* CRM — Specialist Personal Cabinet */}
        <Route path="/crm" element={<CrmLayout />}>
          <Route index element={<CrmDashboard />} />
          <Route path="clients" element={<CrmClients />} />
          <Route path="clients/:clientId" element={<CrmClientDetail />} />
          <Route path="sessions" element={<CrmSessions />} />
          <Route path="finances" element={<CrmFinances />} />
          <Route path="notes" element={<CrmNotes />} />
        </Route>

        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<AdminDashboard />} /> {/* Dashboard Home */}
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
    </>
  );
}

export default App;
