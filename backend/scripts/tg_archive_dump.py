"""Выгрузка архива чата админов для чтения (services/tg_archive.py, 09.10).

Только чтение архива + скачивание скриншотов через Bot API (getFile).

    cd /var/www/unbox/backend
    PYTHONPATH=. venv/bin/python3 scripts/tg_archive_dump.py --since 2026-10-09 [--media /tmp/tg_media]

Печатает переписку по порядку: время (Тбилиси), автор, на что ответ, текст,
пометки о фото/файлах. С --media качает фото в папку и печатает путь.
"""
import argparse
import glob
import json
import os
import sys
from datetime import date, datetime, timedelta, timezone

import requests

from app.core.config import settings
from app.services.tg_archive import archive_dir, archive_chat_ids

TZ = timedelta(hours=4)


def _download(file_id: str, folder: str, stem: str) -> str:
    token = settings.TELEGRAM_BOT_TOKEN
    r = requests.get(f"https://api.telegram.org/bot{token}/getFile", params={"file_id": file_id}, timeout=15)
    path = r.json()["result"]["file_path"]
    ext = os.path.splitext(path)[1] or ".jpg"
    out = os.path.join(folder, f"{stem}{ext}")
    if not os.path.exists(out):
        data = requests.get(f"https://api.telegram.org/file/bot{token}/{path}", timeout=30).content
        with open(out, "wb") as f:
            f.write(data)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default=(datetime.now(timezone.utc) + TZ - timedelta(days=1)).date().isoformat())
    ap.add_argument("--until", default=None)
    ap.add_argument("--media", default=None, help="папка для скриншотов")
    a = ap.parse_args()
    since = date.fromisoformat(a.since)
    until = date.fromisoformat(a.until) if a.until else date.max
    if a.media:
        os.makedirs(a.media, exist_ok=True)
    chats = [c.lstrip("-") for c in archive_chat_ids()] or [os.path.basename(p) for p in glob.glob(os.path.join(archive_dir(), "*"))]
    total = 0
    for chat in chats:
        files = sorted(glob.glob(os.path.join(archive_dir(), chat, "*.jsonl")))
        for fn in files:
            d = date.fromisoformat(os.path.basename(fn)[:10])
            if not (since <= d <= until):
                continue
            print(f"\n══ {d.strftime('%d.%m.%Y')} ══")
            for line in open(fn, encoding="utf-8"):
                m = json.loads(line)
                t = (datetime.fromtimestamp(m["ts"], tz=timezone.utc) + TZ).strftime("%H:%M") if m.get("ts") else "--:--"
                head = f"[{t}] {m.get('from') or '?'}"
                if m.get("edited"):
                    head += " (изменено)"
                if m.get("forward_from"):
                    head += f" [переслано от {m['forward_from']}]"
                print(head + ":")
                rt = m.get("reply_to")
                if rt:
                    print(f"    ↩ в ответ {rt.get('from')}: «{(rt.get('text') or ('[фото]' if rt.get('has_photo') else ''))[:160]}»")
                if m.get("text"):
                    for tl in m["text"].splitlines():
                        print("    " + tl)
                if m.get("photo_file_id"):
                    if a.media:
                        try:
                            print("    [фото] " + _download(m["photo_file_id"], a.media, f"{d}_{t.replace(':', '')}_{m['message_id']}"))
                        except Exception as e:  # noqa: BLE001
                            print(f"    [фото — не скачалось: {e}]")
                    else:
                        print("    [фото]")
                if m.get("document"):
                    doc = m["document"]
                    if a.media and doc.get("file_id"):
                        try:
                            print(f"    [файл {doc.get('name')}] " + _download(doc["file_id"], a.media, f"{d}_{m['message_id']}_doc"))
                        except Exception as e:  # noqa: BLE001
                            print(f"    [файл {doc.get('name')} — не скачался: {e}]")
                    else:
                        print(f"    [файл {doc.get('name')}]")
                if m.get("voice"):
                    print("    [голосовое — прослушать не могу]")
                total += 1
    print(f"\nсообщений: {total}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
