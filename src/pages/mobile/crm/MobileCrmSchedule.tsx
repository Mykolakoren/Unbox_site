import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarOff, Plus, Save, Trash2, CalendarClock } from 'lucide-react';
import type { DayRange, DaySchedule, GridHouseCrmScheduleProps, OverrideEntry } from '../../crm/CrmSchedule';
import { LOCATIONS } from '../../../utils/data';
import { formatDateLabel, formatDayMonth } from '../../../utils/format';
import { Button } from '../../../components/ui/Button';
import { Switch } from '../../../components/ui/Switch';
import { Segmented } from '../../../components/ui/Chip';
import { EmptyState } from '../../../components/ui/EmptyState';
import { Field, Input, Select } from '../../../components/ui/Field';
import { ListGroup, ListRow, ListTime } from '../../../components/ui/ListRow';
import { MobilePageHeader } from '../../../components/ui/PageHeader';
import { Sheet } from '../../../components/ui/Sheet';
import { Skeleton } from '../../../components/ui/Skeleton';
import { Z } from '../../../design/tokens';

/**
 * «Часы приёма» в мобильном CRM (09.11 фаза 3, дизайн-ревью CRM п. 2).
 *
 * Раньше /m/crm/schedule показывал компьютерный экран Grid House: моно-подписи
 * капсом, поля-линейки, пунктирные кнопки, чёрно-белые квадратные переключатели
 * и две кнопки «Сохранить». Теперь — из общих деталей приложения:
 *  - крупная шапка; дни недели — строки одной группы: день, «10:00–18:00 ·
 *    Unbox Uni», справа переключатель «рабочий день» (бирюзовый, 44 px);
 *  - тап по дню / исключению — шторка с полями Field (время, место);
 *  - одна кнопка «Сохранить часы приёма» — внизу, над вкладками;
 *  - пусто — EmptyState.
 * Данные, загрузка и сохранение — те же функции из CrmSchedule (props), логика
 * не дублируется; компьютерный вид не тронут.
 */
const DOW_LABELS = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
const LOCATION_OPTIONS = [
    { value: '__online__', label: 'Онлайн' },
    ...LOCATIONS.filter(l => l.id !== 'neo_school').map(l => ({ value: l.id, label: l.name })),
];
const locationName = (id: string | null | undefined) =>
    !id || id === '__online__' ? 'Онлайн' : LOCATION_OPTIONS.find(o => o.value === id)?.label ?? LOCATIONS.find(l => l.id === id)?.name ?? id;

const rangeLabel = (r: DayRange) => `${r.start_time}–${r.end_time}`;

export function MobileCrmSchedule({
    loading, specialistId, lookup, onRetryLookup,
    days, updateDay, updateRange, addRange, removeRange,
    overrides, addOverride, updateOverride, removeOverride,
    saving, handleSave, upcomingAppointments, onCancelAppt,
}: GridHouseCrmScheduleProps) {
    const navigate = useNavigate();
    const [dayOpen, setDayOpen] = useState<number | null>(null);
    const [overrideOpen, setOverrideOpen] = useState<number | null>(null);

    if (loading || lookup === 'pending') {
        return (
            <div role="status" aria-busy="true" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <span className="sr-only">Загружаем расписание…</span>
                <Skeleton height={32} width="50%" />
                <Skeleton height={7 * 56} radius={16} />
            </div>
        );
    }

    if (!specialistId) {
        const isError = lookup === 'error';
        return (
            <div style={{ padding: 16 }}>
                {isError ? (
                    <EmptyState
                        title="Не удалось загрузить часы приёма"
                        hint="Проверьте интернет и попробуйте ещё раз."
                        action={{ label: 'Повторить', onClick: onRetryLookup }}
                    />
                ) : (
                    <EmptyState
                        title="Сначала нужна анкета"
                        hint="Часы приёма привязаны к анкете специалиста, а у этого аккаунта её пока нет. Заполните анкету. Если ваша карточка уже есть на сайте, напишите администратору: он привяжет её к аккаунту."
                        action={{ label: 'Заполнить анкету', onClick: () => navigate('/become-specialist') }}
                        secondaryAction={{ label: 'Написать администратору', onClick: () => { window.open('https://t.me/UnboxCenter', '_blank', 'noopener,noreferrer'); } }}
                    />
                )}
            </div>
        );
    }

    const workDays = days.filter(d => d.enabled).length;
    const openDay = dayOpen !== null ? days[dayOpen] : null;
    const openOverride = overrideOpen !== null ? overrides[overrideOpen] : null;
    const addOverrideButton = (
        <Button variant="quiet" size="sm" icon={<Plus size={16} aria-hidden="true" />}
            onClick={() => { addOverride(); setOverrideOpen(overrides.length); }}
            style={{ color: 'var(--color-accent-ink)' }}
        >
            Добавить
        </Button>
    );

    return (
        <div style={{ paddingBottom: 'calc(96px + env(safe-area-inset-bottom, 0px))', display: 'flex', flexDirection: 'column', gap: 24 }}>
            <MobilePageHeader
                variant="large"
                title="Часы приёма"
                subtitle="Когда, где и в каком формате вы принимаете. Клиенты видят только то, что здесь отмечено."
                className="crm-schedule-header"
            />
            <style>{'.crm-schedule-header { padding-bottom: 0; }'}</style>

            {/* ── Недельный шаблон ── */}
            <div style={{ padding: '0 16px' }}>
                <ListGroup title="Недельный шаблон" aside={<span className="num-inline">Рабочих дней: {workDays} из 7</span>}>
                    {days.map((day, i) => (
                        <ListRow
                            key={i}
                            title={DOW_LABELS[i]}
                            subtitle={day.enabled
                                ? <span className="num-inline">{day.ranges.map(r => `${rangeLabel(r)} · ${locationName(r.location_id)}`).join(', ')}</span>
                                : 'Выходной'}
                            dimmed={!day.enabled}
                            onClick={() => setDayOpen(i)}
                            action={(
                                <Switch
                                    on={day.enabled}
                                    onChange={() => updateDay(i, { enabled: !day.enabled })}
                                    label={`${DOW_LABELS[i]} — рабочий день`}
                                />
                            )}
                        />
                    ))}
                </ListGroup>
            </div>

            {/* ── Исключения ── */}
            <div style={{ padding: '0 16px' }}>
                {overrides.length === 0 ? (
                    <>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '0 4px', marginBottom: 8 }}>
                            <h2 className="ui-overline" style={{ margin: 0 }}>Исключения</h2>
                            {addOverrideButton}
                        </div>
                        {/* Без своей главной кнопки: главная на экране одна — «Сохранить часы приёма». */}
                        <EmptyState
                            compact
                            icon={<CalendarOff size={24} />}
                            title="Исключений нет"
                            hint="Отпуск, дополнительные дни или нестандартные часы — они переопределяют недельный шаблон."
                        />
                    </>
                ) : (
                    <ListGroup
                        title="Исключения"
                        aside={addOverrideButton}
                    >
                        {overrides.map((ov, i) => (
                            <ListRow
                                key={i}
                                title={ov.specific_date ? formatDateLabel(ov.specific_date, { capitalize: true, withYear: 'auto' }) : 'Дата не выбрана'}
                                subtitle={ov.is_available
                                    ? <span className="num-inline">{`Работаю · ${ov.start_time}–${ov.end_time} · ${locationName(ov.location_id)}`}</span>
                                    : 'Выходной'}
                                onClick={() => setOverrideOpen(i)}
                            />
                        ))}
                    </ListGroup>
                )}
            </div>

            {/* ── Предстоящие записи ── */}
            <div style={{ padding: '0 16px' }}>
                {upcomingAppointments.length === 0 ? (
                    <>
                        <h2 className="ui-overline" style={{ margin: '0 0 8px', padding: '0 4px' }}>Предстоящие записи</h2>
                        <EmptyState
                            compact
                            icon={<CalendarClock size={24} />}
                            title="Записей с сайта пока нет"
                            hint="Когда клиент запишется к вам в эти часы, запись появится здесь."
                        />
                    </>
                ) : (
                    <ListGroup title="Предстоящие записи" aside={<span className="num-inline">{upcomingAppointments.length}</span>}>
                        {upcomingAppointments.map(appt => (
                            <ListRow
                                key={appt.id}
                                lead={<ListTime start={appt.startTime?.slice(0, 5)} />}
                                title={appt.clientName}
                                subtitle={[
                                    formatDayMonth(appt.date),
                                    appt.locationId ? LOCATIONS.find(l => l.id === appt.locationId)?.name || appt.locationId : 'Онлайн',
                                    appt.clientPhone,
                                    appt.clientEmail,
                                    appt.notes,
                                ].filter(Boolean).join(' · ')}
                                action={(
                                    <Button
                                        variant="quiet"
                                        size="sm"
                                        icon={<Trash2 size={16} aria-hidden="true" />}
                                        aria-label="Отменить запись"
                                        title="Отменить запись"
                                        onClick={() => onCancelAppt(appt.id)}
                                        style={{ color: 'var(--color-ink-60)' }}
                                    />
                                )}
                            />
                        ))}
                    </ListGroup>
                )}
            </div>

            {/* Одна кнопка «Сохранить» — внизу, над вкладками. */}
            <div style={saveBar}>
                <Button block loading={saving} icon={<Save size={16} aria-hidden="true" />} onClick={handleSave}>
                    Сохранить часы приёма
                </Button>
            </div>

            {/* ── Шторка дня ── */}
            <Sheet
                open={openDay !== null}
                onClose={() => setDayOpen(null)}
                title={dayOpen !== null ? DOW_LABELS[dayOpen] : ''}
                description="Правки применятся после «Сохранить часы приёма»"
                footer={<Button block onClick={() => setDayOpen(null)}>Готово</Button>}
            >
                {openDay && dayOpen !== null && (
                    <DayEditor
                        day={openDay}
                        label={DOW_LABELS[dayOpen]}
                        onToggle={() => updateDay(dayOpen, { enabled: !openDay.enabled })}
                        onUpdateRange={(ri, patch) => updateRange(dayOpen, ri, patch)}
                        onAddRange={() => addRange(dayOpen)}
                        onRemoveRange={(ri) => removeRange(dayOpen, ri)}
                    />
                )}
            </Sheet>

            {/* ── Шторка исключения ── */}
            <Sheet
                open={openOverride !== null}
                onClose={() => setOverrideOpen(null)}
                title="Исключение"
                description="Правки применятся после «Сохранить часы приёма»"
                footer={<Button block onClick={() => setOverrideOpen(null)}>Готово</Button>}
            >
                {openOverride && overrideOpen !== null && (
                    <OverrideEditor
                        override={openOverride}
                        onUpdate={(patch) => updateOverride(overrideOpen, patch)}
                        onRemove={() => { removeOverride(overrideOpen); setOverrideOpen(null); }}
                    />
                )}
            </Sheet>
        </div>
    );
}

function DayEditor({ day, label, onToggle, onUpdateRange, onAddRange, onRemoveRange }: {
    day: DaySchedule;
    label: string;
    onToggle: () => void;
    onUpdateRange: (rangeIdx: number, patch: Partial<DayRange>) => void;
    onAddRange: () => void;
    onRemoveRange: (rangeIdx: number) => void;
}) {
    const multiple = day.ranges.length > 1;
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ flex: 1, fontSize: 16, fontWeight: 600 }}>Рабочий день</span>
                <Switch on={day.enabled} onChange={onToggle} label={`${label} — рабочий день`} />
            </div>
            {!day.enabled ? (
                <p style={{ margin: 0, fontSize: 14, color: 'var(--color-ink-60)' }}>
                    Выходной: в этот день записаться к вам на сайте нельзя.
                </p>
            ) : (
                <>
                    {day.ranges.map((r, ri) => (
                        <div key={ri} style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: ri ? 16 : 0, borderTop: ri ? '1px solid var(--color-ink-10)' : undefined }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                <Field label="С">
                                    <Input kind="time" value={r.start_time} onChange={e => onUpdateRange(ri, { start_time: e.target.value })} />
                                </Field>
                                <Field label="До">
                                    <Input kind="time" value={r.end_time} onChange={e => onUpdateRange(ri, { end_time: e.target.value })} />
                                </Field>
                            </div>
                            <Field label="Где">
                                <Select value={r.location_id} onChange={e => onUpdateRange(ri, { location_id: e.target.value })}>
                                    {LOCATION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </Select>
                            </Field>
                            {multiple && (
                                <div>
                                    <Button variant="quiet" size="sm" icon={<Trash2 size={16} aria-hidden="true" />} onClick={() => onRemoveRange(ri)}
                                        style={{ color: 'var(--status-danger-fg)', paddingLeft: 0 }}>
                                        Убрать эти часы
                                    </Button>
                                </div>
                            )}
                        </div>
                    ))}
                    <div>
                        <Button variant="secondary" size="sm" icon={<Plus size={16} aria-hidden="true" />} onClick={onAddRange}>
                            Ещё часы в этот день
                        </Button>
                    </div>
                </>
            )}
        </div>
    );
}

function OverrideEditor({ override, onUpdate, onRemove }: {
    override: OverrideEntry;
    onUpdate: (patch: Partial<OverrideEntry>) => void;
    onRemove: () => void;
}) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Field label="Дата" hint={override.specific_date ? formatDateLabel(override.specific_date, { capitalize: true, withYear: 'auto' }) : undefined}>
                <Input kind="date" lang="ru" value={override.specific_date} onChange={e => onUpdate({ specific_date: e.target.value })} />
            </Field>
            <Segmented<'off' | 'on'>
                aria-label="В этот день"
                options={[{ value: 'off', label: 'Выходной' }, { value: 'on', label: 'Работаю' }]}
                value={override.is_available ? 'on' : 'off'}
                onChange={v => onUpdate({ is_available: v === 'on' })}
            />
            {override.is_available && (
                <>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <Field label="С">
                            <Input kind="time" value={override.start_time} onChange={e => onUpdate({ start_time: e.target.value })} />
                        </Field>
                        <Field label="До">
                            <Input kind="time" value={override.end_time} onChange={e => onUpdate({ end_time: e.target.value })} />
                        </Field>
                    </div>
                    <Field label="Где">
                        <Select value={override.location_id} onChange={e => onUpdate({ location_id: e.target.value })}>
                            {LOCATION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </Select>
                    </Field>
                </>
            )}
            <div>
                <Button variant="quiet" icon={<Trash2 size={16} aria-hidden="true" />} onClick={onRemove}
                    style={{ color: 'var(--status-danger-fg)', paddingLeft: 0 }}>
                    Удалить исключение
                </Button>
            </div>
        </div>
    );
}

// Над нижними вкладками оболочки CRM (~64 px + вырез iPhone), как «Есть изменения» в анкете.
const saveBar: React.CSSProperties = {
    position: 'fixed',
    left: '50%',
    transform: 'translateX(-50%)',
    bottom: 'calc(64px + env(safe-area-inset-bottom, 0px))',
    width: '100%',
    maxWidth: 480,
    zIndex: Z.sticky,
    background: 'var(--color-card)',
    borderTop: '1px solid var(--color-ink-10)',
    padding: '8px 16px',
};
