import { useEffect, useState, useMemo } from 'react';
import { ChevronRight } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { useUserStore } from '../../store/userStore';
import { userCanAccessRights } from '../../utils/permissions';
import { PermissionsEditor } from '../../components/admin/PermissionsEditor';
import type { User } from '../../store/types';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';
import { PageHeader } from '../../components/ui/PageHeader';
import { Sheet } from '../../components/ui/Sheet';
import { Field, Input } from '../../components/ui/Field';
import { SkeletonList } from '../../components/ui/Skeleton';
import { EmptyState } from '../../components/ui/EmptyState';
import { ruCountWord } from '../../utils/plural';

/**
 * Права доступа — волна 4, пакет D (G8-13).
 *
 * Раньше: пустой экран «Выберите пользователя.» и самодельный выпадающий
 * список по ВСЕЙ базе клиентов. Теперь по умолчанию — таблица сотрудников
 * (владелец, старшие админы, админы и все, кому выданы права сверх роли):
 * имя, роль, сколько прав выдано отдельно. Клик по строке — окно
 * «Что может делать». Поиск фильтрует таблицу; ниже — «другие
 * пользователи» из всей базы, если нужного нет среди сотрудников.
 *
 * Кто может открыть страницу и что сохраняется — не менялось:
 * PermissionsEditor (список прав и сохранение) тот же.
 */

const RIGHTS_HINT = 'Кто из команды что может делать в админке. Права роли выдаются сами, здесь — то, что добавлено сверх роли.';

const STAFF_ROLES = ['owner', 'senior_admin', 'admin'];
const ROLE_ORDER: Record<string, number> = { owner: 0, senior_admin: 1, admin: 2, specialist: 3 };

function roleLabel(role?: string) {
    switch (role) {
        case 'owner':        return 'Владелец';
        case 'senior_admin': return 'Старший админ';
        case 'admin':        return 'Администратор';
        case 'specialist':   return 'Специалист';
        default:             return 'Клиент';
    }
}

const RIGHTS: [string, string, string] = ['право', 'права', 'прав'];

/**
 * Волна 4 (доработка): страницу закрывает та же проверка, что прячет пункт
 * меню (userCanAccessRights — владелец и старший админ). Раньше по прямой
 * ссылке /admin/access-rights таблица открывалась любому админу (сохранить
 * права не дал бы сервер, но видеть их он не должен).
 *
 * embedded — страница внутри мобильной обёртки (MobileAdminAccessRights):
 * у той своя шапка с H1, второй заголовок не рисуем — только пояснение.
 */
export function AdminAccessRights({ embedded = false, deniedTo = '/admin' }: { embedded?: boolean; deniedTo?: string } = {}) {
    const currentUser = useUserStore(s => s.currentUser);
    if (!currentUser) return null;
    if (!userCanAccessRights(currentUser)) return <Navigate to={deniedTo} replace />;
    return <AccessRightsPage embedded={embedded} />;
}

function AccessRightsPage({ embedded }: { embedded: boolean }) {
    const users = useUserStore(s => s.users);
    const fetchUsers = useUserStore(s => s.fetchUsers);
    const currentUser = useUserStore(s => s.currentUser);

    const [search, setSearch] = useState('');
    const [selectedUser, setSelectedUser] = useState<User | null>(null);
    const [loaded, setLoaded] = useState(users.length > 0);

    useEffect(() => {
        Promise.resolve(fetchUsers()).finally(() => setLoaded(true));
    }, [fetchUsers]);

    // Sync selectedUser when users list refreshes (after save)
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

    const currentUserRole = currentUser?.role ?? '';

    return (
        <div style={{ fontFamily: GH_SANS, color: GH.ink }}>
            {embedded ? (
                <p style={{ fontSize: 14, color: GH.ink60, margin: '0 0 16px' }}>{RIGHTS_HINT}</p>
            ) : (
                <PageHeader title="Права доступа" description={RIGHTS_HINT} />
            )}

            <div style={{ maxWidth: 420, marginBottom: 16 }}>
                <Field label="Найти сотрудника или пользователя">
                    <Input
                        kind="search"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Имя или почта"
                    />
                </Field>
            </div>

            {!loaded && users.length === 0 ? (
                <SkeletonList count={4} label="Загружаем сотрудников" cardHeight={48} />
            ) : (
                <>
                    <UserTable
                        caption="Команда"
                        rows={staffShown}
                        onOpen={setSelectedUser}
                        empty={q ? 'Среди сотрудников никого с таким именем' : 'Сотрудников пока нет'}
                    />
                    {q.length >= 2 && (
                        <div style={{ marginTop: 24 }}>
                            <UserTable
                                caption="Другие пользователи"
                                rows={others}
                                onOpen={setSelectedUser}
                                empty="Никого не нашли"
                            />
                        </div>
                    )}
                    {q.length > 0 && q.length < 2 && (
                        <p style={{ marginTop: 12, fontSize: 14, color: GH.ink60 }}>
                            Чтобы найти среди всех пользователей, введите хотя бы две буквы.
                        </p>
                    )}
                </>
            )}

            <Sheet
                open={!!selectedUser}
                onClose={() => setSelectedUser(null)}
                title={selectedUser ? `Что может делать: ${selectedUser.name}` : 'Что может делать'}
                description={selectedUser ? `${roleLabel(selectedUser.role)} · ${selectedUser.email}` : undefined}
                width={720}
            >
                {selectedUser && (
                    <PermissionsEditor
                        user={selectedUser}
                        currentUserRole={currentUserRole}
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

function UserTable({ caption, rows, onOpen, empty }: {
    caption: string;
    rows: User[];
    onOpen: (u: User) => void;
    empty: string;
}) {
    const th: React.CSSProperties = {
        textAlign: 'left', padding: '10px 16px', borderBottom: `1px solid ${GH.ink10}`,
        fontFamily: GH_MONO, fontSize: 12, fontWeight: 500, letterSpacing: '0.06em',
        textTransform: 'uppercase', color: GH.ink60,
    };
    return (
        <div style={{ border: `1px solid ${GH.ink10}`, background: GH.card, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, minWidth: 560 }}>
                <caption style={{ textAlign: 'left', padding: '12px 16px', fontWeight: 600, fontSize: 16, borderBottom: `1px solid ${GH.ink10}` }}>
                    {caption}
                </caption>
                <thead>
                    <tr>
                        <th scope="col" style={th}>Имя</th>
                        <th scope="col" style={th}>Роль</th>
                        <th scope="col" style={th}>Сверх роли</th>
                        <th scope="col" style={{ ...th, width: 48 }}><span className="sr-only">Открыть</span></th>
                    </tr>
                </thead>
                <tbody>
                    {rows.length === 0 ? (
                        <tr>
                            <td colSpan={4}>
                                <EmptyState compact title={empty} />
                            </td>
                        </tr>
                    ) : rows.map(u => {
                        const extra = u.permissions?.length ?? 0;
                        return (
                            <tr
                                key={u.id}
                                className="access-row"
                                onClick={() => onOpen(u)}
                                style={{ borderBottom: `1px solid ${GH.ink10}`, cursor: 'pointer' }}
                            >
                                <td style={{ padding: '10px 16px' }}>
                                    {/* Кнопка — чтобы строку можно было открыть с клавиатуры. */}
                                    <button
                                        type="button"
                                        onClick={e => { e.stopPropagation(); onOpen(u); }}
                                        style={{
                                            background: 'none', border: 'none', padding: 0, font: 'inherit',
                                            color: GH.ink, fontWeight: 600, cursor: 'pointer', textAlign: 'left',
                                        }}
                                    >
                                        {u.name || u.email}
                                    </button>
                                    <div style={{ fontSize: 12, color: GH.ink60, overflowWrap: 'anywhere' }}>{u.email}</div>
                                </td>
                                <td style={{ padding: '10px 16px' }}>{roleLabel(u.role)}</td>
                                <td style={{ padding: '10px 16px', color: extra > 0 ? GH.ink : GH.ink60 }}>
                                    {extra > 0 ? ruCountWord(extra, RIGHTS) : 'только роль'}
                                </td>
                                <td style={{ padding: '10px 16px', color: GH.ink60 }} aria-hidden="true">
                                    <ChevronRight size={16} />
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
            <style>{`.access-row:hover { background: ${GH.ink5}; }`}</style>
        </div>
    );
}
