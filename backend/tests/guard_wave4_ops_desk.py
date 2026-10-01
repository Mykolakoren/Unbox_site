"""СТОРОЖ wave4 · ops_desk — компьютерная админка, пакет D (01.10).

Файлы: AdminLayout, Maintenance, Waitlist, TasksBoard + adminTaskStore,
AccessRights + PermissionsEditor, Cabinets + ResourceModal, AdminSpecialists,
AdminTeam, AdminPosts, KnowledgeBase, AdminCrm, CmdKSearch.

Что ловит:
  * G7-16 / G8-07 / X2-20 / G7-13: меню снова плоское с номерами 01–14
    (padStart), без групп «Каждый день / Пространство / Люди и контент /
    Система», без иконок и aria-current; личные «Абонемент / Бонусы /
    Профиль» снова рядом значков над разделами, а не в меню под именем.
  * G8-08 / X4-18 / G8-admin-ops-M3: шапка и вкладка браузера без карты
    путь → название (useDocumentTitle), неизвестный путь снова «Дашборд».
  * Права и роли НЕ менялись: проверки canAccessRights / canAccessFinance,
    доступ «Аналитики» только по почте владельца, ADMIN_ROLES; список прав
    в PermissionsEditor (30 пунктов в 8 группах — «33 права» в памяти проекта
    считают вместе с psy_crm.*, которые в редакторе не показываются),
    ROLE_INHERITED, canToggle и сохранение — отпечатки. Поменяли права —
    это решение владельца и ревью security-reviewer, потом новый отпечаток.
  * G8-03 / В1: «Закрыть кабинет» снова мимо maintenanceApi, без шторки 409
    (MaintenanceConflictSheet) или с toast.error(detail) — объект в тосте
    роняет React (#31). G8-12 / G8-admin-ops-M2: серии не свёрнуты, нет
    «Снять серию» (removeGroup) и «Показать все» (снова slice(0, 20)).
  * G8-01: лист ожидания снова из /waitlist/my (очередь самого админа).
  * G8-admin-ops-M1: «Создано / Обновлено» до ответа сервера; стор задач
    снова глотает ошибку.
  * G8-13: права снова выбираются из всей базы, права роли — активной
    галочкой без замка «входит в роль».
  * G8-16: вкладки кабинетов из статичного LOCATIONS, заглушка «07».
  * G8-20: стена тегов вместо поиска по имени и одного списка; публикация,
    скрытие и одобрение специалиста без вопроса.
  * G8-09 / G8-17: окна Maintenance, Team, Tasks, Posts, ResourceModal снова
    самодельные fixed-оверлеи без Esc/фокуса, а не общий Sheet.
  * G8-11: H1 страницы не совпадает с пунктом меню.

Только чтение исходников:
    python3 backend/tests/guard_wave4_ops_desk.py
"""
import hashlib
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).parent.parent.parent
ADMIN = "src/pages/admin/"
COMP = "src/components/admin/"


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def _strip_comments(src: str) -> str:
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"(^|[^:'\"`\\])//[^\n]*", r"\1", src)


def _code(rel: str) -> str:
    return _strip_comments(_read(rel))


def _fp(block: str) -> str:
    return hashlib.sha256(re.sub(r"\s+", "", _strip_comments(block)).encode("utf-8")).hexdigest()


def _body(src: str, start: str, end: str = "\n    };") -> str:
    i = src.index(start)
    return src[i:src.index(end, i + len(start))]


# ── Отпечатки (сняты 01.10 с кода до и после пакета D — совпадают) ────────────

PERM_GROUPS_FP = "b4cc74c14e38b28ba30bc5522024ee3941fff0dee5b17c3425b4617c8ddca136"
PERM_INHERITED_FP = "ba52f1d1ef0bbcf4c8357ab4aa0d0621acc4d37cc8f90a7d491ff02941d26353"
PERM_LOGIC_FP = "ac2c738ee7feb8170492bd2ecc71e3c0dc116e0c63674b9dc23abb074fe6feca"  # useState … canToggle/toggle/save
PERM_SAVE_FP = "edb3304500ea57fc73c385b13795dddbcc62aff438e1c53962ea732cb28b8930"
PERM_IDS_FP = "812aea4bcf4f99ac5bf1812d436ef6a0fce54161ac70da4b78659f004cd063f4"
PERM_COUNT = 30
CAB_TOGGLE_RESOURCE_FP = "3a73be9bfd650fa5c6522a5eb1fe17c4aa958337eb31bf009e36b1115f355425"
CAB_TOGGLE_LOCATION_FP = "b1944aa33f4b79ffa9b143d5b8dcecc65159993fd95e55072f45aef51977cc95"
RESOURCE_SAVE_FP = "954ecc7302b2dbf5771f4d13984a7e8552a495086ef29c9122967c9e35567519"

# Проверки ролей в оболочке — дословно (НЕЛЬЗЯ пакета D).
# 01.10 (доработка волны 4): canAccessRights / canAccessFinance вынесены
# дословно в utils/permissions.ts (userCanAccessRights / userCanAccessFinance),
# чтобы ими же закрыть сами страницы. Тела хелперов сверяются ниже (HELPER_LINES).
ROLE_LINES = (
    "const canAccessRights = userCanAccessRights(currentUser);",
    "const canAccessFinance = userCanAccessFinance(currentUser);",
    "const canSeeAnalytics = (currentUser?.email || '').toLowerCase() === 'koren.nikolas@gmail.com';",
    "const ADMIN_ROLES = ['admin', 'senior_admin', 'owner'];",
    "if (!ADMIN_ROLES.includes(currentUser.role ?? '')) return <Navigate to=\"/\" replace />;",
    "...(canSeeAnalytics ? [{ path: '/admin/analytics'",
    "...(canAccessRights ? [{ path: '/admin/access-rights'",
    "...(canAccessFinance ? [{ path: '/admin/finance'",
)
# Та же логика, что раньше стояла в AdminLayout, — дословно.
HELPER_LINES = (
    "export function userCanAccessFinance(user: User | null | undefined): boolean {\n"
    "    return hasPermission(user, 'finance.manage_cashbox')\n"
    "        || hasPermission(user, 'finance.view_reports');\n}",
    "export function userCanAccessRights(user: Pick<User, 'role'> | null | undefined): boolean {\n"
    "    return user?.role === 'owner' || user?.role === 'senior_admin';\n}",
)


# ── Меню ─────────────────────────────────────────────────────────────────

def test_menu_groups_without_numbers():
    src = _code(ADMIN + "AdminLayout.tsx")
    assert "padStart" not in src, "в меню/шапке снова номера 01–14 (padStart)"
    for g in ("'Каждый день'", "'Пространство'", "'Люди и контент'", "'Система'"):
        assert f"title: {g}" in src, f"нет группы меню {g}"
    for item in ("label: 'Сегодня'", "label: 'Обслуживание'", "label: 'Лист ожидания'",
                 "label: 'Воронка клиентов'", "label: 'Права доступа'"):
        assert item in src, f"в меню пропал пункт {item}"
    assert "aria-current={active ? 'page' : undefined}" in src, "у пункта меню нет aria-current"
    assert "<Icon size={16} aria-hidden=\"true\" />" in src, "иконки пунктов меню снова не выводятся"


def test_personal_links_live_under_the_name():
    src = _code(ADMIN + "AdminLayout.tsx")
    assert "PERSONAL_ITEMS" in src and 'role="menu"' in src, "личное не в меню под именем"
    for path in ("/admin/subscription", "/admin/bonuses", "/admin/account"):
        assert path in src, f"в меню под именем нет {path}"
    assert "gridTemplateColumns: 'repeat(3, 1fr)'" not in src, \
        "вернулся ряд значков «Абонемент / Бонусы / Профиль» над разделами"
    i = src.index("const navGroups")
    groups = src[i:src.index("].filter(g => g.items.length > 0)", i)]
    for path in ("/admin/subscription", "/admin/bonuses", "/admin/account"):
        assert path not in groups, f"личное {path} снова среди разделов"


def test_title_map_and_document_title():
    src = _code(ADMIN + "AdminLayout.tsx")
    assert "export function adminTitleFor(" in src, "нет карты путь → название"
    assert "useDocumentTitle(`${title} · Админка`)" in src, "вкладка браузера без названия раздела"
    assert "{ title: 'Админка', group: null }" in src, "неизвестный путь должен называться «Админка»"
    assert "Дашборд" not in src, "неизвестный путь / первый пункт снова «Дашборд»"
    assert "'/admin/users/'" in src, "карточка клиента без своего названия в шапке"


def test_search_button_in_header():
    src = _code(ADMIN + "AdminLayout.tsx")
    assert "Найти клиента или бронь" in src and "onClick={openCmdK}" in src, "в шапке нет «Найти клиента или бронь ⌘K»"
    assert "Панель управления" not in src, "вернулась декоративная надпись в шапке"
    cmdk = _code(COMP + "CmdKSearch.tsx")
    assert "export function openCmdK()" in cmdk and "window.addEventListener(OPEN_EVENT" in cmdk
    assert "/admin/users/${encodeURIComponent(u.email)}" in cmdk, "поиск ведёт в карточку по id (маршрут — :email)"
    assert "?focus=" not in cmdk, "ссылка на бронь снова ?focus= (шахматка понимает ?highlight=)"


def test_role_checks_unchanged():
    src = _read(ADMIN + "AdminLayout.tsx")
    for line in ROLE_LINES:
        assert line in src, f"проверка ролей в оболочке изменилась: {line[:70]}…"
    assert "loginPathWithRedirect(" in src
    perms = _read("src/utils/permissions.ts")
    for line in HELPER_LINES:
        assert line in perms, f"общая проверка прав изменилась: {line[:70]}…"


def test_permissions_list_and_saving_unchanged():
    src = _read(COMP + "PermissionsEditor.tsx")
    a = src.index("export const PERMISSION_GROUPS")
    b = src.index("] as const;", a) + len("] as const;")
    ids = re.findall(r"\{ id: '([a-z_]+\.[a-z_0-9]+)'", src[a:b])
    assert len(ids) == PERM_COUNT, f"в редакторе {len(ids)} прав вместо {PERM_COUNT}"
    assert hashlib.sha256(",".join(ids).encode()).hexdigest() == PERM_IDS_FP, "поменялся список прав"
    assert _fp(src[a:b]) == PERM_GROUPS_FP, "поменялись группы/подписи/права для старшего админа"
    c = src.index("const ROLE_INHERITED")
    assert _fp(src[c:src.index("\n};", c) + 3]) == PERM_INHERITED_FP, "поменялись права, входящие в роли"
    e = src.index("export function PermissionsEditor")
    assert _fp(src[e:src.index("const hasChanges", e)]) == PERM_LOGIC_FP, "поменялись canToggle / toggle / save"
    assert _fp(_body(src, "const save = async")) == PERM_SAVE_FP, "поменялось сохранение прав"


# ── Обслуживание ─────────────────────────────────────────────────────────

def test_maintenance_409_goes_to_conflict_sheet():
    src = _code(ADMIN + "Maintenance.tsx")
    assert "maintenanceApi.create(" in src and "maintenanceApi.list(" in src, "обслуживание снова мимо maintenanceApi"
    assert "api.post" not in src and "api.get" not in src and "api.delete" not in src
    assert "if (isMaintenanceConflict(e)) setConflicts(e.conflicts);" in src, "нет ветки 409 → шторка"
    assert "<MaintenanceConflictSheet" in src and "linkFor={bookingLink}" in src
    assert "highlight=${c.bookingId}" in src, "ссылка из шторки не ведёт к брони в шахматке"
    assert "detail" not in src, "toast.error(detail): на 409 detail — объект → React #31"
    assert "force" not in src, "В1: никакого «закрыть всё равно»"


def test_maintenance_series_and_show_all():
    src = _code(ADMIN + "Maintenance.tsx")
    assert "recurringGroupId" in src and "kind: 'series'" in src, "серии не сворачиваются"
    assert "maintenanceApi.removeGroup(" in src and "Снять серию" in src, "нет «Снять серию»"
    assert "Показать все (" in src, "нет «Показать все»"
    assert ".slice(0, 20)" not in src, "снова первые 20 и немой «и ещё N…»"
    assert "ruCountWord(" in src and "['дата', 'даты', 'дат']" in src, "«1 блокировок» — без склонений"
    assert "batumiDayKey()" in src and "toISOString" not in src, "«сегодня» снова по UTC"


# ── Лист ожидания ────────────────────────────────────────────────────────

def test_waitlist_is_clients_queue():
    src = _code(ADMIN + "Waitlist.tsx")
    assert "waitlistApi.getAllWaitlistAdmin()" in src, "лист ожидания не из /waitlist/admin/all"
    assert "getMyWaitlist" not in src and "removeFromWaitlist } = useUserStore" not in src, \
        "лист ожидания снова из личной очереди админа"
    body = _body(src, "const handleDelete = async")
    assert body.index("await waitlistApi.removeFromWaitlist(") < body.index("toast.success("), \
        "«Убрали» показывается до ответа сервера"
    assert "toastApiError(e," in body, "ошибка удаления не видна"
    assert "padStart" not in src


# ── Задачи ───────────────────────────────────────────────────────────────

def test_tasks_success_only_after_await():
    src = _code(ADMIN + "TasksBoard.tsx")
    for bad in ("toast.success('Обновлено')", "toast.success('Создано')", "p.moveTask(task.id, status); toast"):
        assert bad not in src, f"тост успеха до ответа сервера: {bad}"
    save = _body(src, "const saveTask = async")
    assert save.index("await updateTask(") < save.index("toast.success('Задача сохранена')")
    assert save.index("await addTask(") < save.index("toast.success('Задача создана')")
    assert "toastApiError(e," in save and "return false;" in save
    quick = _body(src, "const handleQuickAdd = async")
    assert "catch (e)" in quick and quick.index("return;") < quick.index("toast.success('Задача создана')"), \
        "быстрое создание хвалится «Создано» при ошибке"
    move = _body(src, "const handleMove = async")
    assert move.index("await moveTask(") < move.index("toast.success(")
    assert "const ok = await p.saveTask(" in src and "if (ok) p.setEditingTask(null);" in src, \
        "окно задачи закрывается и при ошибке"
    assert "№{String(index" not in src and "padStart" not in src, "снова позиционный №001"


def test_task_store_rethrows():
    store = _code("src/store/adminTaskStore.ts")
    assert "Promise<AdminTask | null>" not in store and "return null;" not in store, "addTask снова глотает ошибку"
    upd = _body(store, "updateTask: async", "\n    },")
    assert "catch" not in upd, "updateTask снова глотает ошибку"
    move = _body(store, "moveTask: async", "\n    },")
    assert "throw e;" in move, "moveTask не пробрасывает ошибку"
    assert "deleteTask: (id: string) => Promise<boolean>;" in store


# ── Права ────────────────────────────────────────────────────────────────

def test_access_rights_staff_table_and_lock():
    src = _code(ADMIN + "AccessRights.tsx")
    assert "<table" in src and "STAFF_ROLES" in src, "нет таблицы сотрудников"
    assert "Что может делать" in src, "окно редактора не «Что может делать»"
    assert "<Sheet" in src
    pe = _code(COMP + "PermissionsEditor.tsx")
    assert "<Lock" in pe and "входит в роль «{roleName}»" in pe, "права роли без замка «входит в роль»"
    assert "Гранулярные права доступа" not in pe


# ── Кабинеты ─────────────────────────────────────────────────────────────

def test_cabinets_tabs_from_locations():
    src = _code(ADMIN + "Cabinets.tsx")
    assert "LOCATIONS" not in src, "вкладки/подписи снова из статичного LOCATIONS"
    assert "...locations.map(" in src, "вкладки не из локаций с сервера"
    assert "padStart" not in src, "снова «009» / «07» / «001»"
    raw = _read(ADMIN + "Cabinets.tsx")
    assert _fp(_body(raw, "const handleToggleResource = async")) == CAB_TOGGLE_RESOURCE_FP, \
        "поменялся переключатель кабинета (resourcesApi.update + undoToast)"
    assert _fp(_body(raw, "const handleToggleLocation = async")) == CAB_TOGGLE_LOCATION_FP
    rm = _read(COMP + "ResourceModal.tsx")
    assert _fp(_body(rm, "const handleSave = async")) == RESOURCE_SAVE_FP, "поменялось сохранение кабинета"


# ── Специалисты ──────────────────────────────────────────────────────────

def test_specialists_search_and_one_select():
    src = _code(ADMIN + "AdminSpecialists.tsx")
    assert "['all', ...allSpecTags].map" not in src, "вернулась стена тегов"
    assert "Поиск по имени" in src and "nameQuery" in src, "нет поиска по имени"
    assert "<option value=\"all\">Все специализации</option>" in src, "нет одного выпадающего списка"
    assert "ADMIN · SPECIALISTS" not in src and "'ВКЛ'" not in src


def test_specialists_confirm_publish_hide_approve():
    src = _code(ADMIN + "AdminSpecialists.tsx")
    tog = _body(src, "const handleToggleVisibility = async")
    assert tog.index("await confirm(") < tog.index("api.patch(`/specialists/admin/${s.id}`, { isVerified: !s.isVerified })"), \
        "публикация/скрытие без вопроса"
    act = _body(src, "const act = async")
    assert act.index("await confirm(") < act.index("api.post(`/specialists/admin/${s.id}/${kind}`)"), \
        "одобрение заявки без вопроса"


# ── Окна на Sheet и H1 = пункт меню ──────────────────────────────────────

def test_dialogs_on_shared_sheet():
    files = (ADMIN + "Maintenance.tsx", ADMIN + "AdminTeam.tsx", ADMIN + "TasksBoard.tsx",
             ADMIN + "AdminPosts.tsx", COMP + "ResourceModal.tsx")
    for rel in files:
        src = _code(rel)
        assert re.search(r"import \{ Sheet \} from '(\.\./)+(components/)?ui/Sheet'", src), f"{rel}: окно не на общем Sheet"
        assert "<Sheet" in src
        assert "fixed inset-0" not in src and "position: 'fixed', inset: 0" not in src, f"{rel}: самодельный оверлей"
        assert "createPortal" not in src, f"{rel}: самодельный портал вместо Sheet"


def test_h1_matches_menu_item():
    menu = _code(ADMIN + "AdminLayout.tsx")
    pages = {
        "Maintenance.tsx": "Обслуживание", "Waitlist.tsx": "Лист ожидания", "TasksBoard.tsx": "Задачи",
        "Cabinets.tsx": "Кабинеты", "AdminSpecialists.tsx": "Специалисты", "AdminTeam.tsx": "Команда",
        "AdminPosts.tsx": "Новости и статьи", "KnowledgeBase.tsx": "База знаний",
        "AccessRights.tsx": "Права доступа", "AdminCrm.tsx": "Воронка клиентов",
    }
    for name, title in pages.items():
        assert f"label: '{title}'" in menu, f"в меню нет «{title}»"
        src = _code(ADMIN + name)
        assert re.search(r"<PageHeader\s+title=\"" + re.escape(title) + "\"", src), \
            f"{name}: H1 не «{title}» (как в меню)"
    for slogan in ("Каталог пространств.", "Очередь ожидания.", "Команда на витрине.", "Ролевой контроль.",
                   "Клиентский поток.", "Рабочая доска.", "Справочник и чек-листы."):
        for name in pages:
            assert slogan not in _code(ADMIN + name), f"{name}: вернулся заголовок-лозунг «{slogan}»"


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"  ✓ {name}")
            except AssertionError as exc:
                failures += 1
                print(f"  ✗ {name}: {exc}")
    if failures:
        print(f"СТОРОЖ wave4-ops-desk: {failures} провал(ов)")
        sys.exit(1)
    print("СТОРОЖ wave4-ops-desk: OK")
