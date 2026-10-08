"""СТОРОЖ: чужие приглашения не становятся клиентами Psy-CRM (владелец 08.10).

Кейс: к CRM владельца подключён основной gmail-календарь; приглашения коллег
(«Координация руководителей», 13–16 участников) синк превратил в карточки
клиентов и дописал в их названия «#код». Приглашение (организатор — не этот
календарь) теперь: не создаёт карточку, не переименовывается; если в нём код
или имя существующего клиента — привязка к нему остаётся.

    python3 backend/tests/guard_crm_invites_2026_10.py
"""
import ast, pathlib, sys

ROOT = pathlib.Path(__file__).parent.parent.parent


def _read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


def _fn():
    src = _read("backend/app/services/crm_calendar.py")
    tree = ast.parse(src)
    node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "is_foreign_invite")
    ns: dict = {}
    exec(compile(ast.Module(body=[node], type_ignores=[]), "x", "exec"), ns)
    return ns["is_foreign_invite"]


def test_invite_detection():
    f = _fn()
    cal = "owner@gmail.com"
    assert f({"organizer": {"email": "boss@unbox.ge"}}, cal) is True, "приглашение коллеги"
    assert f({"organizer": {"email": "Owner@Gmail.com"}}, cal) is False, "своё событие (регистр не важен)"
    assert f({"organizer": {"email": "x@y", "self": True}}, cal) is False
    assert f({}, cal) is False, "нет организатора — считаем своим"
    grp = "c_abc@group.calendar.google.com"
    assert f({"organizer": {"email": grp}}, grp) is False, "событие в отдельном календаре «Клиенты»"


def test_sync_uses_flag():
    svc = _read("backend/app/services/crm_calendar.py")
    assert '"is_invite": is_foreign_invite(ev, calendar_id),' in svc
    s = _read("backend/app/api/v1/crm/sync.py")
    create = s[s.index("# Group unmatched events by clean name"):s.index("# Create clients for each unique name")]
    assert 'if ev.get("is_invite"):' in create, "приглашение снова создаёт карточку"
    assert 'if norm in new_clients_map and not ev.get("is_invite"):' in s
    backfill = s[s.index("# ── Backfill alias codes into Google Calendar summaries"):]
    assert 'if entry.get("is_invite"):' in backfill, "синк снова переименовывает чужие приглашения"
    assert '"looks_non_client": _looks_non_client(clean) or bool(ev.get("is_invite")),' in s, "предпросмотр"
    fe = _read("src/pages/crm/CrmSessions.tsx")
    assert "(приглашение от другого человека, пропустим)" in fe


if __name__ == "__main__":
    fails = 0
    for n, f in sorted(globals().items()):
        if n.startswith("test_") and callable(f):
            try:
                f(); print(f"  ✓ {n}")
            except AssertionError as e:
                fails += 1; print(f"  ✗ {n}: {e}")
    print("OK" if not fails else f"УПАЛО: {fails}")
    sys.exit(1 if fails else 0)
