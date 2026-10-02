"""СТОРОЖ · устаревшая вкладка после выкладки (02.10) — «error loading dynamically imported module».

Причина: каждая выкладка целиком заменяет dist, старые чанки (assets/LoginPage-<hash>.js)
исчезают; вкладка, открытая до выкладки, просит старый файл и получает 404. Автовосстановление
знало только Chrome/Safari, Firefox («error loading dynamically imported module») не узнавало,
а /login и часть ленивых маршрутов вообще не были под границей ошибок — клиент видел сырой
текст ошибки в верхнем ErrorBoundary.

Что ловит:
  * isChunkLoadError (utils/chunkRecovery.ts) узнаёт Chrome, Firefox, Safari, Chunk*-ошибки,
    css-предзагрузку и НЕ узнаёт обычные ошибки (node гоняет модуль на примерах).
  * ModuleErrorBoundary и main.tsx пользуются общим хелпером (своей проверки по тексту нет).
  * Есть обработчик vite:preloadError и unhandledrejection (installChunkRecovery вызывается в main.tsx).
  * Верхний ErrorBoundary не показывает сырой текст ошибки в проде (только import.meta.env.DEV).
  * Все ленивые маршруты (в т.ч. /login) лежат под ModuleErrorBoundary в App.tsx.
  * Перезагрузка не чаще раза за окно на всю вкладку (не по pathname) + защита через _cb в адресе.
  * deploy.sh докладывает старые чанки из текущего dist и 3 последних бэкапов без перезаписи.

Без сети и боевой базы (чтение исходников + node ≥ 22.6, если есть):
    python3 backend/tests/guard_stale_chunk_2026_10.py
"""
import json
import pathlib
import re
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).parent.parent.parent
HELPER = "src/utils/chunkRecovery.ts"
BOUNDARY = "src/components/ui/ModuleErrorBoundary.tsx"
MAIN = "src/main.tsx"
APP = "src/App.tsx"
DEPLOY = "scripts/deploy.sh"


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def _code(rel: str) -> str:
    """Без комментариев (// … и /* … */, в т.ч. {/* … */} в JSX)."""
    src = re.sub(r"/\*.*?\*/", lambda m: "\n" * m.group(0).count("\n"), _read(rel), flags=re.S)
    return re.sub(r"(?<![:'\"`\w])//[^\n]*", "", src)


def _node():
    """Путь к node ≥ 22.6 (умеет --experimental-strip-types) или None."""
    node = shutil.which("node")
    if not node:
        return None
    ver = subprocess.run([node, "--version"], capture_output=True, text=True).stdout.strip().lstrip("v")
    try:
        major, minor = (int(x) for x in ver.split(".")[:2])
    except ValueError:
        return None
    return node if (major, minor) >= (22, 6) else None


def _node_run(body: str):
    node = _node()
    if not node:
        return None
    r = subprocess.run([node, "--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", body],
                       capture_output=True, text=True, cwd=str(ROOT), timeout=60)
    assert r.returncode == 0, f"node упал: {r.stderr[:600]}"
    return json.loads(r.stdout.strip().splitlines()[-1])


# ── 1. isChunkLoadError на примерах ──────────────────────────────────────

def test_is_chunk_load_error_examples():
    res = _node_run(f"""
const m = await import('{(ROOT / HELPER).as_posix()}');
const yes = [
  new TypeError('Failed to fetch dynamically imported module: https://unbox.com.ge/assets/LoginPage-BnOMFulb.js'),
  new TypeError('error loading dynamically imported module: https://unbox.com.ge/assets/LoginPage-BnOMFulb.js'),
  new TypeError('TypeError: Error Loading Dynamically Imported Module'),
  new TypeError('Importing a module script failed.'),
  new Error('Loading chunk 42 failed.'),
  new Error('Loading CSS chunk 7 failed.'),
  Object.assign(new Error('x'), {{ name: 'ChunkLoadError' }}),
  new Error('Unable to preload CSS for /assets/index-abc.css'),
  'error loading dynamically imported module: https://x/y.js',
  {{ message: 'Failed to fetch dynamically imported module: /a.js' }},
];
const no = [
  new Error('Cannot read properties of undefined'),
  new TypeError('Failed to fetch'),
  new Error('Network Error'),
  new RangeError('Maximum call stack size exceeded'),
  'что-то сломалось',
  null, undefined, 0, {{}},
];
console.log(JSON.stringify({{ yes: yes.map(m.isChunkLoadError), no: no.map(m.isChunkLoadError) }}));
""")
    if res is None:
        return
    assert all(res["yes"]), f"не узнаны ошибки устаревшего чанка: {res['yes']}"
    assert not any(res["no"]), f"обычные ошибки приняты за чанк: {res['no']}"


def test_helper_static_markers():
    """Те же формулировки видны в исходнике (на случай, если node нет)."""
    src = _read(HELPER).lower()
    for marker in ("failed to fetch dynamically imported module", "error loading dynamically imported module",
                   "importing a module script failed", "loading chunk", "loading css chunk",
                   "chunkloaderror", "unable to preload css"):
        assert marker in src, f"в chunkRecovery нет формулировки «{marker}»"


def test_reload_once_per_tab_with_cb_guard():
    code = _code(HELPER)
    assert "sessionStorage" in code and "RELOAD_WINDOW_MS" in code, "нет окна «не чаще раза» в sessionStorage"
    assert "pathname" not in code, "защита от цикла не должна быть по pathname — разные маршруты зациклятся"
    assert "recentCacheBustInUrl" in code and "searchParams.get(CB_PARAM)" in code, \
        "нет защиты по _cb в адресе (приватный режим без sessionStorage)"
    assert "searchParams.set(CB_PARAM" in code and "window.location.replace" in code, "перезагрузка без cache-bust _cb"
    assert "memoryReloadAt" in code, "нет резервной защиты в памяти"


# ── 2. Хелпер используют и границы ───────────────────────────────────────

def test_boundaries_use_helper():
    b = _code(BOUNDARY)
    assert "from '../../utils/chunkRecovery'" in b and "isChunkLoadError(error)" in b \
        and "reloadOnceForStaleBundle()" in b, "ModuleErrorBoundary не использует общий хелпер"
    assert "dynamically imported" not in b and "unbox_chunk_retry_" not in b, \
        "в ModuleErrorBoundary осталась своя проверка/флаг по pathname"
    m = _code(MAIN)
    assert "from './utils/chunkRecovery'" in m and "isChunkLoadError(" in m and "reloadOnceForStaleBundle()" in m, \
        "main.tsx: верхний ErrorBoundary не использует хелпер"


def test_global_handlers():
    h = _code(HELPER)
    assert "'vite:preloadError'" in h and "event.preventDefault()" in h, "нет обработчика vite:preloadError"
    assert "'unhandledrejection'" in h and "isChunkLoadError(event.reason)" in h, "нет обработки unhandledrejection"
    assert re.search(r"^installChunkRecovery\(\);", _code(MAIN), flags=re.M), "main.tsx не вызывает installChunkRecovery()"


# ── 3. Верхний ErrorBoundary: дружелюбный текст, без сырой ошибки в проде ──

def test_top_error_boundary_friendly_and_no_raw_error_in_prod():
    m = _read(MAIN)
    assert "Вышла новая версия сайта" in m and "Обновляем страницу…" in m, "нет текста про новую версию сайта"
    assert ">\n              Обновить\n" in m, "нет кнопки «Обновить»"
    code = _code(MAIN)
    # Единственное место, где показывается текст ошибки, — под import.meta.env.DEV.
    assert code.count("this.state.error?.toString()") == 1, "сырой текст ошибки выводится не в одном месте"
    pos = code.index("this.state.error?.toString()")
    assert "import.meta.env.DEV &&" in code[max(0, pos - 700):pos], "текст ошибки показан не только в dev"
    assert "Что-то пошло не так 😵" not in m and "Текст ошибки:" in m, "старая заглушка с эмодзи осталась"


# ── 4. Все ленивые маршруты под границей ─────────────────────────────────

def test_routes_under_module_boundary():
    code = _code(APP)
    boundary = code.index('<ModuleErrorBoundary moduleName="Сайт">')
    suspense = code.index("<Suspense fallback={lazyFallback}>")
    routes = code.index("<Routes>")
    routes_end = code.index("</Routes>")
    suspense_end = code.index("</Suspense>", routes_end)
    boundary_end = code.index("</ModuleErrorBoundary>", suspense_end)
    assert boundary < suspense < routes < routes_end < suspense_end < boundary_end, \
        "<Routes> не обёрнут в ModuleErrorBoundary над Suspense"
    assert '<Route path="/login" element={<LoginPage />} />' in code, "маршрут /login пропал"


# ── 5. deploy.sh докладывает старые чанки ────────────────────────────────

def test_deploy_keeps_old_chunks():
    sh = _read(DEPLOY)
    assert "cp -n" in sh and '/assets/.' in sh and "/tmp/dist-new/assets/" in sh, \
        "deploy.sh не докладывает старые assets в новый dist без перезаписи (cp -n)"
    assert "ls -dt $REMOTE_FRONT_DIR-backup-* 2>/dev/null | head -3" in sh, "берутся не 3 последних бэкапа"
    assert "|| true" in sh.split("cp -n", 1)[1].split("done", 1)[0], "cp без `|| true` упадёт под set -e на пустой папке"
    # Докладывание — ДО подмены папки.
    assert sh.index("cp -n") < sh.index("mv /tmp/dist-new $REMOTE_FRONT_DIR"), "старые чанки докладываются после подмены dist"
    assert sh.index("cp -n") > sh.index("tar xzf /tmp/unbox-dist.tgz"), "докладываются до распаковки нового билда"
    assert "-mtime +14 -delete" in sh, "нет отсечки старых чанков (папка будет расти вечно)"


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"  ✓ {name}")
            except Exception as exc:  # noqa: BLE001
                failures += 1
                print(f"  ✗ {name}: {exc!r}")
    print("СТОРОЖ устаревшая вкладка 2026-10: OK" if not failures else f"СТОРОЖ устаревшая вкладка 2026-10 УПАЛ ({failures}) — деплой НЕ выкатывать")
    sys.exit(1 if failures else 0)
