import type { ReactNode } from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '../../../components/ui/Field';

/**
 * Поиск в мобильной CRM (09.11 фаза 3, дизайн-ревью п. 16): ОДИН вид на
 * «Клиентах», «Сессиях» и «Заметках» — общее поле Input kind="search"
 * (клавиатура «Найти», 44 px, 16 px — iOS не зумит), серая подложка sunken
 * без рамки, лупа слева, «×» 44 px справа, когда есть текст. Справа можно
 * поставить своё действие (`trailing`, например глаз «Скрывать текст»).
 */
export function CrmSearch({ value, onChange, label, placeholder, trailing }: {
    value: string;
    onChange: (v: string) => void;
    /** Подпись для диктора: «Поиск клиента: имя, код или телефон». */
    label: string;
    placeholder: string;
    trailing?: ReactNode;
}) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
                <Search
                    size={16}
                    aria-hidden="true"
                    style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-ink-60)', pointerEvents: 'none' }}
                />
                <Input
                    kind="search"
                    // Клавиатура «Найти» остаётся (inputMode/enterKeyHint от kind), но без
                    // встроенного крестика браузера — иначе рядом с нашим «×» их два.
                    type="text"
                    value={value}
                    onChange={e => onChange(e.target.value)}
                    aria-label={label}
                    placeholder={placeholder}
                    style={{
                        paddingLeft: 36,
                        paddingRight: value ? 44 : undefined,
                        background: 'var(--color-sunken)',
                        borderColor: 'transparent',
                    }}
                />
                {value && (
                    <button
                        type="button"
                        onClick={() => onChange('')}
                        aria-label="Очистить поиск"
                        style={{
                            position: 'absolute', right: 0, top: 0, width: 44, height: '100%',
                            display: 'grid', placeItems: 'center',
                            background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-ink-60)',
                        }}
                    >
                        <X size={16} aria-hidden="true" />
                    </button>
                )}
            </div>
            {trailing}
        </div>
    );
}
