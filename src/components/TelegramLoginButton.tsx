import { useState } from 'react';
import { Send } from 'lucide-react';
import { Button } from './ui/Button';

interface TelegramLoginButtonProps {
    botName: string;
    onAuth?: (user: any) => void;
    buttonSize?: 'large' | 'medium' | 'small';
    cornerRadius?: number;
    requestAccess?: boolean;
    usePic?: boolean;
    /** Во всю ширину колонки — как кнопка Google над ней (G1-16). */
    block?: boolean;
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
    block = false,
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
        // Wave 1 (X4-15, G1-16): белый текст на голубом #54A9EB давал 2.5:1.
        // Теперь общая кнопка с рамкой и значком Telegram — как в Grid House.
        <Button
            variant="secondary"
            size="touch"
            block={block}
            onClick={handleClick}
            loading={isLoading}
            icon={<Send size={18} aria-hidden="true" />}
        >
            {isLoading ? 'Переходим в Telegram…' : 'Войти через Telegram'}
        </Button>
    );
};
