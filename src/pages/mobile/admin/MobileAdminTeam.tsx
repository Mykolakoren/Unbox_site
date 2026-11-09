import { useEffect, useMemo, useState } from 'react';
import { Power, Users as UsersIcon } from 'lucide-react';
import { toast } from 'sonner';
import { teamApi, type TeamMember } from '../../../api/team';
import { Button } from '../../../components/ui/Button';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorBar } from '../../../components/ui/ErrorBar';
import { SkeletonList } from '../../../components/ui/Skeleton';
import { DesktopLink } from './DesktopLink';
import { MobilePageHeader } from '../../../components/ui/PageHeader';
import { useConfirmDialog } from '../../../components/ui/ConfirmDialogProvider';
import { useUserStore } from '../../../store/userStore';
import { ListGroup, ListRow, ListAvatar } from '../../../components/ui/ListRow';

const ROLE_LABEL: Record<string, string> = {
    founder: 'Основатель',
    senior_admin: 'Старший администратор',
    admin: 'Администратор',
    other: 'Другое',
};

/**
 * Mobile admin: Команда — read-only list of staff with quick "active toggle".
 * Editing fields (name/role/photo) intentionally lives only on desktop; the
 * mobile screen is for at-a-glance lookups + temporarily disabling a member
 * (e.g. when someone is on leave).
 *
 * Wave 1: роль — нейтральной плашкой (раньше зелёная/синяя для красоты),
 * кнопка называет действие («Скрыть» / «Показать» — с сайта, ревью 09.11),
 * а не состояние; выключенный сотрудник помечен словом «Выключен ·».
 */
export function MobileAdminTeam() {
    const [members, setMembers] = useState<TeamMember[]>([]);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);
    const { confirm } = useConfirmDialog();
    // Себе кнопку не показываем (ревью 09.11, №24). Карточка команды с аккаунтом
    // не связана — узнаём себя по имени.
    const myName = (useUserStore(s => s.currentUser)?.name || '').trim().toLowerCase();

    const load = async () => {
        setLoading(true);
        try {
            const data = await teamApi.getAllAdmin();
            setMembers(data);
            setFailed(false);
        } catch {
            setFailed(true);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const sorted = useMemo(() => {
        const roleOrder = ['founder', 'senior_admin', 'admin', 'other'];
        return [...members].sort((a, b) => {
            if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
            const ai = roleOrder.indexOf(a.roleType);
            const bi = roleOrder.indexOf(b.roleType);
            if (ai !== bi) return ai - bi;
            return (a.sortOrder ?? 99) - (b.sortOrder ?? 99);
        });
    }, [members]);

    const handleToggle = async (m: TeamMember) => {
        // Волна 4 (G9-09): скрытие — с вопросом, показ — сразу. is_active на сервере
        // (team.py) значит только «показывать на странице «Команда» на сайте» —
        // доступ в админку он не трогает (ревью 09.11, №24: «Выключить» было непонятно).
        if (m.isActive) {
            const ok = await confirm({
                title: `Скрыть «${m.name}» с сайта?`,
                body: 'Карточка пропадёт со страницы «Команда» на сайте. Доступ в админку не меняется. Показать обратно можно в любой момент.',
                confirmLabel: 'Скрыть с сайта',
                cancelLabel: 'Оставить',
                tone: 'danger',
            });
            if (!ok) return;
        }
        setBusyId(m.id);
        try {
            await teamApi.update(m.id, { is_active: !m.isActive });
            await load();
            toast.success(m.isActive ? `${m.name}: скрыт с сайта` : `${m.name}: снова на сайте`);
        } catch {
            toast.error('Не удалось обновить. Попробуйте ещё раз');
        } finally {
            setBusyId(null);
        }
    };

    // 09.11 фаза 3: шапка во всю ширину, число — в подзаголовке (без повторной
    // подписи «КОМАНДА · 4»); строки — ListRow, действие — тихая кнопка sm.
    const visible = members.filter(m => m.isActive).length;
    return (
        <div style={{ paddingBottom: 90 }}>
            <MobilePageHeader
                title="Команда"
                subtitle={loading ? undefined : `${members.length} ${plural(members.length, 'сотрудник', 'сотрудника', 'сотрудников')} · на сайте ${visible}`}
                fallbackTo="/m/admin/dashboard"
            />
            <div style={{ padding: '16px 16px 0' }}>

            {failed && !loading && (
                <ErrorBar message="Не удалось загрузить команду" onRetry={load} className="mb-3" />
            )}
            {loading ? (
                <SkeletonList count={4} label="Загружаем команду" cardHeight={64} />
            ) : failed ? null : sorted.length === 0 ? (
                <EmptyState compact title="В команде пока никого" hint="Добавить сотрудника можно на компьютере." />
            ) : (
                <ListGroup aria-label="Команда">
                    {sorted.map(m => {
                        const roleLabel = ROLE_LABEL[m.roleType] || 'Другое';
                        // «Основатель» в роли и «Основатель» в подписи — не повторяем.
                        const showRole = !!m.role && m.role.trim().toLowerCase() !== roleLabel.toLowerCase();
                        const isMe = !!myName && m.name.trim().toLowerCase() === myName;
                        return (
                            <ListRow
                                key={m.id}
                                lead={<ListAvatar name={m.name} src={m.photoUrl} />}
                                title={m.name}
                                // Роль — текстом 14 ink-60 с переносом (раньше серая плашка
                                // резала «Старший администр…»).
                                subtitle={<>
                                    {roleLabel}{showRole ? ` · ${m.role}` : ''}{isMe ? ' · это вы' : ''}
                                </>}
                                // Состояние: скрытый — бледнее и с плашкой (ревью 09.11, №24).
                                meta={m.isActive ? undefined : <span className="ui-badge ui-badge--muted">скрыт с сайта</span>}
                                dimmed={!m.isActive}
                                action={!isMe && (
                                    <Button
                                        variant="quiet"
                                        size="sm"
                                        loading={busyId === m.id}
                                        icon={<Power size={16} aria-hidden="true" />}
                                        onClick={() => handleToggle(m)}
                                        aria-label={`${m.isActive ? 'Скрыть с сайта' : 'Показать на сайте'}: ${m.name}`}
                                    >
                                        {m.isActive ? 'Скрыть' : 'Показать'}
                                    </Button>
                                )}
                            />
                        );
                    })}
                </ListGroup>
            )}

            <div style={{
                marginTop: 16,
                padding: 12,
                background: 'var(--color-sunken)',
                borderRadius: 16,
                fontSize: 14,
                color: 'var(--color-ink-80)',
                lineHeight: 1.5,
                display: 'flex',
                gap: 8,
                alignItems: 'flex-start',
            }}>
                <UsersIcon size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2, color: 'var(--color-ink-60)' }} />
                <span>
                    Фото, описание, роль и новых сотрудников удобнее менять в полной версии.
                    <br />
                    <DesktopLink href="/admin/team">Открыть полную версию →</DesktopLink>
                </span>
            </div>
            </div>
        </div>
    );
}

/** 1 сотрудник, 2 сотрудника, 5 сотрудников. */
function plural(n: number, one: string, few: string, many: string): string {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
}
