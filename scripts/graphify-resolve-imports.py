"""Разрешение пофайловых узлов-импортов в графе UnboxCRM.

Запускать из корня репозитория ПОСЛЕ извлечения, но ДО сборки графа — то есть
между записью graphify-out/.graphify_extract.json и вызовом build_from_json.
Скрипт правит .graphify_extract.json на месте. Без него каждая перестройка графа
через /graphify заново расплодит фантомы, описанные ниже.

Проблема. AST-экстрактор заводит отдельный узел на КАЖДЫЙ импортированный символ
в КАЖДОМ файле. Поэтому `User` существует 39 раз (по разу на файл, который его
импортирует) — и ни один из этих 39 не связан ребром с настоящей моделью
backend/app/models/user.py. Все 197 рёбер «кто использует User» висят на
фантомах, а модель про своих потребителей не знает.

Что делает проход:
  1. MERGE  — фантом, у которого ровно одно определение в той же половине кода
              (backend/*.py или src/*.ts), сливается в это определение.
              Половина кода учитывается специально: `User` определён ДВАЖДЫ —
              как SQLModel-модель в бэкенде и как TS-тип в src/store/types.ts.
              Слияние по одному лишь имени склеило бы фронт с бэком.
  2. DROP   — фантом без определения в репозитории (Session, SQLModel, datetime,
              Any, BaseModel, UUID, Depends) — это символы библиотек и stdlib.
              Они есть в каждом эндпоинте, архитектурного сигнала не несут,
              а одна лишь `Session` собрала бы вокруг себя пол-бэкенда.
  3. KEEP   — фантом с несколькими кандидатами не трогаем: молчаливое слияние
              здесь опаснее шума.
"""
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

EXTRACT = Path("graphify-out/.graphify_extract.json")

data = json.loads(EXTRACT.read_text(encoding="utf-8"))
nodes, edges = data["nodes"], data["edges"]
by_id = {n["id"]: n for n in nodes}


def side(source_file: str | None) -> str | None:
    """Половина кода: у backend и frontend бывают одноимённые сущности."""
    if not source_file:
        return None
    if source_file.startswith("backend/"):
        return "backend"
    if source_file.startswith("src/"):
        return "frontend"
    return "other"


# Файлы, в которых встречается фантом — по его рёбрам (у самого фантома файла нет).
owners = defaultdict(set)
for e in edges:
    for a, b in ((e["source"], e["target"]), (e["target"], e["source"])):
        if a in by_id and not by_id[a].get("source_file"):
            other = by_id.get(b)
            if other and other.get("source_file"):
                owners[a].add(other["source_file"])

# Индекс определений: (label, side) -> [узлы с файлом]
defs = defaultdict(list)
for n in nodes:
    if n.get("source_file"):
        defs[(n["label"], side(n["source_file"]))].append(n)

phantoms = [n for n in nodes if not n.get("source_file")]
remap: dict[str, str] = {}   # phantom_id -> canonical_id
drop: set[str] = set()
keep: list[str] = []

for p in phantoms:
    sides = {side(f) for f in owners.get(p["id"], set())}
    if len(sides) != 1:
        keep.append(p["id"])
        continue
    cands = defs.get((p["label"], sides.pop()), [])
    if len(cands) == 1:
        remap[p["id"]] = cands[0]["id"]
    elif len(cands) == 0:
        drop.add(p["id"])
    else:
        keep.append(p["id"])

print(f"фантомных узлов-импортов: {len(phantoms)}")
print(f"  MERGE в каноническое определение : {len(remap)}")
print(f"  DROP как внешние библиотеки      : {len(drop)}")
print(f"  KEEP (неоднозначные, не трогаем) : {len(keep)}")
print()
print("  сливаются:", Counter(by_id[p]["label"] for p in remap).most_common(8))
print("  выбрасываются:", Counter(by_id[p]["label"] for p in drop).most_common(8))
print()

# --- переписываем узлы -------------------------------------------------------
new_nodes = [n for n in nodes if n["id"] not in remap and n["id"] not in drop]

# --- переписываем рёбра ------------------------------------------------------
new_edges = []
seen: set[tuple] = set()
self_loops = 0
for e in edges:
    s = remap.get(e["source"], e["source"])
    t = remap.get(e["target"], e["target"])
    if s in drop or t in drop:
        continue
    if s == t:                      # слияние может породить петлю — она бессмысленна
        self_loops += 1
        continue
    key = (s, t, e.get("relation"))
    if key in seen:                 # и параллельные дубли тоже
        continue
    seen.add(key)
    e = dict(e, source=s, target=t)
    new_edges.append(e)

# --- гиперрёбра --------------------------------------------------------------
new_hyper = []
for h in data.get("hyperedges", []):
    ns = [remap.get(x, x) for x in h.get("nodes", []) if remap.get(x, x) not in drop]
    ns = list(dict.fromkeys(ns))
    if len(ns) >= 3:
        new_hyper.append(dict(h, nodes=ns))

print(f"узлы : {len(nodes)} -> {len(new_nodes)}")
print(f"рёбра: {len(edges)} -> {len(new_edges)}  (петель убрано: {self_loops}, дублей: {len(edges)-len(new_edges)-self_loops-0})")
print(f"гиперрёбра: {len(data.get('hyperedges', []))} -> {len(new_hyper)}")
print()

# --- контроль: не осиротили ли реальный код ---------------------------------
alive = {n["id"] for n in new_nodes}
deg = Counter()
for e in new_edges:
    deg[e["source"]] += 1
    deg[e["target"]] += 1
isolated = [by_id[i] for i in alive if deg[i] == 0]
iso_code = [n for n in isolated if n.get("source_file")]
print(f"КОНТРОЛЬ: изолированных узлов после прохода: {len(isolated)} (из них с реальным файлом: {len(iso_code)})")

# Ключевая проверка: модель User должна была собрать рёбра всех своих потребителей.
for canon in ("backend_app_models_user_user", "backend_app_models_booking_booking"):
    if canon in alive:
        print(f"  {by_id[canon]['label']:<10} ({by_id[canon]['source_file']}): степень теперь {deg[canon]}")

data["nodes"], data["edges"], data["hyperedges"] = new_nodes, new_edges, new_hyper
EXTRACT.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
print("\nзаписано в", EXTRACT)
