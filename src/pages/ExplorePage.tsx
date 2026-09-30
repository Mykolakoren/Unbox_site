import { useState, useEffect, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUserStore } from '../store/userStore';
import { Button } from '../components/ui/Button';
import { COLOR, Z } from '../design/tokens';
import { canBookCabinets } from '../utils/permissions';

// G1-25 / X5-10: лендинг — отдельным чанком. ExplorePage подключён в App.tsx
// сразу (маршрут «/»), и весь лендинг попадал в общий entry, который качают
// и в /m. Пока чанк едет — пустая бумага (заглушку «Unbox» уже показал index.html).
const GridHouseLanding = lazy(() => import('../components/landing/GridHouseLanding').then(m => ({ default: m.GridHouseLanding })));

// Волна 2 (G1-25, X5-10): здесь больше нет карты. Раньше страница
// импортировала leaflet + react-leaflet + leaflet.css и 12 секций старого
// лендинга, которые не рендерились, — ~85 КБ сжатого кода в каждой
// загрузке «/» (и в /m, потому что ExplorePage грузится сразу).

type VisitorMode = 'client' | 'specialist' | null;

function readVisitorMode(): VisitorMode {
    try {
        const v = localStorage.getItem('unbox_visitor_mode');
        return v === 'client' || v === 'specialist' ? v : null;
    } catch {
        return null; // приватный режим
    }
}

function writeVisitorMode(mode: VisitorMode) {
    try {
        if (mode) localStorage.setItem('unbox_visitor_mode', mode);
        else localStorage.removeItem('unbox_visitor_mode');
    } catch { /* приватный режим — режим живёт до перезагрузки */ }
}

export function ExplorePage() {
    const currentUser = useUserStore(s => s.currentUser);

    // ── Visitor mode ──────────────────────────────────────────────
    const [storedMode, setStoredMode] = useState<VisitorMode>(readVisitorMode);

    // X2-12: вошедшему экран выбора не нужен — режим по роли.
    // Специалист и администраторы — «специалист», остальные — «клиент».
    const roleMode: VisitorMode = currentUser
        ? (canBookCabinets(currentUser) ? 'specialist' : 'client')
        : null;
    const visitorMode = storedMode ?? roleMode;

    const handleModeSelect = (mode: 'client' | 'specialist') => {
        writeVisitorMode(mode);
        setStoredMode(mode);
    };

    // Гость возвращается к экрану выбора; вошедшему выбор не показываем —
    // переключаем режим на другой.
    const resetMode = () => {
        const next: VisitorMode = currentUser ? (visitorMode === 'client' ? 'specialist' : 'client') : null;
        writeVisitorMode(next);
        setStoredMode(next);
    };

    return (
        <>
            <Suspense fallback={<div style={{ minHeight: '100vh', background: COLOR.paper }} />}>
                <GridHouseLanding
                    visitorMode={visitorMode}
                    onModeSelect={handleModeSelect}
                    onModeReset={resetMode}
                />
            </Suspense>
            <MobileSpecialistFab visitorMode={visitorMode} />
        </>
    );
}

// ── Плавающая кнопка на телефоне — только в режиме «специалист» ─────────────
// G1-05: в режиме «клиент» кнопка «+ Забронировать» уводила человека,
// который ищет психолога, в аренду кабинетов (/m/find), а гостя — ещё и на
// вход. Теперь: клиенту кнопки нет; специалисту-гостю — «Подать заявку»,
// вошедшему без одобренной анкеты — «Заполнить анкету», одобренному —
// «Арендовать кабинет». Цвета и форма — общая кнопка дизайн-системы.
function MobileSpecialistFab({ visitorMode }: { visitorMode: VisitorMode }) {
    const navigate = useNavigate();
    const currentUser = useUserStore(s => s.currentUser);
    const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
    useEffect(() => {
        const onResize = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);
    if (!isMobile || visitorMode !== 'specialist') return null;

    const action = !currentUser
        ? { label: 'Подать заявку', to: `/login?register=1&redirect=${encodeURIComponent('/become-specialist')}` }
        : canBookCabinets(currentUser)
            ? { label: 'Арендовать кабинет', to: '/m/find' }
            : { label: 'Заполнить анкету', to: '/become-specialist' };

    return (
        <div
            style={{
                position: 'fixed',
                right: 16,
                bottom: 'calc(16px + env(safe-area-inset-bottom))',
                zIndex: Z.sticky,
            }}
        >
            <Button variant="primary" size="touch" onClick={() => navigate(action.to)}>
                {action.label}
            </Button>
        </div>
    );
}
