import {
    createContext, forwardRef, useContext, useId,
    type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react';
import { AlertCircle } from 'lucide-react';
import clsx from 'clsx';

/**
 * Field + Input / TextArea / Select — поле формы (wave 1, 30.09).
 *
 *   <Field label="Сумма" hint="Спишем с баланса" error={errors.amount}>
 *     <Input kind="money" value={amount} onChange={…} suffix="₾" />
 *   </Field>
 *
 * - Подпись всегда видна (не placeholder вместо подписи) и связана с полем.
 * - Подсказка и ошибка — прямо под полем, озвучиваются (aria-describedby),
 *   поле с ошибкой помечено aria-invalid; ошибка говорит, что сделать.
 * - kind подбирает клавиатуру и автозаполнение: money → цифры с запятой,
 *   phone → телефонная, email → почтовая без автозаглавной и т.д.
 * - Высота 44 px на телефоне (36 на компьютере), шрифт 16 px на телефоне —
 *   iOS не зумит страницу при фокусе.
 */
interface FieldCtx {
    id: string;
    describedBy?: string;
    invalid: boolean;
    required?: boolean;
}
const FieldContext = createContext<FieldCtx | null>(null);

export interface FieldProps {
    label: ReactNode;
    hint?: ReactNode;
    /** Текст ошибки: что не так и что сделать («Введите сумму больше 0»). */
    error?: ReactNode;
    /** Покажет «необязательно» рядом с подписью. */
    optional?: boolean;
    required?: boolean;
    /** Свой id для поля (иначе сгенерируем). */
    id?: string;
    className?: string;
    children: ReactNode;
}

export function Field({ label, hint, error, optional, required, id, className, children }: FieldProps) {
    const auto = useId();
    const fieldId = id ?? `f${auto}`;
    const hintId = hint ? `${fieldId}-hint` : undefined;
    const errorId = error ? `${fieldId}-error` : undefined;
    const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;
    return (
        <FieldContext.Provider value={{ id: fieldId, describedBy, invalid: !!error, required }}>
            <div className={clsx('ui-field', className)}>
                <label htmlFor={fieldId} className="ui-field__label">
                    {label}
                    {optional && <span className="ui-field__optional"> · необязательно</span>}
                </label>
                {children}
                {error ? (
                    <div id={errorId} className="ui-field__error" aria-live="polite">
                        <AlertCircle size={16} aria-hidden="true" />
                        <span>{error}</span>
                    </div>
                ) : null}
                {hint && !error ? <div id={hintId} className="ui-field__hint">{hint}</div> : null}
            </div>
        </FieldContext.Provider>
    );
}

/** Тип поля → клавиатура, автозаполнение и прочие атрибуты по умолчанию. */
export type InputKind = 'text' | 'money' | 'integer' | 'phone' | 'email' | 'search' | 'name' | 'password' | 'new-password' | 'time' | 'date';

const KIND_ATTRS: Record<InputKind, InputHTMLAttributes<HTMLInputElement>> = {
    text: { type: 'text' },
    money: { type: 'text', inputMode: 'decimal', autoComplete: 'off', enterKeyHint: 'done' },
    integer: { type: 'text', inputMode: 'numeric', pattern: '[0-9]*', autoComplete: 'off', enterKeyHint: 'done' },
    phone: { type: 'tel', inputMode: 'tel', autoComplete: 'tel' },
    email: { type: 'email', inputMode: 'email', autoComplete: 'email', autoCapitalize: 'none', spellCheck: false },
    search: { type: 'search', inputMode: 'search', enterKeyHint: 'search', autoComplete: 'off' },
    name: { type: 'text', autoComplete: 'name', autoCapitalize: 'words' },
    password: { type: 'password', autoComplete: 'current-password' },
    'new-password': { type: 'password', autoComplete: 'new-password' },
    time: { type: 'time' },
    date: { type: 'date' },
};

function useFieldProps(id?: string, ariaDescribedBy?: string, ariaInvalid?: InputHTMLAttributes<HTMLInputElement>['aria-invalid']) {
    const ctx = useContext(FieldContext);
    return {
        id: id ?? ctx?.id,
        'aria-describedby': [ariaDescribedBy, ctx?.describedBy].filter(Boolean).join(' ') || undefined,
        'aria-invalid': ariaInvalid ?? (ctx?.invalid ? true : undefined),
        required: ctx?.required,
    };
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
    kind?: InputKind;
    /** Единица справа внутри поля: «₾», «мин», «ч». */
    suffix?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
    { kind = 'text', suffix, className, id, 'aria-describedby': dby, 'aria-invalid': inv, required, ...rest },
    ref,
) {
    const f = useFieldProps(id, dby, inv);
    const input = (
        <input
            ref={ref}
            {...KIND_ATTRS[kind]}
            {...f}
            required={required ?? f.required}
            className={clsx('ui-input', suffix && 'ui-input--with-suffix', (kind === 'money' || kind === 'integer') && 'tabular-nums', className)}
            {...rest}
        />
    );
    if (!suffix) return input;
    return (
        <div className="ui-input-wrap">
            {input}
            <span className="ui-input__suffix" aria-hidden="true">{suffix}</span>
        </div>
    );
});

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea(
    { className, id, 'aria-describedby': dby, 'aria-invalid': inv, required, ...rest },
    ref,
) {
    const f = useFieldProps(id, dby, inv);
    return <textarea ref={ref} {...f} required={required ?? f.required} className={clsx('ui-input', className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
    { className, id, 'aria-describedby': dby, 'aria-invalid': inv, required, children, ...rest },
    ref,
) {
    const f = useFieldProps(id, dby, inv);
    return (
        <select ref={ref} {...f} required={required ?? f.required} className={clsx('ui-input', className)} {...rest}>
            {children}
        </select>
    );
});
