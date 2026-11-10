import { useEffect, useRef, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { COLOR, FONT, Z } from '../design/tokens';

/**
 * «Сайт обновился — обновите страницу» (10.11, владелец).
 *
 * Вкладка, открытая до выкладки, продолжает работать старым кодом, а сервер
 * уже новый: 09.11 сервер стал требовать причину поздней отмены, а у админа
 * со старой вкладкой поля для неё не было. Сборка кладёт свой номер в код
 * (VITE_BUILD_ID) и в /version.json; раз в 5 минут и при возврате на вкладку
 * сверяем их. Разошлись — плашка с кнопкой «Обновить». Только на проде.
 */
const CHECK_EVERY_MS = 5 * 60 * 1000;
const SNOOZE_MS = 30 * 60 * 1000;
const MY_BUILD = String(import.meta.env.VITE_BUILD_ID || '');

export async function fetchServerBuild(): Promise<string | null> {
    try {
        const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!r.ok) return null;
        const data = await r.json();
        return typeof data?.build === 'string' && data.build ? data.build : null;
    } catch {
        return null; // нет сети, файла или вместо него пришла страница — молчим
    }
}

export function UpdateBanner() {
    const [stale, setStale] = useState(false);
    const snoozedUntil = useRef(0);

    useEffect(() => {
        if (!import.meta.env.PROD || !MY_BUILD) return;
        let alive = true;
        const check = async () => {
            if (Date.now() < snoozedUntil.current) return;
            const server = await fetchServerBuild();
            if (alive && server && server !== MY_BUILD) setStale(true);
        };
        const onVisible = () => { if (document.visibilityState === 'visible') void check(); };
        const timer = window.setInterval(check, CHECK_EVERY_MS);
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('focus', onVisible);
        return () => {
            alive = false;
            window.clearInterval(timer);
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('focus', onVisible);
        };
    }, []);

    if (!stale) return null;
    return (
        <div
            role="status"
            className="fixed left-1/2 -translate-x-1/2 bottom-24 md:bottom-6 w-[calc(100%-32px)] max-w-md"
            style={{ zIndex: Z.toast, fontFamily: FONT.sans }}
        >
            <div
                className="flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg"
                style={{ background: COLOR.accentFill, color: '#fff' }}
            >
                <div className="flex-1 text-[15px] leading-snug">
                    <b>Сайт обновился.</b> Обновите страницу, чтобы работать в новой версии.
                </div>
                <button
                    type="button"
                    onClick={() => window.location.reload()}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[14px] font-semibold"
                    style={{ background: '#fff', color: COLOR.accentInk }}
                >
                    <RefreshCw size={16} aria-hidden="true" /> Обновить
                </button>
                <button
                    type="button"
                    aria-label="Напомнить позже"
                    title="Напомнить позже"
                    onClick={() => { snoozedUntil.current = Date.now() + SNOOZE_MS; setStale(false); }}
                    className="p-1 rounded-md opacity-80 hover:opacity-100"
                >
                    <X size={18} aria-hidden="true" />
                </button>
            </div>
        </div>
    );
}
