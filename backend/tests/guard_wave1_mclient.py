"""СТОРОЖ wave1 — клиентское мобильное приложение /m (волна 1, шаг 2, 30.09).

Файлы: всё, что лежит прямо в src/pages/mobile/ (*.ts, *.tsx) — без
подпапок crm/ и admin/. Чтение исходников, без сети и базы. Комментарии
перед проверкой вырезаются: ловим только код и тексты интерфейса.

Что ловит:
  X1-07        — системные confirm()/prompt()/alert() вместо общего окна
                 подтверждения и шторки с полем.
  X1-03/X4-01  — бледный текст (#999, ink-30/40, text-gray-400 …) и любые
                 «сырые» hex-цвета вместо токенов.
  X4 (размер)  — шрифт мельче 12 px (инлайн и text-[..px]).
  X3 / G4-17   — обращение на «ты» (ты/тебе/твой…, «Выбери», «Тапни»…).
  Пересдача    — «переаренда», «перебронирование», «Пересд.» в текстах.
  G2-19/G4-16  — эмодзи вместо значков.
  Статусы      — подписи оплаты только из общего словаря (StatusBadge).
  Деньги       — суммы через formatGel/Money, без ручного «${x} ₾».
  LoadStates   — заглушки/ошибка/«устарело» на общих SkeletonList/ErrorBar.

    python3 backend/tests/guard_wave1_mclient.py
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).parent.parent.parent
MOBILE = ROOT / "src" / "pages" / "mobile"


def _files():
    return sorted([p for p in MOBILE.iterdir() if p.is_file() and p.suffix in (".ts", ".tsx")])


def _strip_comments(src: str) -> str:
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    # // до конца строки, но не «https://»
    return re.sub(r"(^|[^:\\])//[^\n]*", r"\1", src)


def _code():
    return [(p.name, _strip_comments(p.read_text(encoding="utf-8"))) for p in _files()]


def test_area_files_found():
    names = {n for n, _ in _code()}
    for must in ("MobileToday.tsx", "MobileMyBookings.tsx", "MobileFind.tsx", "MobileCheckout.tsx",
                 "BookingDetailSheet.tsx", "LoadStates.tsx", "MobileSubscription.tsx"):
        assert must in names, f"не нашли {must} — сторож смотрит не туда"


def test_no_system_dialogs():
    for name, src in _code():
        for bad in ("window.confirm(", "window.prompt(", "window.alert("):
            assert bad not in src, f"{name}: снова {bad} — нужен общий ConfirmDialog / шторка с полем"
        assert not re.search(r"(?<![\w.])(?:prompt|alert)\s*\(", src), \
            f"{name}: prompt()/alert() — число вводим полем в шторке, сообщения — тостом"
        for m in re.finditer(r"(?<![\w.])confirm\s*\(", src):
            before = src[max(0, m.start() - 6):m.start()]
            assert before.endswith("await "), f"{name}: голый confirm() — только await confirm({{…}}) из useConfirmDialog"
            assert "useConfirmDialog()" in src, f"{name}: confirm() не из useConfirmDialog"


def test_no_font_below_12():
    for name, src in _code():
        sizes = re.findall(r"fontSize:\s*'?(\d+(?:\.\d+)?)(?:px)?'?", src)
        small = [s for s in sizes if float(s) < 12]
        assert not small, f"{name}: шрифт меньше 12 px: {small}"
        tw = [s for s in re.findall(r"text-\[(\d+(?:\.\d+)?)px\]", src) if float(s) < 12]
        assert not tw, f"{name}: text-[..px] меньше 12: {tw}"


def test_no_pale_text():
    pale = re.compile(
        r"color:\s*(?:GH\.ink(?:20|30|40)|COLOR\.ink(?:05|08|10|20|30|40)\b|"
        r"'#(?:999|999999|aaa|aaaaaa|bbb|bbbbbb|888|888888)'|'var\(--color-ink-(?:10|20|30|40)\)')",
        re.I,
    )
    for name, src in _code():
        m = pale.search(src)
        assert not m, f"{name}: бледный текст ({m.group(0)}) — для текста минимум ink-60"
        assert not re.search(r"text-gray-[34]00", src), f"{name}: text-gray-300/400 — бледный текст"


def test_no_raw_hex_colors():
    for name, src in _code():
        hexes = re.findall(r"#[0-9A-Fa-f]{3,8}\b", src)
        assert not hexes, f"{name}: цвета мимо токенов: {sorted(set(hexes))[:6]}"
        assert "linear-gradient(135deg" not in src, f"{name}: декоративный градиент — только ровные поверхности"


TY = re.compile(
    r"(?<![А-Яа-яЁё])(?:ты|Ты|тебе|Тебе|тебя|Тебя|тобой|твой|Твой|твоя|Твоя|твоё|Твоё|твое|твои|Твои|"
    r"твоих|твоим|твоей|твоего|твоему|твою|Твою|"
    r"Выбери|выбери|Нажми|нажми|Тапни|тапни|Пополни|пополни|Подожди|подожди|Открой|открой|Напиши|напиши|"
    r"Попробуй|попробуй|Введи|введи|Заполни|заполни|Поставь|поставь|Потяни|потяни|Отпусти|отпусти|"
    r"Листай|листай|Открывай|открывай|Прокрути|прокрути|Найди|найди|Попроси|попроси|Уменьши|уменьши|"
    r"получишь|вернёшься|бронируешь|бронишь|оставь|Оставь)(?![А-Яа-яЁё])"
)


def test_no_ty_address():
    for name, src in _code():
        m = TY.search(src)
        assert not m, f"{name}: обращение на «ты» («{m.group(0)}») — владелец решил: везде «вы»"


def test_no_rerent_jargon():
    for name, src in _code():
        m = re.search(r"переаренд|Переаренд|перебронир|Перебронир|Пересд\.|пересд\.", src)
        assert not m, f"{name}: «{m.group(0)}» — функция называется «Пересдать» / «На пересдаче»"


def test_no_emoji_icons():
    emoji = re.compile("[\U0001F300-\U0001FAFF☀-➿⭐]")
    for name, src in _code():
        m = emoji.search(src)
        assert not m, f"{name}: эмодзи «{m.group(0)}» вместо значка Lucide"


def test_payment_status_words_from_dictionary():
    for name in ("MobileMyBookings.tsx", "BookingDetailSheet.tsx"):
        src = _strip_comments((MOBILE / name).read_text(encoding="utf-8"))
        assert '<StatusBadge kind="payment"' in src, f"{name}: статус оплаты не через StatusBadge"
        for old in ("'Не списано'", ">Не списано<", ">Без счёта<"):
            assert old not in src, f"{name}: своя подпись статуса оплаты {old}"


def test_money_through_formatter():
    for name, src in _code():
        assert not re.search(r"toFixed\(\d\)\}\s*₾", src), f"{name}: сумма собрана руками (toFixed + ₾) — formatGel"
        assert not re.search(r"\$\{[^}]*\}\s*₾", src), f"{name}: сумма собрана руками («${{x}} ₾») — formatGel"
        assert not re.search(r"\}\s?₾", src), f"{name}: сумма собрана руками ({{x}} ₾) — formatGel / <Money>"


def test_loadstates_on_shared_components():
    src = (MOBILE / "LoadStates.tsx").read_text(encoding="utf-8")
    assert "components/ui/Skeleton" in src and "SkeletonList" in src, "SkeletonRows не на общем SkeletonList"
    assert "components/ui/ErrorBar" in src and "<ErrorBar" in src, "ошибки не на общем ErrorBar"
    for exp in ("export function SkeletonRows", "export function LoadErrorCard", "export function StaleBar"):
        assert exp in src, f"LoadStates: пропал экспорт {exp.split()[-1]} — экраны его зовут"
    assert "staleAt=" in src, "StaleBar не показывает «данные на 14:05»"


def test_no_false_empty_on_error():
    """Ошибка загрузки ≠ «пусто»: бонусы, специалисты, уведомления."""
    for name in ("MobileBonuses.tsx", "MobileSpecialists.tsx", "NotificationsBell.tsx"):
        src = _strip_comments((MOBILE / name).read_text(encoding="utf-8"))
        assert "<ErrorBar" in src, f"{name}: при сбое снова покажем «ничего нет» вместо ошибки"
        assert "<EmptyState" in src, f"{name}: пустое состояние не общее"


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
            except Exception as exc:  # noqa: BLE001
                failures += 1
                print(f"  ✗ {name}: {exc!r}")
    print("СТОРОЖ wave1-mclient: OK" if not failures else f"СТОРОЖ wave1-mclient УПАЛ ({failures}) — деплой НЕ выкатывать")
    sys.exit(1 if failures else 0)
