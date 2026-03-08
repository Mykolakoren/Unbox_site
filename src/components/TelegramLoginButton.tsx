import { Send } from 'lucide-react';

interface TelegramLoginButtonProps {
    botName: string;
    onAuth?: (user: any) => void;
    buttonSize?: 'large' | 'medium' | 'small';
    cornerRadius?: number;
    requestAccess?: boolean;
    usePic?: boolean;
}

export const TelegramLoginButton = ({
    botName,
}: TelegramLoginButtonProps) => {

    const handleClick = () => {
        // Build the callback URL dynamically based on current origin
        const origin = window.location.origin;
        const callbackUrl = `${origin}/api/v1/auth/telegram/callback`;

        // Listen for the popup closing or receiving a message
        const checkPopup = setInterval(() => {
            // Check if token appeared in localStorage (set by the redirected page)
            const token = localStorage.getItem('token');
            if (token) {
                clearInterval(checkPopup);
                window.location.href = '/dashboard';
            }
        }, 500);

        // Open Telegram OAuth in a popup window
        const width = 550;
        const height = 470;
        const left = Math.round((window.screen.width / 2) - (width / 2));
        const top = Math.round((window.screen.height / 2) - (height / 2));

        const authUrl = `https://oauth.telegram.org/auth?bot_id=${botName}&origin=${encodeURIComponent(origin)}&embed=0&request_access=write&return_to=${encodeURIComponent(callbackUrl)}`;

        const popup = window.open(
            authUrl,
            'telegram_auth',
            `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no,scrollbars=no,resizable=no`
        );

        // Also check if popup was closed
        const checkClosed = setInterval(() => {
            if (popup && popup.closed) {
                clearInterval(checkClosed);
                clearInterval(checkPopup);
            }
        }, 1000);

        // Auto-cleanup after 5 minutes
        setTimeout(() => {
            clearInterval(checkPopup);
            clearInterval(checkClosed);
        }, 300000);
    };

    return (
        <button
            type="button"
            onClick={handleClick}
            className="flex items-center gap-2 px-6 py-2.5 bg-[#54A9EB] hover:bg-[#4A96D2] text-white font-medium rounded-lg transition-all duration-200 hover:shadow-md active:scale-[0.98]"
        >
            <Send size={18} />
            <span>Войти через Telegram</span>
        </button>
    );
};
