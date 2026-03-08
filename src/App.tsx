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

// Booking Flow Wrapper
function BookingWizard() {
  const { step, editBookingId, reset } = useBookingStore();

  return (
    <MinimalLayout>
      <div className="max-w-6xl mx-auto mb-8">
        {editBookingId && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-xl flex items-center justify-between animate-in fade-in slide-in-from-top-4">
            <span className="font-medium">✏️ Вы редактируете существующее бронирование</span>
            <button
              onClick={() => reset()}
              className="text-sm font-bold underline hover:no-underline"
            >
              Отменить редактирование
            </button>
          </div>
        )}
      </div>

      <div className={`grid grid-cols-1 lg:grid-cols-12 gap-8 max-w-7xl mx-auto px-4 transition-all duration-300`}>
        <div className={`
          transition-all duration-300
          ${step === 2 ? 'lg:col-span-12' : 'lg:col-span-8'}
        `}>
          {step === 1 && <Navigate to="/" replace />}
          {step === 2 && <ChessboardStep />}
          {step === 3 && <OptionsStep />}
          {step === 4 && <ConfirmationStep />}
        </div>

        {/* Sidebar Summary - Hidden on Step 2 (Chessboard) to give full width */}
        {step !== 2 && step < 5 && (
          <div className="lg:col-span-4 hidden lg:block sticky top-8 h-fit">
            <Summary />
          </div>
        )}
      </div>
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

        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<AdminDashboard />} /> {/* Dashboard Home */}
          <Route path="users" element={<AdminUsers />} />
          <Route path="users/:email" element={<AdminUserDetails />} />
          <Route path="cabinets" element={<AdminCabinets />} />
          <Route path="bookings" element={<AdminBookings />} />
          <Route path="waitlist" element={<AdminWaitlist />} />
          <Route path="knowledge-base" element={<AdminKnowledgeBase />} />
          <Route path="tasks" element={<AdminTasksBoard />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

export default App;
