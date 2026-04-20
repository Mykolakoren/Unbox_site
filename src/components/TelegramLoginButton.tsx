import { useEffect, useRef, useState } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface TelegramLoginButtonProps {
    botName: string;
    onAuth?: (user: any) => void;
    buttonSize?: 'large' | 'medium' | 'small';
    cornerRadius?: number;
    requestAccess?: boolean;
    usePic?: boolean;
}

/**
 * Telegram OAuth login via popup window.
 *
 * Flow:
 *   1. User clicks → we open Telegram OAuth popup pointing at our /telegram/callback.
 *   2. Backend callback writes the token to localStorage and tries window.close().
 *   3. We poll localStorage every 500ms in this parent window. As soon as the token
 *      appears, we navigate to /dashboard.
 *   4. We also watch the popup handle. If user closes it manually without finishing,
 *      we reset state so the button is clickable again.
 *
 * Why all the state machinery: previous version had three real bugs that bit admins
 * in the wild —
 *   • Multiple clicks spawned duplicate intervals → memory leak + race conditions.
 *   • window.close() is silently blocked in some Chromium contexts → popup stayed
 *     open, the named-window reuse meant the next click landed in a dead window.
 *   • popup === null (popup blocker) was never handled → button looked unresponsive.
 *
 * The `isLoading` flag + ref-tracked popup handle + interval cleanup fix all three.
 */
export const TelegramLoginButton = ({
    botName,
}: TelegramLoginButtonProps) => {
    const [isLoading, setIsLoading] = useState(false);
    const popupRef = useRef<Window | null>(null);
    const pollIntervalRef = useRef<number | null>(null);
    const closedIntervalRef = useRef<number | null>(null);
    const cleanupTimeoutRef = useRef<number | null>(null);
    const messageHandlerRef = useRef<((event: MessageEvent) => void) | null>(null);

    const cleanup = () => {
        if (pollIntervalRef.current != null) {
            window.clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
        }
        if (closedIntervalRef.current != null) {
            window.clearInterval(closedIntervalRef.current);
            closedIntervalRef.current = null;
        }
        if (cleanupTimeoutRef.current != null) {
            window.clearTimeout(cleanupTimeoutRef.current);
            cleanupTimeoutRef.current = null;
        }
        if (messageHandlerRef.current) {
            window.removeEventListener('message', messageHandlerRef.current);
            messageHandlerRef.current = null;
        }
        // Try to close popup if it's still alive — be defensive, this can throw
        // if the popup is from a different origin.
        try {
            if (popupRef.current && !popupRef.current.closed) {
                popupRef.current.close();
            }
        } catch {
            // ignore
        }
        popupRef.current = null;
        setIsLoading(false);
    };

    // Make sure we don't leak intervals if the user navigates away mid-auth.
    useEffect(() => () => cleanup(), []);

    const handleClick = () => {
        // Guard against double-clicks.
        if (isLoading) return;

        // If a popup is somehow still alive, kill it before opening a new one.
        // This is the bug that bit admins: if window.close() failed last time, the
        // named window 'telegram_auth' is still alive and would be reused, taking
        // them back to wherever the dead session left off.
        if (popupRef.current && !popupRef.current.closed) {
            try { popupRef.current.close(); } catch { /* ignore */ }
            popupRef.current = null;
        }

        setIsLoading(true);

        const origin = window.location.origin;
        const callbackUrl = `${origin}/api/v1/auth/telegram/callback`;

        const width = 550;
        const height = 470;
        const left = Math.round((window.screen.width / 2) - (width / 2));
        const top = Math.round((window.screen.height / 2) - (height / 2));

        const authUrl = `https://oauth.telegram.org/auth?bot_id=${botName}&origin=${encodeURIComponent(origin)}&embed=0&request_access=write&return_to=${encodeURIComponent(callbackUrl)}`;

        // Use a unique window name each time — prevents the named-window reuse bug.
        const popup = window.open(
            authUrl,
            `telegram_auth_${Date.now()}`,
            `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no,scrollbars=no,resizable=no`
        );

        // Popup blocker hit: nothing opened. Show a clear error and stop.
        if (!popup) {
            setIsLoading(false);
            toast.error('Браузер заблокировал всплывающее окно. Разрешите всплывающие окна для этого сайта и попробуйте снова.');
            return;
        }

        popupRef.current = popup;

        // Snapshot current token (if any) so we react only to a fresh write.
        const tokenBefore = localStorage.getItem('token');

        // Most reliable signal: callback page posts a message to window.opener.
        // Fires before any polling tick and works even if popup blocker delayed
        // window.open. cleanup() removes the listener via messageHandlerRef.
        const messageHandler = (event: MessageEvent) => {
            if (event.origin !== window.location.origin) return;
            const data = event.data;
            if (data && data.type === 'telegram-auth-success' && data.token) {
                try { localStorage.setItem('token', data.token); } catch { /* ignore */ }
                cleanup();
                window.location.href = '/dashboard';
            }
        };
        messageHandlerRef.current = messageHandler;
        window.addEventListener('message', messageHandler);

        // Poll for token written by /telegram/callback. Belt-and-braces in case
        // postMessage was blocked (e.g. opener relationship lost).
        pollIntervalRef.current = window.setInterval(() => {
            const token = localStorage.getItem('token');
            if (token && token !== tokenBefore) {
                cleanup();
                window.location.href = '/dashboard';
            }
        }, 500);

        // Watch popup state. If the user closes the popup without finishing, reset.
        closedIntervalRef.current = window.setInterval(() => {
            if (popup.closed) {
                // Give the polling one last shot — token may have been written
                // moments before the close fired.
                const token = localStorage.getItem('token');
                if (token && token !== tokenBefore) {
                    cleanup();
                    window.location.href = '/dashboard';
                } else {
                    cleanup();
                }
            }
        }, 500);

        // Hard timeout: 5 minutes. If the user wandered off, free everything up.
        cleanupTimeoutRef.current = window.setTimeout(() => {
            const token = localStorage.getItem('token');
            if (token && token !== tokenBefore) {
                cleanup();
                window.location.href = '/dashboard';
            } else {
                cleanup();
                toast.info('Время авторизации истекло. Попробуйте снова.');
            }
        }, 5 * 60 * 1000);
    };

    return (
        <button
            type="button"
            onClick={handleClick}
            disabled={isLoading}
            className="flex items-center gap-2 px-6 py-2.5 bg-[#54A9EB] hover:bg-[#4A96D2] disabled:bg-[#54A9EB]/60 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-all duration-200 hover:shadow-md active:scale-[0.98]"
        >
            {isLoading ? (
                <>
                    <Loader2 size={18} className="animate-spin" />
                    <span>Ожидание...</span>
                </>
            ) : (
                <>
                    <Send size={18} />
                    <span>Войти через Telegram</span>
                </>
            )}
        </button>
    );
};
