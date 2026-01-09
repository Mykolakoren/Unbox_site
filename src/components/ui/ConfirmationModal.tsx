import React from 'react';
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
                    className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
                >
                    <X size={20} />
                </button>

                <div className="flex flex-col items-center text-center">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-4 ${isDestructive ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>
                        <AlertTriangle size={24} />
                    </div>

                    <h3 className="text-xl font-bold text-gray-900 mb-2">
                        {title}
                    </h3>

                    <div className="text-gray-500 mb-6 text-sm leading-relaxed">
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
