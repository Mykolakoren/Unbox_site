import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Summary } from './components/Summary';
// Wizard Steps
import { LocationStep } from './components/Wizard/LocationStep';
import { FormatDateStep } from './components/Wizard/FormatDateStep';
import { TimelineStep } from './components/Wizard/TimelineStep';
import { OptionsStep } from './components/Wizard/OptionsStep';
import { ConfirmationStep } from './components/Wizard/ConfirmationStep';
// Store
import { useBookingStore } from './store/bookingStore';

// New Pages
import { LoginPage } from './pages/LoginPage';
import { DashboardLayout } from './components/DashboardLayout';
import { MyBookingsPage } from './pages/MyBookingsPage';
import { ProfilePage } from './pages/ProfilePage';

// Booking Flow Wrapper
function BookingWizard() {
  const step = useBookingStore(s => s.step);

  return (
    <Layout>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 max-w-6xl mx-auto">
        <div className="lg:col-span-8">
          {step === 1 && <LocationStep />}
          {step === 2 && <FormatDateStep />}
          {step === 3 && <TimelineStep />}
          {step === 4 && <OptionsStep />}
          {step === 5 && <ConfirmationStep />}
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

function App() {
  return (
    <Routes>
      {/* Main Booking Flow */}
      <Route path="/" element={<BookingWizard />} />

      {/* Auth */}
      <Route path="/login" element={<LoginPage />} />

      {/* Dashboard */}
      <Route path="/dashboard" element={<DashboardLayout />}>
        <Route index element={<div className="p-8 text-gray-500">Добро пожаловать в личный кабинет! Выберите раздел меню слева.</div>} />
        <Route path="bookings" element={<MyBookingsPage />} />
        <Route path="profile" element={<ProfilePage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
