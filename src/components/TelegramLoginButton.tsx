import { useEffect, useRef } from 'react';

interface TelegramLoginButtonProps {
    botName: string;
    onAuth: (user: any) => void;
    buttonSize?: 'large' | 'medium' | 'small';
    cornerRadius?: number;
    requestAccess?: boolean;
    usePic?: boolean;
}

export const TelegramLoginButton = ({
    botName,
    onAuth,
    buttonSize = 'large',
    cornerRadius = 12,
    requestAccess = true,
    usePic = true
}: TelegramLoginButtonProps) => {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!containerRef.current) return;

        // Prevent duplicate buttons
        if (containerRef.current.innerHTML !== '') return;

        const script = document.createElement('script');
        script.src = 'https://telegram.org/js/telegram-widget.js?22';
        script.setAttribute('data-telegram-login', botName);
        script.setAttribute('data-size', buttonSize);
        script.setAttribute('data-radius', cornerRadius.toString());
        if (requestAccess) script.setAttribute('data-request-access', 'write');
        script.setAttribute('data-userpic', usePic.toString().toLowerCase());
        script.setAttribute('data-onauth', 'onTelegramAuth(user)');
        script.async = true;

        // Define global callback
        (window as any).onTelegramAuth = (user: any) => {
            onAuth(user);
        };

        containerRef.current.appendChild(script);

        return () => {
            // cleanup if needed (though global callback might persist)
        };
    }, [botName, buttonSize, cornerRadius, requestAccess, usePic, onAuth]);

    return (
        <div
            ref={containerRef}
            className="flex justify-center min-h-[40px] w-full items-center"
        >
            {/* Script will inject button here */}
        </div>
    );
};
