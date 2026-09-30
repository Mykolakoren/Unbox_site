#!/usr/bin/env bash
# Превью фото кабинетов (волна 2, пакет B; X5-17).
#
# Оригиналы public/img/cabinets/<центр>/<папка>/NN.jpg (1280×960, ~150–190 КБ)
# показывались даже в миниатюрах 36–72 px. Скрипт кладёт рядом уменьшенные
# WebP-копии, оригиналы НЕ трогает:
#   <папка>/sm/NN.webp — 360 px по ширине (миниатюры, превью в списках)
#   <папка>/md/NN.webp — 800 px по ширине (лента фото, карточки, hero на телефоне)
# Как фронт выбирает копию — src/utils/cabinetPhotos.ts (photoVariant).
#
# Запуск из корня репозитория:  ./scripts/make-cabinet-previews.sh
# Повторный запуск пересоздаёт только отсутствующие/устаревшие копии.
# Нужен cwebp (brew install webp); без него — sips (JPEG вместо WebP не делаем,
# чтобы пути не разъехались, — просто выходим с ошибкой).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASE="$ROOT/public/img/cabinets"
command -v cwebp >/dev/null || { echo "Нужен cwebp: brew install webp" >&2; exit 1; }

made=0
while IFS= read -r src; do
    dir="$(dirname "$src")"
    name="$(basename "$src" .jpg)"
    for spec in "sm:360:72" "md:800:74"; do
        IFS=: read -r size width quality <<< "$spec"
        out="$dir/$size/$name.webp"
        if [[ -f "$out" && "$out" -nt "$src" ]]; then continue; fi
        mkdir -p "$dir/$size"
        cwebp -quiet -q "$quality" -resize "$width" 0 "$src" -o "$out"
        made=$((made + 1))
    done
done < <(find "$BASE" -type f -name '[0-9][0-9].jpg' -not -path '*/sm/*' -not -path '*/md/*' | sort)

echo "Готово: создано $made файлов превью."
du -sh "$BASE"
