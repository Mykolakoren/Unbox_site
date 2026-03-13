import { Outlet, useNavigate } from 'react-router-dom';
import { useUserStore } from '../../store/userStore';
import { useCrmStore } from '../../store/crmStore';
import { SidebarLayout } from '../../components/SidebarLayout';
import {
    LayoutDashboard,
    Users,
    Calendar,
    Wallet,
    StickyNote,
    Settings,
    ShieldCheck,
    ArrowLeft,
    Eye,
} from 'lucide-react';
import { useEffect } from 'react';

export function CrmLayout() {
    const { currentUser } = useUserStore();
    const navigate = useNavigate();
    const {
        viewAsSpecialistId,
        specialists,
        setViewAsSpecialist,
        fetchSpecialists,
    } = useCrmStore();

    const isAdmin =
        currentUser?.role === 'admin' ||
        currentUser?.role === 'senior_admin' ||
        currentUser?.role === 'owner';

    useEffect(() => {
        if (!currentUser) {
            navigate('/login');
            return;
        }
        if (isAdmin) {
            fetchSpecialists();
        }
    }, [currentUser, navigate, isAdmin, fetchSpecialists]);

    if (!currentUser) return null;

    const handleSpecialistChange = (id: string | null) => {
        setViewAsSpecialist(id);
        // Navigate to CRM root so pages re-mount and re-fetch with new specialist
        navigate('/crm');
    };

    const navItems = [
        { icon: LayoutDashboard, label: 'Дашборд', path: '/crm' },
        { icon: Users, label: 'Клиенты', path: '/crm/clients' },
        { icon: Calendar, label: 'Сессии', path: '/crm/sessions' },
        { icon: Wallet, label: 'Финансы', path: '/crm/finances' },
        { icon: StickyNote, label: 'Заметки', path: '/crm/notes' },
        { icon: Settings, label: 'Настройки', path: '/dashboard/profile' },
        ...(isAdmin
            ? [{ icon: ShieldCheck, label: 'Админ-панель', path: '/admin' }]
            : []),
    ];

    // Active specialist name for display
    const activeSpecialist = specialists.find(s => s.id === viewAsSpecialistId);

    const customBottomContent = (
        <>
            {/* Specialist selector — admin only */}
            {isAdmin && (
                <div className="mb-3">
                    <div className="flex items-center gap-1.5 text-[10px] uppercase text-unbox-grey font-semibold px-1 mb-1.5 tracking-wide">
                        <Eye size={11} />
                        Просмотр CRM
                    </div>
                    <select
                        value={viewAsSpecialistId ?? ''}
                        onChange={(e) => handleSpecialistChange(e.target.value || null)}
                        className="w-full text-sm px-3 py-2 rounded-xl border border-unbox-light bg-white/70 text-unbox-dark focus:outline-none focus:ring-2 focus:ring-unbox-green cursor-pointer"
                    >
                        <option value="">— Свой CRM</option>
                        {specialists.map(s => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                    </select>

                    {/* Active view indicator */}
                    {viewAsSpecialistId && activeSpecialist && (
                        <div className="mt-1.5 px-2 py-1 bg-amber-50 border border-amber-200 rounded-lg text-[11px] text-amber-700 flex items-center justify-between gap-1">
                            <span className="flex items-center gap-1">
                                <ShieldCheck size={11} />
                                {activeSpecialist.name}
                            </span>
                            <button
                                onClick={() => handleSpecialistChange(null)}
                                className="underline hover:text-amber-900 text-[10px]"
                            >
                                сбросить
                            </button>
                        </div>
                    )}
                </div>
            )}

            <button
                onClick={() => navigate('/dashboard')}
                className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-700 transition-colors w-full px-3 py-2"
            >
                <ArrowLeft size={16} />
                К бронированиям
            </button>
        </>
    );

    return (
        <SidebarLayout
            navItems={navItems}
            customBottomContent={customBottomContent}
        >
            <Outlet />
        </SidebarLayout>
    );
}
