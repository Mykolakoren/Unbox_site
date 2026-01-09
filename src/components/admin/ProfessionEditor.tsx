import { useState, useEffect } from 'react';
import { Check, X, Briefcase, ChevronDown } from 'lucide-react';


interface ProfessionEditorProps {
    value?: string;
    onChange: (value: string) => void;
}

const PROFESSIONS = [
    'Психолог',
    'Психотерапевт',
    'Коуч',
    'Тренер',
    'Педагог'
];

export function ProfessionEditor({ value, onChange }: ProfessionEditorProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [selectedType, setSelectedType] = useState('');
    const [customValue, setCustomValue] = useState('');

    useEffect(() => {
        if (value) {
            if (PROFESSIONS.includes(value)) {
                setSelectedType(value);
                setCustomValue('');
            } else {
                setSelectedType('other');
                setCustomValue(value);
            }
        } else {
            setSelectedType('');
            setCustomValue('');
        }
    }, [value, isEditing]);

    const handleSave = () => {
        const finalValue = selectedType === 'other' ? customValue : selectedType;
        if (finalValue.trim()) {
            onChange(finalValue.trim());
        }
        setIsEditing(false);
    };

    if (isEditing) {
        return (
            <div className="bg-gray-50 p-2 rounded-lg border border-gray-200 animate-in fade-in zoom-in-95 duration-200">
                <select
                    value={selectedType}
                    onChange={(e) => {
                        setSelectedType(e.target.value);
                        if (e.target.value !== 'other') {
                            setCustomValue('');
                        }
                    }}
                    className="w-full text-sm p-1.5 rounded border border-gray-200 mb-2 focus:outline-none focus:ring-2 focus:ring-black"
                    autoFocus
                >
                    <option value="">Выберите...</option>
                    {PROFESSIONS.map(p => (
                        <option key={p} value={p}>{p}</option>
                    ))}
                    <option value="other">Другое (ввести вручную)</option>
                </select>

                {selectedType === 'other' && (
                    <input
                        type="text"
                        value={customValue}
                        onChange={(e) => setCustomValue(e.target.value)}
                        placeholder="Название профессии..."
                        className="w-full text-sm p-1.5 rounded border border-gray-200 mb-2 focus:outline-none focus:ring-2 focus:ring-black"
                    />
                )}

                <div className="flex gap-2">
                    <button
                        onClick={handleSave}
                        className="flex-1 bg-black text-white text-xs py-1 rounded hover:bg-gray-800 transition-colors flex items-center justify-center gap-1"
                    >
                        <Check size={12} />
                        Сохранить
                    </button>
                    <button
                        onClick={() => setIsEditing(false)}
                        className="flex-1 bg-white border border-gray-200 text-gray-600 text-xs py-1 rounded hover:bg-gray-50 transition-colors flex items-center justify-center gap-1"
                    >
                        <X size={12} />
                        Отмена
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div
            onClick={() => setIsEditing(true)}
            className="group cursor-pointer flex items-center gap-2 py-1 hover:bg-gray-50 rounded-md transition-colors -ml-1 pl-1"
        >
            <Briefcase size={16} className="text-gray-400" />
            <div className="flex-1 font-medium text-gray-700 text-sm">
                {value || <span className="text-gray-400 italic font-normal">Не указана</span>}
            </div>
            <ChevronDown size={14} className="text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
    );
}
