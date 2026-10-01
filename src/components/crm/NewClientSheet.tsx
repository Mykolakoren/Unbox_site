import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown, RefreshCw } from 'lucide-react';
import { Sheet } from '../ui/Sheet';
import { Button } from '../ui/Button';
import { Field, Input, Select } from '../ui/Field';
import { formatPhone } from '../ui/PhoneInput';
import { crmApi, type CrmClient } from '../../api/crm';
import { useCrmStore } from '../../store/crmStore';
import { toastApiError } from '../../utils/errors';
import { formatMoney } from '../../utils/format';
import { generateAliasCode } from '../../utils/crmNextSession';

/**
 * NewClientSheet — «Новый клиент» (волна 3, шаг 0). Телефон и компьютер.
 *
 *   <NewClientSheet open={open} onClose={…} onCreated={(client) => …} />
 *
 * - Поля: имя, телефон, Telegram, код, ставка и валюта; под «Ещё» — e-mail,
 *   теги, счёт по умолчанию.
 * - Код (решение В2): сразу свободный 4-значный (generateAliasCode), его можно
 *   поменять. Синк Google Календаря узнаёт клиента по «#XXXX» в названии
 *   события, а сервер код на уникальность не проверяет — поэтому занятый код
 *   (в т.ч. у слитой карточки) не пускаем.
 * - Пишет ТОЛЬКО существующим createClient. После успеха — onCreated(client);
 *   обновить список — дело родителя.
 */
export interface NewClientSheetProps {
    open: boolean;
    onClose: () => void;
    onCreated: (client: CrmClient) => void;
    /** Свои клиенты — чтобы код не совпал. Нет — из стора, там пусто — загрузим. */
    clients?: CrmClient[];
    /** Имя заранее (например, из поиска «Никого не нашли»). */
    initialName?: string;
    /** false — без тоста «Клиент добавлен»: родитель покажет свой. */
    successToast?: boolean;
}

// Свой список, а не utils/currency.ts: тот при импорте ходит за курсами.
const CURRENCY_CODES = ['GEL', 'USD', 'EUR', 'RUB', 'USDT'] as const;

function currencySymbol(code: string): string {
    return formatMoney(0, { currency: code }).replace(/^0[\s ]*/, '');
}

/** Коды клиента: свой и коды слитых в него карточек. */
function codesOf(c: CrmClient): string[] {
    const merged = (c as CrmClient & { mergedAliasCodes?: string[] | null }).mergedAliasCodes ?? [];
    return [c.aliasCode ?? '', ...merged].filter(Boolean);
}

export function NewClientSheet({
    open, onClose, onCreated, clients: clientsProp, initialName = '', successToast = true,
}: NewClientSheetProps) {
    const storeClients = useCrmStore(s => s.clients);
    const paymentAccounts = useCrmStore(s => s.paymentAccounts);
    const viewingOther = useCrmStore(s => !!s.viewAsSpecialistId);
    const [loaded, setLoaded] = useState<CrmClient[] | null>(null);

    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [telegram, setTelegram] = useState('');
    const [alias, setAlias] = useState('');
    const [aliasTouched, setAliasTouched] = useState(false);
    const [basePrice, setBasePrice] = useState('');
    const [currency, setCurrency] = useState('GEL');
    const [more, setMore] = useState(false);
    const [email, setEmail] = useState('');
    const [tags, setTags] = useState('');
    const [account, setAccount] = useState('cash');
    const [errors, setErrors] = useState<{ name?: string; alias?: string; price?: string }>({});
    const [saving, setSaving] = useState(false);
    const savingRef = useRef(false);

    const allClients = clientsProp ?? (storeClients.length ? storeClients : loaded ?? []);
    const codeOwner = useMemo(() => {
        const m = new Map<string, string>();
        for (const c of allClients) for (const code of codesOf(c)) if (!m.has(code)) m.set(code, c.name);
        return m;
    }, [allClients]);

    // Открыли — чистая форма; список клиентов подтянем, если его нет.
    useEffect(() => {
        if (!open) return;
        setName(initialName);
        setPhone(''); setTelegram(''); setBasePrice(''); setCurrency('GEL');
        setMore(false); setEmail(''); setTags('');
        setAccount(paymentAccounts[0]?.id ?? 'cash');
        setErrors({});
        setAliasTouched(false);
        setAlias('');
        let alive = true;
        if (!clientsProp && !storeClients.length) {
            crmApi.getClients(false).then(list => { if (alive) setLoaded(list); }).catch(() => {});
        }
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // Свободный код — сразу и заново, когда узнали чужие коды (пока не правили руками).
    useEffect(() => {
        if (!open || aliasTouched) return;
        setAlias(prev => (prev && !codeOwner.has(prev) ? prev : generateAliasCode(codeOwner.keys())));
    }, [open, aliasTouched, codeOwner]);

    const regenerate = () => {
        setAlias(generateAliasCode(codeOwner.keys()));
        setAliasTouched(true);
        setErrors(e => ({ ...e, alias: undefined }));
    };

    const submit = async () => {
        if (savingRef.current) return;
        const next: typeof errors = {};
        const nm = name.trim();
        if (!nm) next.name = 'Введите имя клиента';
        const code = alias.trim().replace(/^#/, '');
        if (code && !/^\d{4}$/.test(code)) next.alias = 'Код — ровно 4 цифры, например 4821';
        else if (code && codeOwner.has(code)) next.alias = `Код #${code} уже у клиента ${codeOwner.get(code)} — возьмите другой`;
        const priceNum = basePrice.trim() === '' ? undefined : Number(basePrice.replace(',', '.'));
        if (priceNum !== undefined && (!Number.isFinite(priceNum) || priceNum < 0)) next.price = 'Введите ставку числом, например 140';
        setErrors(next);
        if (Object.keys(next).length) return;

        const tagList = tags.split(',').map(t => t.trim()).filter(Boolean);
        savingRef.current = true;
        setSaving(true);
        try {
            const client = await crmApi.createClient({
                name: nm,
                phone: phone.trim() || undefined,
                telegram: telegram.trim() || undefined,
                email: email.trim() || undefined,
                aliasCode: code || undefined,
                basePrice: priceNum,
                currency,
                defaultAccount: account,
                tags: tagList.length ? tagList : undefined,
            });
            if (successToast) toast.success(`Клиент добавлен: ${client.name}`);
            onCreated(client);
            onClose();
        } catch (e) {
            toastApiError(e, 'Не удалось добавить клиента');
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    };

    const shownName = name.trim().split(/\s+/)[0] || 'Анна';
    const shownCode = /^\d{4}$/.test(alias.trim()) ? alias.trim() : '4821';

    return (
        <Sheet
            open={open}
            onClose={() => { if (!saving) onClose(); }}
            title="Новый клиент"
            width={480}
            footer={(
                <>
                    <Button block loading={saving} disabled={!name.trim() || viewingOther} onClick={submit}>
                        Добавить клиента
                    </Button>
                    <Button block variant="secondary" disabled={saving} onClick={onClose}>
                        Не добавлять
                    </Button>
                </>
            )}
        >
            <form
                onSubmit={e => { e.preventDefault(); submit(); }}
                style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
            >
                {viewingOther && (
                    <div role="status" style={{
                        padding: '10px 12px', borderRadius: 'var(--radius-control)',
                        background: 'var(--status-pending-bg)', color: 'var(--status-pending-fg)', fontSize: 'var(--text-small)',
                    }}>
                        Вы смотрите чужой кабинет — добавлять клиентов здесь нельзя.
                    </div>
                )}
                <Field label="Имя" required error={errors.name}>
                    <Input kind="name" value={name} onChange={e => setName(e.target.value)} placeholder="Имя клиента" />
                </Field>
                <Field label="Телефон" optional>
                    <Input kind="phone" value={phone} onChange={e => setPhone(formatPhone(e.target.value))} placeholder="+995 555 00 00 00" />
                </Field>
                <Field label="Telegram" optional>
                    <Input value={telegram} onChange={e => setTelegram(e.target.value)} placeholder="@username" autoCapitalize="none" spellCheck={false} />
                </Field>
                <Field
                    label="Код для календаря"
                    error={errors.alias}
                    hint={`В Google Календаре пишите «${shownName} #${shownCode}» — так сессия попадёт к этому клиенту`}
                >
                    <div style={{ display: 'flex', gap: 8 }}>
                        <Input
                            kind="integer"
                            maxLength={4}
                            value={alias}
                            onChange={e => { setAlias(e.target.value.replace(/\D/g, '').slice(0, 4)); setAliasTouched(true); setErrors(x => ({ ...x, alias: undefined })); }}
                            style={{ flex: 1, minWidth: 0 }}
                        />
                        <Button variant="secondary" icon={<RefreshCw size={16} aria-hidden="true" />} onClick={regenerate}>
                            Другой код
                        </Button>
                    </div>
                </Field>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)', gap: 12 }}>
                    <Field label="Ставка за сессию" error={errors.price}>
                        <Input kind="money" value={basePrice} onChange={e => setBasePrice(e.target.value)} placeholder="0" suffix={currencySymbol(currency)} />
                    </Field>
                    <Field label="Валюта">
                        <Select value={currency} onChange={e => setCurrency(e.target.value)}>
                            {CURRENCY_CODES.map(c => <option key={c} value={c}>{`${c} (${currencySymbol(c)})`}</option>)}
                        </Select>
                    </Field>
                </div>

                <Button
                    variant="quiet"
                    aria-expanded={more}
                    iconRight={<ChevronDown size={16} aria-hidden="true" style={{ transform: more ? 'rotate(180deg)' : undefined }} />}
                    onClick={() => setMore(v => !v)}
                    style={{ alignSelf: 'flex-start' }}
                >
                    Ещё: e-mail, теги, счёт
                </Button>
                {more && (
                    <>
                        <Field label="E-mail" optional>
                            <Input kind="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com" />
                        </Field>
                        <Field label="Теги" optional hint="Через запятую: тревога, пары, онлайн">
                            <Input value={tags} onChange={e => setTags(e.target.value)} />
                        </Field>
                        <Field label="Счёт по умолчанию" hint="Сюда записываем оплату в один тап">
                            <Select value={account} onChange={e => setAccount(e.target.value)}>
                                {paymentAccounts.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
                            </Select>
                        </Field>
                    </>
                )}
                {/* Enter в поле отправляет форму */}
                <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
            </form>
        </Sheet>
    );
}
