import React, { useState, useEffect } from 'react';
import { Button } from './Button';
import { AlertTriangle, X } from 'lucide-react';
import { createPortal } from 'react-dom';

interface ConfirmationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    message: React.ReactNode;
    confirmLabel?: string;
    cancelLabel?: string;
    isDestructive?: boolean;
}

export function ConfirmationModal({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    confirmLabel = 'Подтвердить',
    cancelLabel = 'Отмена',
    isDestructive = false
}: ConfirmationModalProps) {
    if (!isOpen) return null;

    return createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
                onClick={onClose}
            />

            {/* Modal */}
            <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 animate-in zoom-in-95 duration-200 transform">
                {/* Close Button */}
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-unbox-grey hover:text-unbox-dark transition-colors"
                >
                    <X size={20} />
                </button>

                <div className="flex flex-col items-center text-center">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-4 ${isDestructive ? 'bg-red-100 text-red-600' : 'bg-unbox-light text-unbox-green'}`}>
                        <AlertTriangle size={24} />
                    </div>

                    <h3 className="text-xl font-bold text-unbox-dark mb-2">
                        {title}
                    </h3>

                    <div className="text-unbox-grey mb-6 text-sm leading-relaxed">
                        {message}
                    </div>

                    <div className="flex gap-3 w-full">
                        <Button
                            variant="outline"
                            className="flex-1"
                            onClick={onClose}
                        >
                            {cancelLabel}
                        </Button>
                        <Button
                            variant={isDestructive ? 'ghost' : 'primary'}
                            className={`flex-1 ${isDestructive ? 'bg-red-600 text-white hover:bg-red-700 hover:text-white' : ''}`}
                            onClick={() => {
                                onConfirm();
                                onClose();
                            }}
                        >
                            {confirmLabel}
                        </Button>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
}


// ─── PromptModal — replacement for native prompt() ──────────────────────────

interface PromptModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (value: string) => void;
    title: string;
    message?: React.ReactNode;
    inputLabel?: string;
    inputType?: string;
    defaultValue?: string;
    placeholder?: string;
    submitLabel?: string;
    cancelLabel?: string;
    validate?: (value: string) => string | null;  // return error message or null
}

export function PromptModal({
    isOpen,
    onClose,
    onSubmit,
    title,
    message,
    inputLabel,
    inputType = 'text',
    defaultValue = '',
    placeholder,
    submitLabel = 'Сохранить',
    cancelLabel = 'Отмена',
    validate,
}: PromptModalProps) {
    const [value, setValue] = useState(defaultValue);
    const [error, setError] = useState<string | null>(null);

    // Reset value when modal opens with new default
    useEffect(() => {
        if (isOpen) {
            setValue(defaultValue);
            setError(null);
        }
    }, [isOpen, defaultValue]);

    if (!isOpen) return null;

    const handleSubmit = () => {
        if (validate) {
            const err = validate(value);
            if (err) {
                setError(err);
                return;
            }
        }
        onSubmit(value);
        onClose();
    };

    return createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
                className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
                onClick={onClose}
            />
            <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 animate-in zoom-in-95 duration-200 transform">
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-unbox-grey hover:text-unbox-dark transition-colors"
                >
                    <X size={20} />
                </button>

                <h3 className="text-xl font-bold text-unbox-dark mb-2">{title}</h3>
                {message && <div className="text-unbox-grey mb-4 text-sm">{message}</div>}

                <div className="mb-4">
                    {inputLabel && <label className="block text-sm font-medium text-unbox-dark mb-1">{inputLabel}</label>}
                    <input
                        type={inputType}
                        value={value}
                        onChange={(e) => { setValue(e.target.value); setError(null); }}
                        onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                        placeholder={placeholder}
                        autoFocus
                        className="w-full px-4 py-3 rounded-xl border border-unbox-light focus:outline-none focus:ring-2 focus:ring-unbox-green text-sm"
                    />
                    {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
                </div>

                <div className="flex gap-3 w-full">
                    <Button variant="outline" className="flex-1" onClick={onClose}>
                        {cancelLabel}
                    </Button>
                    <Button variant="primary" className="flex-1" onClick={handleSubmit}>
                        {submitLabel}
                    </Button>
                </div>
            </div>
        </div>,
        document.body
    );
}
