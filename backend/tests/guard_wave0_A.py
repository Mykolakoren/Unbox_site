"""СТОРОЖ wave0-A — запись к специалисту и часы приёма.

29.09 аудит: интерцептор ответа (src/api/client.ts) переводит все ключи в
camelCase, а запись к специалисту и экран «Расписание» читали snake_case:
- на сайте свободные часы не показывались, строки на телефоне были без
  времени и с подписью «Онлайн», запрос записи уходил без start_time (422),
  а ошибка 422 роняла всё приложение (detail-массив в toast);
- «Расписание» открывало сохранённые часы пустыми — одно «Сохранить»
  стирало расписание специалиста;
- анкету искали через админский /specialists/admin/all (403 для
  специалиста) → тупик «Аккаунт не привязан к анкете»;
- на телефоне /crm/schedule уводил на «Сегодня», экрана расписания не было.

Гоняется без сети и без базы (чтение исходников + модели бэкенда):

    python3 backend/tests/guard_wave0_A.py
"""
import os
import pathlib
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("ENVIRONMENT", "development")

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
SRC = ROOT / "src"

BOOKING_FILES = [
    "components/Specialists/SpecialistBookingChessboardGrid.tsx",
    "components/Specialists/SpecialistBookingChessboard.tsx",
    "components/Specialists/NextAvailableSlots.tsx",
    "pages/crm/CrmSchedule.tsx",
]


def _read(rel):
    return (SRC / rel).read_text(encoding="utf-8")


def _ts_interface_keys(src, name):
    """Ключи TS-интерфейса `export interface <name> { ... }`."""
    m = re.search(r"export interface " + name + r" \{(.*?)\n\}", src, re.S)
    assert m, f"не нашли interface {name}"
    return [k for k in re.findall(r"^\s+(\w+)\??:", m.group(1), re.M)]


def _to_snake(key):
    """Та же замена, что toSnakeCase в src/utils/transformers.ts."""
    return re.sub(r"[A-Z]", lambda c: "_" + c.group(0).lower(), key)


def _to_camel(key):
    """Та же замена, что toCamelCase в src/utils/transformers.ts."""
    return re.sub(r"_([a-z])", lambda c: c.group(1).upper(), key)


def test_interceptors_still_convert_both_ways():
    """Вся схема держится на двух интерцепторах: ответ → camelCase,
    тело запроса → snake_case. Уберут один — типы ниже станут враньём."""
    client = _read("api/client.ts")
    assert "config.data = toSnakeCase(config.data)" in client, "тело запроса больше не переводится в snake_case"
    assert "response.data = toCamelCase(response.data)" in client, "ответ больше не переводится в camelCase"


def test_specialist_api_types_are_camelcase():
    """Типы слотов/расписания/записей описывают то, что реально приходит
    после интерцептора. snake_case-типы и прятали баг от tsc."""
    src = _read("api/specialists.ts")
    for name in ("ScheduleSlot", "AvailableSlot", "Appointment", "AppointmentCreate"):
        keys = _ts_interface_keys(src, name)
        snake = [k for k in keys if "_" in k]
        assert not snake, f"{name}: snake_case-поля {snake} — после интерцептора их не будет (undefined)"


def test_available_slots_response_matches_frontend_type():
    """Ключи ответа /available-slots после camelCase == поля AvailableSlot."""
    py = (ROOT / "backend/app/api/v1/specialist_schedule.py").read_text(encoding="utf-8")
    i = py.find("def get_available_slots")
    body = py[i:py.find("\n@router.", i)]
    m = re.search(r"result\.append\(\{(.*?)\}\)", body, re.S)
    assert m, "не нашли формирование слота в get_available_slots"
    backend_keys = set(re.findall(r'"(\w+)":', m.group(1)))
    ts_keys = set(_ts_interface_keys(_read("api/specialists.ts"), "AvailableSlot"))
    assert {_to_camel(k) for k in backend_keys} == ts_keys, \
        f"ответ бэкенда {sorted(backend_keys)} не совпадает с AvailableSlot {sorted(ts_keys)}"


def test_appointment_payload_reaches_backend_fields():
    """Запись к специалисту: ключи AppointmentCreate после toSnakeCase —
    ровно поля SpecialistAppointmentCreate, обязательные на месте.
    Без start_time бэкенд отвечал 422, и клиент не мог записаться."""
    from app.models.specialist_appointment import SpecialistAppointmentCreate
    fields = set(SpecialistAppointmentCreate.model_fields)
    ts_keys = _ts_interface_keys(_read("api/specialists.ts"), "AppointmentCreate")
    snaked = {_to_snake(k) for k in ts_keys}
    assert snaked <= fields, f"лишние/неизвестные бэкенду поля: {sorted(snaked - fields)}"
    for required in ("client_name", "date", "start_time"):
        assert required in snaked, f"в запросе записи нет {required}"
    grid = _read("components/Specialists/SpecialistBookingChessboardGrid.tsx")
    assert "startTime: selectedSlot.startTime" in grid, "сетка не передаёт время выбранного слота"
    assert "locationId: selectedSlot.locationId" in grid, "сетка не передаёт локацию выбранного слота"


def test_schedule_payload_reaches_backend_fields():
    """Сохранение расписания: ключи ScheduleSlot после toSnakeCase —
    поля SpecialistScheduleCreate."""
    from app.models.specialist_schedule import SpecialistScheduleCreate
    fields = set(SpecialistScheduleCreate.model_fields)
    ts_keys = [k for k in _ts_interface_keys(_read("api/specialists.ts"), "ScheduleSlot") if k != "id"]
    snaked = {_to_snake(k) for k in ts_keys}
    assert snaked == fields, f"ScheduleSlot {sorted(snaked)} ≠ SpecialistScheduleCreate {sorted(fields)}"


def test_no_snake_case_reads_of_api_objects():
    """Никто не читает slot.start_time / appt.client_name и т.п. — после
    интерцептора это undefined (пустые слоты, пустое расписание)."""
    pat = re.compile(
        r"\b(?:slot|s|selectedSlot|availSlot|appt|mine|spec)\??\."
        r"(?:start_time|end_time|location_id|day_of_week|specific_date|is_available|client_name|client_phone|client_email)\b"
    )
    for rel in BOOKING_FILES:
        found = [m.group(0) for m in pat.finditer(_read(rel))]
        assert not found, f"{rel}: чтение snake_case-полей API {found[:5]}"


def test_booking_error_never_renders_raw_detail():
    """detail от 422 — массив объектов; toast.error(detail) ронял всё
    приложение (React #31). Только через apiErrorMessage."""
    for rel in ("components/Specialists/SpecialistBookingChessboardGrid.tsx",
                "components/Specialists/SpecialistBookingChessboard.tsx"):
        src = _read(rel)
        assert "e.response?.data?.detail ||" not in src, f"{rel}: сырой detail снова идёт в toast"
        assert "apiErrorMessage(e," in src, f"{rel}: ошибка записи не через apiErrorMessage"


def test_crm_schedule_finds_profile_via_me():
    """«Расписание» ищет анкету через /specialists/me (как «Анкета»), а не
    через админский список — иначе у специалиста 403 и тупик."""
    src = _read("pages/crm/CrmSchedule.tsx")
    assert "specialistsApi.getMine()" in src, "анкета снова ищется не через /specialists/me"
    assert "api.get('/specialists/admin/all')" not in src, "вернулся поиск анкеты через админский эндпоинт"
    assert "Admin · Специалисты" not in src, "тупиковый текст отсылает специалиста в админку"
    # запасной админский путь — только после 403 от /me и только для админа
    i = src.find("specialistsApi.adminList()")
    assert i == -1 or "status === 403 && isAdmin" in src[:i], "админский список дергается не только для админа"


def test_crm_schedule_reads_camelcase_schedule():
    """Загруженное расписание читается из camelCase — иначе экран пустой,
    и «Сохранить» стирает часы специалиста."""
    src = _read("pages/crm/CrmSchedule.tsx")
    for needle in ("slot.specificDate", "slot.dayOfWeek", "slot.startTime", "slot.isAvailable", "slot.locationId"):
        assert needle in src, f"CrmSchedule не читает {needle}"
    # Сбой загрузки → экран ошибки, а не пустой редактор, который можно сохранить
    i = src.find("specialistsApi.getSchedule(specialistId)")
    load = src[i:src.find("}, [specialistId", i)]
    assert "setLookup('error')" in load, "при сбое загрузки снова показывается пустой редактор — «Сохранить» сотрёт часы"


def test_schedule_reachable_from_phone():
    """На телефоне расписание открывается (/m/crm/schedule), ссылка
    /crm/schedule не уводит на «Сегодня», вход есть во вкладке «Анкета»."""
    app = _read("App.tsx")
    assert 'path="schedule" element={<CrmSchedule compact />}' in app, "нет мобильного маршрута расписания"
    i_sched = app.find(r"[/^\/crm\/schedule\/?$/, '/m/crm/schedule']")
    i_generic = app.find(r"[/^\/crm\/[^/]+\/?$/, '/m/crm']")
    assert i_sched != -1, "на телефоне /crm/schedule снова уводит на «Сегодня»"
    assert i_sched < i_generic, "правило расписания стоит после общего /crm/* → /m/crm и не сработает"
    prof = _read("pages/mobile/crm/MobileCrmProfile.tsx")
    assert 'to="/m/crm/schedule"' in prof, "из мобильной «Анкеты» пропал вход в «Часы приёма»"


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
    print("СТОРОЖ wave0-A: OK" if not failures else f"СТОРОЖ wave0-A УПАЛ ({failures}) — деплой НЕ выкатывать")
    sys.exit(1 if failures else 0)
