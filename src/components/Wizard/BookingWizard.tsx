import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MinimalLayout } from '../MinimalLayout';
import { Summary } from '../Summary';
// Wizard Steps
import { ChessboardStep } from './ChessboardStep';
import { ConfirmationStep } from './ConfirmationStep';
// Store
import { useBookingStore } from '../../store/bookingStore';
import { useUserStore } from '../../store/userStore';
import { canBookCabinets } from '../../utils/permissions';
import { getMyBookingsPath } from '../../utils/userPaths';
import { useSpecialistApplicationStatus } from '../../hooks/useSpecialistApplication';
import { SpecialistGateCard } from '../SpecialistGate';
import { GH, GH_SANS } from '../../hooks/useDesignFlag';
import { STATUS } from '../../design/tokens';

/**
 * Мастер брони на компьютере (/checkout). Шаги: 2 — сетка времени,
 * 3/4 — подтверждение и оплата (4 — старый адрес того же шага).
 *
 * Волна 2, пакет D:
 *  - шага 1 больше нет: прямой /checkout открывает сетку, а не главную (G3-11, X2-15);
 *  - одна «Назад» на шаг — в шапке: с сетки туда, откуда пришли, с оплаты — на сетку;
 *  - шапка одной ширины на всех шагах — стрелка не прыгает (G3-22);
 *  - карточки Grid House: тонкая линия, без скруглений и «стекла».
 */
export function BookingWizard() {
  const { step, setStep, editBookingId, bookingForUser, setBookingForUser, reset } = useBookingStore();
  const setHighlightedResourceId = useBookingStore(s => s.setHighlightedResourceId);
  const wizardMode = useBookingStore(s => s.mode);
  const selectedSlots = useBookingStore(s => s.selectedSlots);
  const users = useUserStore(s => s.users);
  const navigate = useNavigate();
  // Вошедший, но ещё не специалист (роль user): сервер откажет в брони на
  // «Оплатить». Говорим об этом сразу, до выбора времени и оплаты.
  // Перенос/правка своей брони (editBookingId) — не новая бронь, её не трогаем.
  const currentUser = useUserStore(s => s.currentUser);
  const needsApplication = !!currentUser && !canBookCabinets(currentUser) && !editBookingId;
  const applicationStatus = useSpecialistApplicationStatus(currentUser, needsApplication);

  // Шаг 1 (выбор центра) давно убран. Раньше он был редиректом на главную —
  // прямая ссылка /checkout и «Назад» с сетки выкидывали на лендинг.
  // Теперь шаг 1 = сетка времени (без центра она показывает все центры).
  useEffect(() => {
    if (step < 2) setStep(2);
  }, [step, setStep]);
  const shownStep = step < 2 ? 2 : step;

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

  // «Назад» в шапке — одна на шаг. С оплаты — к сетке (выбор сохраняется).
  // С сетки — туда, откуда пришли (страница кабинета, «Мои брони»); если
  // истории нет (открыли по ссылке) — в свои брони, гостя — на главную.
  const handleBack = () => {
    if (shownStep >= 3) { setStep(2); return; }
    setHighlightedResourceId(null);
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate(currentUser ? getMyBookingsPath(currentUser) : '/', { replace: true });
  };

  // Resolve friendly name for the "booking-for" admin-proxy banner
  const proxyUser = bookingForUser
    ? users.find(u => u.email === bookingForUser || u.id === bookingForUser)
    : null;

  /* Grid House: тонкая линия, без скругления и тени */
  const ghCard: React.CSSProperties = {
    background: GH.card,
    border: `1px solid ${GH.ink10}`,
    borderRadius: 0,
    overflow: 'hidden',
  };

  const bannerWrap = `${shownStep === 2 ? 'max-w-[1920px] px-6 md:px-12' : 'max-w-6xl px-4 md:px-8'} mx-auto mb-4`;
  const bannerLink: React.CSSProperties = {
    minHeight: 44, padding: '0 4px', fontSize: 14, fontWeight: 600, textDecoration: 'underline',
    background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontFamily: GH_SANS,
  };

  if (needsApplication) {
    return (
      <MinimalLayout glassMode fullWidth noPadding>
        <div className="max-w-3xl mx-auto px-4 md:px-8 py-8">
          <SpecialistGateCard variant="desktop" status={applicationStatus} />
        </div>
      </MinimalLayout>
    );
  }

  return (
    <MinimalLayout glassMode fullWidth noPadding onBack={handleBack}
      backLabel={shownStep >= 3 ? 'К выбору времени' : 'Назад'}>

      {/* The reschedule dup-creation bug was fixed & verified
          (CLAUDE.md → "Решённые баги": фикс 2026-05-23, проверка 2026-05-26 —
          0 дублей на 50 новых броней). The old red "может создать дубль"
          warning banner was removed so it stops eroding trust on every
          reschedule. The neutral edit banner below still covers reschedule via
          its `editBookingId` condition. */}
      {editBookingId && (
        <div className={bannerWrap}>
          <div style={{
            background: STATUS.pending.bg, border: `1px solid ${GH.ink10}`, color: STATUS.pending.fg,
            padding: '4px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
            fontFamily: GH_SANS, fontSize: 14, flexWrap: 'wrap',
          }}>
            <span style={{ fontWeight: 500 }}>
              {wizardMode === 'reschedule'
                ? 'Вы переносите существующую бронь'
                : 'Вы меняете существующую бронь'}
            </span>
            <button type="button" onClick={() => reset()} style={bannerLink}>
              {wizardMode === 'reschedule' ? 'Не переносить' : 'Не менять'}
            </button>
          </div>
        </div>
      )}

      {/* Admin-proxy booking banner — visible on every step so the admin
          can't forget whose booking they're creating. Click "Сбросить" to
          clear target and book for themselves. Без фиолетового и тени:
          цвет — только для статуса. */}
      {bookingForUser && (
        <div className={bannerWrap} style={{ position: 'sticky', top: 72, zIndex: 20 }}>
          <div style={{
            background: GH.card,
            border: `1px solid ${GH.ink10}`,
            borderLeft: `3px solid ${GH.ink}`,
            color: GH.ink,
            padding: '4px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            fontFamily: GH_SANS,
            fontSize: 14,
            flexWrap: 'wrap',
          }}>
            <span>
              <strong style={{ fontWeight: 600 }}>
                Бронь для клиента: {proxyUser?.name || bookingForUser}
              </strong>
              {proxyUser?.email && proxyUser.email !== proxyUser.name && (
                <span style={{ marginLeft: 8, color: GH.ink60 }}>
                  {proxyUser.email}
                </span>
              )}
            </span>
            <button type="button" onClick={() => setBookingForUser(null)} style={bannerLink}>
              Бронировать для себя
            </button>
          </div>
        </div>
      )}

      {shownStep === 2 ? (
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
              {/* Owner 2026-05-27: merged Options step into Confirmation —
                  Format is already pickable on the chessboard, Extras are
                  only 4 items, the gap step felt redundant. Render
                  ConfirmationStep for both step==3 and step==4 so every
                  caller that still navigates to step:3 keeps working. */}
              {(shownStep === 3 || shownStep === 4) && (
                <div style={{ ...ghCard, padding: 32 }}>
                  <ConfirmationStep />
                </div>
              )}
            </div>
            {shownStep < 5 && (
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
