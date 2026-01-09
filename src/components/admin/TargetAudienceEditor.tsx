import { useState } from 'react';
import { Users, Check, X, ChevronDown } from 'lucide-react';

interface TargetAudienceEditorProps {
    value?: string[];
    onChange: (value: string[]) => void;
}

const AUDIENCE_OPTIONS = [
    'Детьми',
    'Подростками',
    'Взрослыми',
    'Семьями',
    'Парами'
];

export function TargetAudienceEditor({ value = [], onChange }: TargetAudienceEditorProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [selected, setSelected] = useState<string[]>(value || []);

    const toggleOption = (option: string) => {
        if (selected.includes(option)) {
            setSelected(selected.filter(i => i !== option));
        } else {
            setSelected([...selected, option]);
        }
    };

    const handleSave = () => {
        onChange(selected);
        setIsEditing(false);
    };

    const handleCancel = () => {
        setSelected(value || []);
        setIsEditing(false);
    };

    if (isEditing) {
        return (
            <div className="bg-gray-50 p-2 rounded-lg border border-gray-200 animate-in fade-in zoom-in-95 duration-200">
                <div className="space-y-1 mb-2 max-h-48 overflow-y-auto">
                    {AUDIENCE_OPTIONS.map(option => (
                        <label key={option} className="flex items-center gap-2 p-1.5 hover:bg-white rounded cursor-pointer text-sm">
                            <input
                                type="checkbox"
                                checked={selected.includes(option)}
                                onChange={() => toggleOption(option)}
                                className="rounded border-gray-300 text-black focus:ring-black"
                            />
                            <span>{option}</span>
                        </label>
                    ))}
                </div>

                <div className="flex gap-2">
                    <button
                        onClick={handleSave}
                        className="flex-1 bg-black text-white text-xs py-1 rounded hover:bg-gray-800 transition-colors flex items-center justify-center gap-1"
                    >
                        <Check size={12} />
                        Сохранить
                    </button>
                    <button
                        onClick={handleCancel}
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
            onClick={() => {
                setSelected(value || []);
                setIsEditing(true);
            }}
            className="group cursor-pointer flex items-start gap-2 py-1 hover:bg-gray-50 rounded-md transition-colors -ml-1 pl-1"
        >
            <Users size={16} className="text-gray-400 mt-0.5" />
            <div className="flex-1 text-sm">
                {(!value || value.length === 0) ? (
                    <span className="text-gray-400 italic font-normal">Не указано</span>
                ) : (
                    <div className="flex flex-wrap gap-1">
                        {value.map(item => (
                            <span key={item} className="bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded text-xs font-medium">
                                {item}
                            </span>
                        ))}
                    </div>
                )}
            </div>
            <ChevronDown size={14} className="text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity mt-1" />
        </div>
    );
}
