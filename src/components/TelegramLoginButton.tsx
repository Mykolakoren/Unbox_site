import { useState } from 'react';
import { Send, Loader2 } from 'lucide-react';

interface TelegramLoginButtonProps {
    botName: string;
    onAuth?: (user: any) => void;
    buttonSize?: 'large' | 'medium' | 'small';
    cornerRadius?: number;
    requestAccess?: boolean;
    usePic?: boolean;
}

/**
 * Telegram OAuth login — full-page redirect flow (the standard).
 *
 * Why we left the popup approach:
 *
 * Modern browsers (Safari 16+, Chrome 109+, Firefox 117+) tightened
 * cross-origin isolation rules. When a popup goes through a different
 * origin and back to ours (oauth.telegram.org → unbox.com.ge), three
 * things break in random combinations depending on the browser:
 *
 *   1. window.opener is severed (COOP defaults), so the popup can't
 *      postMessage back to the parent.
 *   2. localStorage is partitioned per top-level origin chain, so what
 *      the popup writes might not be visible to the parent.
 *   3. window.close() is silently blocked unless the script literally
 *      opened that window in the same task — and Telegram's redirect
 *      breaks that chain.
 *
 * Result: admin would auth in the bot, the popup would write the token
 * to its own localStorage partition, then sit there forever — parent
 * never sees anything, eventually times out.
 *
 * Full-page redirect (this implementation) is what Google, GitHub,
 * Apple and every other major OAuth provider uses, for exactly the
 * same reasons. Trade-off: user briefly sees Telegram's auth page,
 * then a "✓ Авторизация" page, then their dashboard. No popups, no
 * COOP fights, no localStorage races.
 */
export const TelegramLoginButton = ({
    botName,
}: TelegramLoginButtonProps) => {
    const [isLoading, setIsLoading] = useState(false);

    const handleClick = () => {
        if (isLoading) return;
        setIsLoading(true);

        const origin = window.location.origin;
        const callbackUrl = `${origin}/api/v1/auth/telegram/callback`;
        const authUrl =
            `https://oauth.telegram.org/auth?bot_id=${botName}` +
            `&origin=${encodeURIComponent(origin)}` +
            `&embed=0&request_access=write` +
            `&return_to=${encodeURIComponent(callbackUrl)}`;

        // Full-page navigation. After auth, Telegram redirects the SAME tab
        // to our callback, which sets the token and redirects to /dashboard.
        window.location.href = authUrl;
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
                    <span>Переход в Telegram...</span>
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
