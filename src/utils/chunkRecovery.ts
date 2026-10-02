/**
 * Восстановление после выкладки: вкладка открыта давно, а на сервере уже
 * новая версия сайта. Файлы-«чанки» с хэшами в именах (assets/LoginPage-xxxx.js)
 * при выкладке заменяются, и старая вкладка получает 404 вместо нужного файла.
 * Браузеры сообщают об этом по-разному (Chrome, Firefox, Safari) — распознаём
 * все формулировки и один раз перезагружаем страницу за свежей версией.
 */

/** Не чаще одного авто-перезапуска за это время (на всю вкладку, а не на маршрут). */
const RELOAD_WINDOW_MS = 3 * 60 * 1000;
const STORAGE_KEY = 'unbox_chunk_reload_at';
const CB_PARAM = '_cb';

/** Фрагменты сообщений (в нижнем регистре) о недогруженном файле сайта. */
const CHUNK_ERROR_MARKERS = [
  'failed to fetch dynamically imported module', // Chrome, Edge
  'error loading dynamically imported module',   // Firefox
  'importing a module script failed',            // Safari
  'loading chunk',
  'loading css chunk',
  'chunkloaderror',
  'unable to preload css',
];

/** Это ошибка «не загрузился файл сайта» (устаревшая вкладка), а не обычный сбой кода? */
export function isChunkLoadError(err: unknown): boolean {
  if (err == null) return false;
  const parts: string[] = [];
  if (typeof err === 'string') {
    parts.push(err);
  } else if (typeof err === 'object') {
    const e = err as { message?: unknown; name?: unknown };
    if (typeof e.message === 'string') parts.push(e.message);
    if (typeof e.name === 'string') parts.push(e.name);
    try { parts.push(String(err)); } catch { /* объект без toString */ }
  }
  const text = parts.join(' | ').toLowerCase();
  return CHUNK_ERROR_MARKERS.some((m) => text.includes(m));
}

// Если sessionStorage недоступен (приватный режим) — хотя бы в рамках одной загрузки страницы.
let memoryReloadAt = 0;
let reloadScheduled = false;

function readStoredAt(): number {
  try {
    return Number(sessionStorage.getItem(STORAGE_KEY)) || 0;
  } catch {
    return 0;
  }
}

/** Когда в адресе уже стоит свежий _cb — значит, мы только что перезагружались. */
function recentCacheBustInUrl(now: number): boolean {
  try {
    const cb = Number(new URL(window.location.href).searchParams.get(CB_PARAM));
    return cb > 0 && now - cb < RELOAD_WINDOW_MS;
  } catch {
    return false;
  }
}

/**
 * Один раз перезагрузить вкладку за новой версией сайта.
 * Возвращает true, если перезагрузка запущена; false — если недавно уже
 * перезагружали (защита от бесконечного цикла) и надо показать ошибку как есть.
 */
export function reloadOnceForStaleBundle(): boolean {
  if (reloadScheduled) return true;
  const now = Date.now();
  const last = Math.max(memoryReloadAt, readStoredAt());
  if ((last && now - last < RELOAD_WINDOW_MS) || recentCacheBustInUrl(now)) return false;

  reloadScheduled = true;
  memoryReloadAt = now;
  try {
    sessionStorage.setItem(STORAGE_KEY, String(now));
  } catch { /* приватный режим: защитят память и _cb в адресе */ }

  // Небольшая пауза, чтобы экран «Обновляем страницу…» успел показаться.
  setTimeout(() => {
    // Новый адрес (_cb) выбивает старый index.html из кэша и из bfcache iOS Safari —
    // иначе вкладка снова подтянет старую версию с теми же битыми ссылками.
    const url = new URL(window.location.href);
    url.searchParams.set(CB_PARAM, String(Date.now()));
    window.location.replace(url.toString());
  }, 250);
  return true;
}

/** Глобальные ловушки: предзагрузка чанка Vite и ленивый import() вне React. Вызвать один раз при старте. */
export function installChunkRecovery(): void {
  window.addEventListener('vite:preloadError', (event) => {
    // Если перезагрузка запущена — гасим ошибку; если уже перезагружали — пусть всплывёт как обычно.
    if (reloadOnceForStaleBundle()) event.preventDefault();
  });
  window.addEventListener('unhandledrejection', (event) => {
    if (isChunkLoadError(event.reason) && reloadOnceForStaleBundle()) event.preventDefault();
  });
}
