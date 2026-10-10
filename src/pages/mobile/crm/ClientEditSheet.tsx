import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { crmApi, type CrmClient } from '../../../api/crm';
import { Sheet } from '../../../components/ui/Sheet';
import { Button } from '../../../components/ui/Button';
import { Field, Input, Select } from '../../../components/ui/Field';
import { AccountSelect } from '../../../components/crm/AccountSelect';
import { CURRENCIES } from '../../../utils/currency';
import { toastApiError } from '../../../utils/errors';
import { STATUS } from '../../../design/tokens';

type ApplyPriceTo = 'none' | 'all_unpaid' | 'future_only';

/**
 * Правка клиента на телефоне — те же поля, что на компьютере
 * (CrmClientDetail «Профиль»), кроме кода клиента: по коду синк находит
 * события в календаре, менять его с телефона на бегу рискованно.
 *
 * Обход мобильной версии 10.10: в карточке на телефоне не было ни правки,
 * ни «Вернуть в работу» — клиента на паузе (Евгения Третяк) с телефона
 * было не вернуть.
 */
export function ClientEditSheet({ open, client, onClose, onSaved }: {
    open: boolean;
    client: CrmClient;
    onClose: () => void;
    /** reloadSessions — цену применили к сессиям, карточке нужно перечитать их. */
    onSaved: (updated: CrmClient, reloadSessions: boolean) => void;
}) {
    const initial = () => ({
        name: client.name,
        phone: client.phone || '',
        email: client.email || '',
        telegram: client.telegram || '',
        basePrice: client.basePrice ? String(client.basePrice) : '',
        currency: client.currency || 'GEL',
        defaultAccount: client.defaultAccount || 'cash',
        tags: (client.tags || []).join(', '),
    });
    const [form, setForm] = useState(initial);
    const [applyPriceTo, setApplyPriceTo] = useState<ApplyPriceTo>('none');
    const [saving, setSaving] = useState(false);

    // Каждое открытие — с текущих данных клиента.
    useEffect(() => {
        if (open) { setForm(initial()); setApplyPriceTo('none'); }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, client.id]);

    const price = form.basePrice.trim() ? Number(form.basePrice.replace(',', '.')) : 0;
    const priceBad = form.basePrice.trim() !== '' && !(Number.isFinite(price) && price >= 0);
    const moneyChanged = String(price) !== String(client.basePrice || 0)
        || form.currency !== (client.currency || 'GEL')
        || form.defaultAccount !== (client.defaultAccount || 'cash');

    const save = async () => {
        if (!form.name.trim() || priceBad || saving) return;
        setSaving(true);
        try {
            const tags = form.tags.split(',').map(t => t.trim()).filter(Boolean);
            const apply = moneyChanged && applyPriceTo !== 'none' ? applyPriceTo : undefined;
            // Ставку, валюту и счёт шлём, только если их поменяли: смена запускает
            // на сервере «заморозку» прошлых сессий (clients.update_client).
            const patch: Parameters<typeof crmApi.updateClient>[1] = {
                name: form.name.trim(),
                phone: form.phone.trim(),
                email: form.email.trim(),
                telegram: form.telegram.trim(),
                tags,
            };
            if (String(price) !== String(client.basePrice || 0)) patch.basePrice = price;
            if (form.currency !== (client.currency || 'GEL')) patch.currency = form.currency;
            if (form.defaultAccount !== (client.defaultAccount || 'cash')) patch.defaultAccount = form.defaultAccount;
            const updated = await crmApi.updateClient(client.id, patch, apply);
            toast.success('Клиент обновлён');
            onSaved(updated, !!apply);
        } catch (e) {
            toastApiError(e, 'Не удалось сохранить. Проверьте поля и попробуйте ещё раз');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Sheet
            open={open}
            onClose={onClose}
            title="Изменить клиента"
            footer={
                <>
                    <Button block loading={saving} disabled={!form.name.trim() || priceBad} onClick={save}>Сохранить</Button>
                    <Button block variant="secondary" onClick={onClose}>Не сохранять</Button>
                </>
            }
        >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <Field label="Имя" required>
                    <Input kind="name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                </Field>
                <Field label="Телефон" optional>
                    <Input kind="phone" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+995 555 00 00 00" />
                </Field>
                <Field label="Telegram" optional>
                    <Input value={form.telegram} onChange={e => setForm(f => ({ ...f, telegram: e.target.value }))} placeholder="@username" />
                </Field>
                <Field label="E-mail" optional>
                    <Input kind="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                </Field>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <Field label="Ставка" error={priceBad ? 'Введите сумму числом' : undefined}>
                            <Input kind="money" value={form.basePrice} onChange={e => setForm(f => ({ ...f, basePrice: e.target.value }))} placeholder="0" />
                        </Field>
                    </div>
                    <Field label="Валюта">
                        <Select value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}>
                            {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.symbol} {c.code}</option>)}
                        </Select>
                    </Field>
                </div>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14, fontWeight: 500 }}>
                    Счёт по умолчанию
                    <AccountSelect className="ui-input" value={form.defaultAccount} onChange={v => setForm(f => ({ ...f, defaultAccount: v }))} />
                </label>
                <Field label="Теги" hint="Через запятую: тревога, пары, онлайн" optional>
                    <Input value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))} />
                </Field>
                {moneyChanged && (
                    <div role="radiogroup" aria-labelledby="m-apply-price-title" style={{ padding: 12, background: STATUS.pending.bg, borderRadius: 10 }}>
                        <div id="m-apply-price-title" style={{ fontSize: 14, fontWeight: 600, color: STATUS.pending.fg, marginBottom: 2 }}>
                            Новая ставка — к каким сессиям?
                        </div>
                        {([
                            { value: 'none', label: 'Только к новым сессиям' },
                            { value: 'future_only', label: 'Ко всем запланированным' },
                            { value: 'all_unpaid', label: 'Ко всем неоплаченным' },
                        ] as const).map(opt => (
                            <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: STATUS.pending.fg, minHeight: 44 }}>
                                <input type="radio" name="mApplyPriceTo" checked={applyPriceTo === opt.value} onChange={() => setApplyPriceTo(opt.value)} />
                                {opt.label}
                            </label>
                        ))}
                    </div>
                )}
            </div>
        </Sheet>
    );
}
