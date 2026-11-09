import clsx from 'clsx';

/**
 * Switch — переключатель «вкл / выкл» (09.11 фаза 3; был локальным в
 * MobileCrmSchedule). Зона нажатия 52×44, дорожка 44×26: включено —
 * бирюза (accent), выключено — ink-20. role="switch" + aria-checked для
 * диктора; подпись — aria-label, если рядом нет видимого текста.
 *
 *   <Switch on={day.enabled} onChange={() => toggle(i)} label="Понедельник — рабочий день" />
 *
 * В строке списка — в action у ListRow (стоит вне нажимаемой части строки).
 */
export interface SwitchProps {
    on: boolean;
    onChange: () => void;
    /** Что переключаем — для диктора. */
    label: string;
    disabled?: boolean;
    className?: string;
}

export function Switch({ on, onChange, label, disabled, className }: SwitchProps) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={label}
            onClick={onChange}
            disabled={disabled}
            className={clsx('ui-switch', className)}
        >
            <span className="ui-switch__track" aria-hidden="true">
                <span className="ui-switch__knob" />
            </span>
        </button>
    );
}
