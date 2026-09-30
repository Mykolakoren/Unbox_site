import { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { MinimalLayout } from '../MinimalLayout';
import { Summary } from '../Summary';
// Wizard Steps
import { ChessboardStep } from './ChessboardStep';
import { ConfirmationStep } from './ConfirmationStep';
// Store
import { useBookingStore } from '../../store/bookingStore';
import { useUserStore } from '../../store/userStore';
import { canBookCabinets } from '../../utils/permissions';
import { useSpecialistApplicationStatus } from '../../hooks/useSpecialistApplication';
import { SpecialistGateCard } from '../SpecialistGate';
import { GH, GH_SANS } from '../../hooks/useDesignFlag';

/**
 * Мастер брони на компьютере (/checkout). Вынесен из App.tsx как есть
 * (волна 2, шаг 0) — логика не менялась, дальше файл принадлежит пакету D.
 */
// Booking Flow Wrapper
export function BookingWizard() {
  const { step, editBookingId, bookingForUser, setBookingForUser, reset } = useBookingStore();
  const wizardMode = useBookingStore(s => s.mode);
  const selectedSlots = useBookingStore(s => s.selectedSlots);
  const users = useUserStore(s => s.users);
  // Вошедший, но ещё не специалист (роль user): сервер откажет в брони на
  // «Оплатить». Говорим об этом сразу, до выбора времени и оплаты.
  // Перенос/правка своей брони (editBookingId) — не новая бронь, её не трогаем.
  const currentUser = useUserStore(s => s.currentUser);
  const needsApplication = !!currentUser && !canBookCabinets(currentUser) && !editBookingId;
  const applicationStatus = useSpecialistApplicationStatus(currentUser, needsApplication);

  // Excel #73 — warn before leaving an in-progress booking.
  // Browser-native confirm via beforeunload covers: tab close, page reload,
  // external navigation (typing a new URL). For internal React Router
  // navigation we rely on the fact that most exit points in the wizard are
  // explicit buttons — they reset the store themselves. Having the full
  // useBlocker solution would need upgrading to a data router; beforeunload
  // already catches the real "oh no I closed the tab" case.
  useEffect(() => {
    const hasUnsavedWork = selectedSlots.length > 0 && step >= 2 && !editBookingId && !needsApplication;
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
  }, [selectedSlots.length, step, editBookingId, needsApplication]);

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

  if (needsApplication) {
    return (
      <MinimalLayout glassMode noPadding>
        <div className="max-w-3xl mx-auto px-4 md:px-8 py-8">
          <SpecialistGateCard variant="desktop" status={applicationStatus} />
        </div>
      </MinimalLayout>
    );
  }

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
