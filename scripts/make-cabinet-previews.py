#!/usr/bin/env python3
"""Превью фото кабинетов (волна 2, пакет B; X5-17).

Оригиналы public/img/cabinets/<центр>/<папка>/NN.jpg (1280×960, ~150–190 КБ)
показывались даже в миниатюрах 36–72 px. Скрипт кладёт рядом уменьшенные
WebP-копии, оригиналы НЕ трогает:
    <папка>/sm/NN.webp — 360 px по ширине (миниатюры, строки списков)
    <папка>/md/NN.webp — 800 px по ширине (лента фото, карточки, hero на телефоне)
Как фронт выбирает копию — src/utils/cabinetPhotos.ts (photoVariant).

Поворот. Многие кадры сняты телефоном «боком»: пиксели лежат горизонтально,
а правильное положение записано в EXIF (Orientation = 6/8/3). Браузер у JPEG
это учитывает, а cwebp — нет, и превью выходили повёрнутыми. Поэтому сначала
поворачиваем пиксели через sips (macOS), потом уменьшаем и жмём cwebp.

Запуск из корня репозитория:  python3 scripts/make-cabinet-previews.py [--force]
Нужны cwebp (brew install webp) и sips (есть в macOS).
"""
import os
import shutil
import struct
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join(ROOT, 'public', 'img', 'cabinets')
SIZES = (('sm', 360, 72), ('md', 800, 74))
ROTATE = {3: 180, 6: 90, 8: 270}   # EXIF Orientation → градусы по часовой (sips -r)


def exif_orientation(path: str) -> int:
    """Orientation из EXIF (1 — как есть). Маленький разбор JPEG APP1 без библиотек."""
    with open(path, 'rb') as f:
        data = f.read(128 * 1024)
    if data[:2] != b'\xff\xd8':
        return 1
    i = 2
    while i + 4 <= len(data) and data[i] == 0xFF:
        marker = data[i + 1]
        size = struct.unpack('>H', data[i + 2:i + 4])[0]
        if marker == 0xE1 and data[i + 4:i + 10] == b'Exif\x00\x00':
            tiff = i + 10
            endian = '<' if data[tiff:tiff + 2] == b'II' else '>'
            ifd = tiff + struct.unpack(endian + 'I', data[tiff + 4:tiff + 8])[0]
            count = struct.unpack(endian + 'H', data[ifd:ifd + 2])[0]
            for k in range(count):
                e = ifd + 2 + k * 12
                tag = struct.unpack(endian + 'H', data[e:e + 2])[0]
                if tag == 0x0112:
                    return struct.unpack(endian + 'H', data[e + 8:e + 10])[0]
            return 1
        if marker == 0xDA:   # начались данные изображения — EXIF уже не будет
            break
        i += 2 + size
    return 1


def main() -> int:
    if not shutil.which('cwebp') or not shutil.which('sips'):
        print('Нужны cwebp (brew install webp) и sips (macOS)', file=sys.stderr)
        return 1
    force = '--force' in sys.argv
    made = rotated = 0
    with tempfile.TemporaryDirectory() as tmp:
        for dirpath, dirnames, filenames in os.walk(BASE):
            dirnames[:] = [d for d in dirnames if d not in ('sm', 'md')]
            for name in sorted(filenames):
                if not (len(name) == 6 and name[:2].isdigit() and name.endswith('.jpg')):
                    continue
                src = os.path.join(dirpath, name)
                stem = name[:-4]
                todo = []
                for size, width, quality in SIZES:
                    out = os.path.join(dirpath, size, stem + '.webp')
                    if force or not os.path.exists(out) or os.path.getmtime(out) < os.path.getmtime(src):
                        todo.append((out, width, quality))
                if not todo:
                    continue
                source = src
                deg = ROTATE.get(exif_orientation(src))
                if deg:
                    source = os.path.join(tmp, 'rot.jpg')
                    subprocess.run(['sips', '-r', str(deg), src, '--out', source,
                                    '-s', 'formatOptions', '100'], check=True, capture_output=True)
                    rotated += 1
                for out, width, quality in todo:
                    os.makedirs(os.path.dirname(out), exist_ok=True)
                    subprocess.run(['cwebp', '-quiet', '-q', str(quality), '-resize', str(width), '0',
                                    '-metadata', 'none', source, '-o', out], check=True)
                    made += 1
    print(f'Готово: создано {made} файлов превью (повёрнуто по EXIF: {rotated} исходников).')
    return 0


if __name__ == '__main__':
    sys.exit(main())
