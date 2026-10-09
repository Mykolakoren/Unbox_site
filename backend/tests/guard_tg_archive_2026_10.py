"""СТОРОЖ архива чата админов в Telegram (владелец 09.10).

Бот в «UNBOX admin» (приватность выключена) молча пишет сообщения в файлы на
сервере; в группах на обычный текст НЕ отвечает (иначе ответил бы на каждое
сообщение админов). Пишем только чаты из TELEGRAM_ARCHIVE_CHAT_IDS.

    python3 backend/tests/guard_tg_archive_2026_10.py
"""
import json, os, pathlib, sys, tempfile

ROOT = pathlib.Path(__file__).parent.parent.parent
sys.path.insert(0, str(ROOT / "backend"))
os.environ.setdefault("ENVIRONMENT", "development")


def _msg(chat_id, text="привет", **kw):
    m = {"message_id": 7, "date": 1760000000, "chat": {"id": chat_id, "type": "supergroup", "title": "UNBOX admin"},
         "from": {"first_name": "Валентина", "last_name": "М"}, "text": text}
    m.update(kw)
    return {"message": m}


def test_archive_only_listed_group():
    from app.core.config import settings
    from app.services import tg_archive
    with tempfile.TemporaryDirectory() as d:
        settings.TELEGRAM_ARCHIVE_DIR = d
        settings.TELEGRAM_ARCHIVE_CHAT_IDS = "-100555"
        assert tg_archive.maybe_archive(_msg(-100555, reply_to_message={"message_id": 5, "from": {"first_name": "Егор"}, "text": "Яна −55"},
                                             photo=[{"file_id": "small"}, {"file_id": "big"}])) is True
        assert tg_archive.maybe_archive(_msg(-100999)) is False, "чужая группа не пишется"
        seen = pathlib.Path(d, "_groups_seen.jsonl").read_text(encoding="utf-8")
        assert '"-100999"' in seen and "привет" not in seen, "незнакомая группа: только id и название, без текста"
        priv = {"message": {"message_id": 1, "date": 1760000000, "chat": {"id": 42, "type": "private"}, "text": "/start"}}
        assert tg_archive.maybe_archive(priv) is False, "личка не пишется"
        files = list(pathlib.Path(d, "100555").glob("*.jsonl"))
        assert len(files) == 1
        rec = json.loads(files[0].read_text(encoding="utf-8").splitlines()[0])
        assert rec["from"] == "Валентина М" and rec["text"] == "привет"
        assert rec["reply_to"]["from"] == "Егор" and rec["photo_file_id"] == "big", "ответ и крупное фото"
        assert oct(os.stat(files[0].parent).st_mode)[-3:] == "700", "папка закрыта"
        # правка сообщения — отдельная строка с пометкой
        tg_archive.maybe_archive({"edited_message": {**_msg(-100555, "исправила")["message"], "edit_date": 1760000100}})
        lines = files[0].read_text(encoding="utf-8").splitlines()
        assert json.loads(lines[-1])["edited"] is True


def test_webhook_silent_in_groups():
    s = (ROOT / "backend/app/api/v1/telegram.py").read_text(encoding="utf-8")
    wh = s[s.index("def telegram_webhook("):]
    assert "tg_archive.maybe_archive(update)" in wh
    i_arch = wh.index("tg_archive.maybe_archive(update)")
    i_empty = wh.index("if not chat_id or not text:")
    assert i_arch < i_empty, "архив — до выхода по «нет текста» (фото без подписи)"
    i_silent = wh.index("if in_group and not first_word:")
    assert i_silent < wh.index("# Fallback for plain text / unknown command"), "в группе — тишина до ответа-заглушки"
    assert wh.index("_handle_reject_reason_reply(session, message)") < i_silent, "причина отказа горячей брони — работает"


def test_retention_and_dump():
    t = (ROOT / "backend/app/services/tg_archive.py").read_text(encoding="utf-8")
    assert "ARCHIVE_KEEP_DAYS = 90" in t
    d = (ROOT / "backend/scripts/tg_archive_dump.py").read_text(encoding="utf-8")
    assert "getFile" in d and "--since" in d


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
