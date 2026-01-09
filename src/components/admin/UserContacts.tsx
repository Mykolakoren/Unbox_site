import { useState } from 'react';
import { Plus, X, Globe, Phone, Mail, MessageCircle, Send, Instagram } from 'lucide-react';
import { useUserStore } from '../../store/userStore';
import { Button } from '../ui/Button';

interface UserContactsProps {
    email: string;
    contacts: { type: string; value: string }[];
}

const CONTACT_TYPES = [
    { id: 'telegram', name: 'Telegram', icon: Send },
    { id: 'instagram', name: 'Instagram', icon: Instagram },
    { id: 'whatsapp', name: 'WhatsApp', icon: MessageCircle },
    { id: 'phone', name: 'Телефон (доп)', icon: Phone },
    { id: 'email', name: 'Email (доп)', icon: Mail },
    { id: 'other', name: 'Другое', icon: Globe },
];

export function UserContacts({ email, contacts }: UserContactsProps) {
    const { updateUserById } = useUserStore();
    const [isAdding, setIsAdding] = useState(false);
    const [newType, setNewType] = useState('telegram');
    const [newValue, setNewValue] = useState('');

    const handleAdd = () => {
        if (!newValue.trim()) return;

        const newContact = { type: newType, value: newValue.trim() };
        const updatedContacts = [...contacts, newContact];

        updateUserById(email, { additionalContacts: updatedContacts });
        setNewValue('');
        setIsAdding(false);
    };

    const handleRemove = (index: number) => {
        const updatedContacts = contacts.filter((_, i) => i !== index);
        updateUserById(email, { additionalContacts: updatedContacts });
    };

    const getIcon = (typeId: string) => {
        const type = CONTACT_TYPES.find(t => t.id === typeId);
        return type ? type.icon : Globe;
    };

    const getLink = (type: string, value: string) => {
        switch (type) {
            case 'telegram': return `https://t.me/${value.replace('@', '')}`;
            case 'instagram': return `https://instagram.com/${value.replace('@', '')}`;
            case 'whatsapp': return `https://wa.me/${value.replace(/[^0-9]/g, '')}`;
            case 'phone': return `tel:${value}`;
            case 'email': return `mailto:${value}`;
            default: return null;
        }
    };

    return (
        <div className="bg-white p-6 rounded-2xl border border-gray-200">
            <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
                <Globe size={20} className="text-gray-400" />
                Контакты
            </h3>

            <div className="space-y-3 mb-4">
                {contacts.length === 0 && !isAdding && (
                    <span className="text-gray-400 text-sm italic">Нет дополнительных контактов</span>
                )}

                {contacts.map((contact, index) => {
                    const Icon = getIcon(contact.type);
                    const link = getLink(contact.type, contact.value);

                    return (
                        <div key={index} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg group">
                            <div className="flex items-center gap-3 overflow-hidden">
                                <div className="bg-white p-1.5 rounded-md text-gray-500 shadow-sm shrink-0">
                                    <Icon size={16} />
                                </div>
                                <div className="truncate">
                                    <div className="text-xs text-gray-400 font-medium capitalize">
                                        {CONTACT_TYPES.find(t => t.id === contact.type)?.name || contact.type}
                                    </div>
                                    {link ? (
                                        <a href={link} target="_blank" rel="noopener noreferrer" className="text-sm font-medium hover:text-blue-600 hover:underline truncate block">
                                            {contact.value}
                                        </a>
                                    ) : (
                                        <div className="text-sm font-medium truncate">{contact.value}</div>
                                    )}
                                </div>
                            </div>
                            <button
                                onClick={() => handleRemove(index)}
                                className="text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all p-1"
                            >
                                <X size={16} />
                            </button>
                        </div>
                    );
                })}
            </div>

            {!isAdding ? (
                <button
                    onClick={() => setIsAdding(true)}
                    className="w-full py-2 rounded-xl border border-dashed border-gray-300 text-gray-500 hover:border-gray-400 hover:text-black transition-colors flex items-center justify-center gap-2 text-sm"
                >
                    <Plus size={16} />
                    Добавить контакт
                </button>
            ) : (
                <div className="bg-gray-50 p-3 rounded-xl animate-in fade-in zoom-in duration-200 border border-gray-200">
                    <div className="grid grid-cols-1 gap-3 mb-3">
                        <select
                            value={newType}
                            onChange={(e) => setNewType(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-black bg-white"
                        >
                            {CONTACT_TYPES.map(type => (
                                <option key={type.id} value={type.id}>{type.name}</option>
                            ))}
                        </select>
                        <input
                            type="text"
                            placeholder={newType === 'telegram' || newType === 'instagram' ? '@username' : 'Значение...'}
                            value={newValue}
                            onChange={(e) => setNewValue(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                            autoFocus
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handleAdd();
                                if (e.key === 'Escape') setIsAdding(false);
                            }}
                        />
                    </div>
                    <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => setIsAdding(false)} className="flex-1">
                            Отмена
                        </Button>
                        <Button variant="primary" size="sm" onClick={handleAdd} className="flex-1">
                            Сохранить
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
