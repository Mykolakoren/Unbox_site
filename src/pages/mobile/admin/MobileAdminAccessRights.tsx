import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { MobilePageHeader } from '../../../components/ui/PageHeader';
import { SkeletonList } from '../../../components/ui/Skeleton';
import { EmptyState } from '../../../components/ui/EmptyState';
import { Sheet } from '../../../components/ui/Sheet';
import { ListGroup, ListRow, ListAvatar } from '../../../components/ui/ListRow';
import { PermissionsEditor } from '../../../components/admin/PermissionsEditor';
import { useUserStore } from '../../../store/userStore';
import type { User } from '../../../store/types';
import { userCanAccessRights } from '../../../utils/permissions';
import { ruCountWord } from '../../../utils/plural';

/**
 * «Права доступа» на телефоне (G8-21, G8-admin-ops-M4). Вход — из меню
 * «Админка ▾» для владельца и старшего админа.
 *
 * Волна 4 (доработка): по прямой ссылке без роли owner / senior_admin —
 * обратно в «Сегодня» (та же userCanAccessRights, что прячет пункт меню).
 *
 * 09.11 фаза 3 (admin-design №21): раньше здесь была компьютерная таблица
 * (<AdminAccessRights embedded />: радиус 0, заголовки колонок «ИМЯ / РОЛЬ»
 * капсом, рамка у каждой ячейки, ширина 560 px с прокруткой вбок). Теперь —
 * строки, как в «Команде»: инициалы, имя 16/600, почта 14 ink-60, справа роль
 * и «›»; одна группа с радиусом 16; поиск — поле sunken с подсказкой внутри.
 * Кто попадает в список и что сохраняется — то же, что на компьютере:
 * сотрудники (owner / senior_admin / admin) и все, кому выданы права сверх
 * роли; поиск от двух букв показывает «Другие пользователи»; окно «Что может
 * делать» — тот же PermissionsEditor (его проверки и сохранение не менялись).
 */
const RIGHTS_HINT = 'Кто из команды что может делать в админке. Права роли выдаются сами, здесь — то, что добавлено сверх роли.';

const STAFF_ROLES = ['owner', 'senior_admin', 'admin'];
const ROLE_ORDER: Record<string, number> = { owner: 0, senior_admin: 1, admin: 2, specialist: 3 };
const RIGHTS: [string, string, string] = ['право', 'права', 'прав'];

function roleLabel(role?: string) {
    switch (role) {
        case 'owner':        return 'Владелец';
        case 'senior_admin': return 'Старший админ';
        case 'admin':        return 'Администратор';
        case 'specialist':   return 'Специалист';
        default:             return 'Клиент';
    }
}

export function MobileAdminAccessRights() {
    const currentUser = useUserStore(s => s.currentUser);
    if (!currentUser) return null;
    if (!userCanAccessRights(currentUser)) return <Navigate to="/m/admin/dashboard" replace />;
    return <RightsScreen />;
}

function RightsScreen() {
    const users = useUserStore(s => s.users);
    const fetchUsers = useUserStore(s => s.fetchUsers);
    const currentUser = useUserStore(s => s.currentUser);
    const [search, setSearch] = useState('');
    const [selectedUser, setSelectedUser] = useState<User | null>(null);
    const [loaded, setLoaded] = useState(users.length > 0);

    useEffect(() => {
        Promise.resolve(fetchUsers()).finally(() => setLoaded(true));
    }, [fetchUsers]);

    // После сохранения список перечитывается — окно показывает свежие права.
    useEffect(() => {
        if (selectedUser) {
            const updated = users.find(u => u.id === selectedUser.id);
            if (updated) setSelectedUser(updated);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [users]);

    const q = search.trim().toLowerCase();
    const matches = (u: User) => !q
        || (u.name || '').toLowerCase().includes(q)
        || (u.email || '').toLowerCase().includes(q);
    const isStaff = (u: User) => STAFF_ROLES.includes(u.role ?? '') || (u.permissions?.length ?? 0) > 0;

    const staff = useMemo(() =>
        users.filter(isStaff).sort((a, b) =>
            (ROLE_ORDER[a.role ?? ''] ?? 9) - (ROLE_ORDER[b.role ?? ''] ?? 9)
            || (a.name || '').localeCompare(b.name || '', 'ru')),
        [users],
    );
    const staffShown = staff.filter(matches);
    const others = q.length >= 2 ? users.filter(u => !isStaff(u) && matches(u)).slice(0, 10) : [];

    return (
        <div style={{ paddingBottom: 24 }}>
            <MobilePageHeader
                title="Права доступа"
                subtitle={loaded ? `В команде ${staff.length}` : undefined}
                fallbackTo="/m/admin/dashboard"
            />
            <div style={{ padding: '0 16px', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
                <p style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--color-ink-60)', margin: 0 }}>{RIGHTS_HINT}</p>

                <div style={{
                    display: 'flex', alignItems: 'center', gap: 8, minHeight: 44,
                    background: 'var(--color-sunken)', borderRadius: 8, padding: '0 12px',
                }}>
                    <Search size={16} aria-hidden="true" style={{ color: 'var(--color-ink-60)', flexShrink: 0 }} />
                    <input
                        type="search"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        aria-label="Найти сотрудника или пользователя"
                        placeholder="Найти сотрудника: имя или почта"
                        style={{
                            flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none',
                            fontSize: 16, fontFamily: 'inherit', color: 'var(--color-ink)',
                        }}
                    />
                </div>

                {!loaded && users.length === 0 ? (
                    <SkeletonList count={4} label="Загружаем сотрудников" cardHeight={56} />
                ) : (
                    <>
                        <UserList
                            title="Команда"
                            rows={staffShown}
                            onOpen={setSelectedUser}
                            empty={q ? 'Среди сотрудников никого с таким именем' : 'Сотрудников пока нет'}
                        />
                        {q.length >= 2 && (
                            <UserList title="Другие пользователи" rows={others} onOpen={setSelectedUser} empty="Никого не нашли" />
                        )}
                        {q.length > 0 && q.length < 2 && (
                            <p style={{ margin: 0, fontSize: 14, color: 'var(--color-ink-60)' }}>
                                Чтобы найти среди всех пользователей, введите хотя бы две буквы.
                            </p>
                        )}
                    </>
                )}
            </div>

            <Sheet
                open={!!selectedUser}
                onClose={() => setSelectedUser(null)}
                title={selectedUser ? `Что может делать: ${selectedUser.name}` : 'Что может делать'}
                description={selectedUser ? `${roleLabel(selectedUser.role)} · ${selectedUser.email}` : undefined}
            >
                {selectedUser && (
                    <PermissionsEditor
                        user={selectedUser}
                        currentUserRole={currentUser?.role ?? ''}
                        onUpdate={(updated) => {
                            setSelectedUser(updated as User);
                            fetchUsers();
                        }}
                    />
                )}
            </Sheet>
        </div>
    );
}

function UserList({ title, rows, onOpen, empty }: {
    title: string;
    rows: User[];
    onOpen: (u: User) => void;
    empty: string;
}) {
    if (rows.length === 0) {
        return (
            <section aria-label={title}>
                <h2 className="ui-list-group__title" style={{ padding: '0 4px', marginBottom: 8 }}>{title}</h2>
                <EmptyState compact title={empty} />
            </section>
        );
    }
    return (
        <ListGroup title={title}>
            {rows.map(u => {
                const extra = u.permissions?.length ?? 0;
                return (
                    <ListRow
                        key={u.id}
                        lead={<ListAvatar name={u.name || u.email || '?'} />}
                        title={u.name || u.email}
                        // Роль — первой строкой подписи (справа она съедала ширину и рвала почту
                        // на 360 px), почта — одной строкой с многоточием.
                        subtitle={<>
                            <span style={{ display: 'block', color: 'var(--color-ink-80)' }}>
                                {roleLabel(u.role)}
                                {extra > 0 && <span className="num-inline"> · сверх роли {ruCountWord(extra, RIGHTS)}</span>}
                            </span>
                            <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</span>
                        </>}
                        onClick={() => onOpen(u)}
                        aria-label={`${u.name || u.email}, ${roleLabel(u.role)} — что может делать`}
                    />
                );
            })}
        </ListGroup>
    );
}
