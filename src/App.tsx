import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Summary } from './components/Summary';
// Wizard Steps
import { ContextStep } from './components/Wizard/ContextStep';
import { ChessboardStep } from './components/Wizard/ChessboardStep';
import { OptionsStep } from './components/Wizard/OptionsStep';
import { ConfirmationStep } from './components/Wizard/ConfirmationStep';
// Store
import { useBookingStore } from './store/bookingStore';

// New Pages
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

// Booking Flow Wrapper
function BookingWizard() {
  const { step, editBookingId, reset } = useBookingStore();

  return (
    <Layout>
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

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 max-w-6xl mx-auto">
        <div className="lg:col-span-8">
          {step === 1 && <ContextStep onNext={() => useBookingStore.getState().setStep(2)} />}
          {step === 2 && <ChessboardStep />}
          {step === 3 && <OptionsStep />}
          {step === 4 && <ConfirmationStep />}
        </div>

        {step < 5 && (
          <div className="lg:col-span-4 hidden lg:block">
            <Summary />
          </div>
        )}
      </div>
    </Layout>
  );
}

import { Toaster } from 'sonner';

function App() {
  return (
    <>
      <Toaster position="top-center" richColors closeButton />
      <Routes>
        {/* Main Booking Flow */}
        <Route path="/" element={<BookingWizard />} />

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
          <Route path="bookings" element={<AdminBookings />} />
          <Route path="waitlist" element={<AdminWaitlist />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

export default App;
