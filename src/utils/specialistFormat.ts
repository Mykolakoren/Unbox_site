/**
 * Единая трактовка формата работы специалиста (онлайн / очно).
 *
 * 2026-06-29 owner: в базе исторический зоопарк offline-кодов — OFFLINE,
 * OFFLINE_ROOM, OFFLINE_CAPSULE, OFFLINE_TBEL, OFFLINE_PALIASHVILI,
 * OFFLINE_NEO, OFFLINE_UNBOX_ONE/UNI/NEO_SCHOOL. Раньше каждое место
 * (шапка профиля, карточка каталога, фильтр, админка) проверяло свой
 * частичный набор → «Очно» терялось у большинства. Теперь — одна логика.
 */

/** Любой offline-код (начинается с OFFLINE). */
export function isOfflineFormat(f: unknown): boolean {
    return typeof f === 'string' && f.toUpperCase().startsWith('OFFLINE');
}

/** Капсула — единственный отдельный подтип очного. */
export function isCapsuleFormat(f: unknown): boolean {
    return typeof f === 'string' && f.toUpperCase() === 'OFFLINE_CAPSULE';
}

export function hasOnlineFormat(formats?: readonly string[] | null): boolean {
    return !!formats?.includes('ONLINE');
}

export function hasOfflineFormat(formats?: readonly string[] | null): boolean {
    return !!formats?.some(isOfflineFormat);
}

/** Очно «в кабинете» — любой не-капсульный offline-код. Generic OFFLINE
 *  и центр-специфичные коды считаем кабинетом. */
export function hasOfflineRoom(formats?: readonly string[] | null): boolean {
    return !!formats?.some(f => isOfflineFormat(f) && !isCapsuleFormat(f));
}

export function hasOfflineCapsule(formats?: readonly string[] | null): boolean {
    return !!formats?.some(isCapsuleFormat);
}

// ── Направления работы (specializations) ─────────────────────────────────
//
// Волна 2, шаг 0 (G2-08): в карточках каталога всплывали служебные ключи
// вроде GENERAL_PSYCHOLOGY. Откуда ключи: backend/scripts/
// seed_specialists_from_unbox_center.py заливал направления кодами
// (general_psychology, gestalt, cbt…), а анкета, CRM-профиль и админка
// пишут направления свободным текстом по-русски. Поэтому: известный ключ →
// русское название; русский текст — как есть; неизвестная латиница —
// скрываем (это техданные, а не слова для клиента).

const SPECIALIZATION_LABELS: Record<string, string> = {
    // Реально встречаются в базе (сид с unbox.center).
    general_psychology: 'Общая психология',
    general_psychotherapy: 'Психотерапия',
    consulting_psychology: 'Психологическое консультирование',
    clinical_psychology: 'Клиническая психология',
    crisis_intervention: 'Кризисная помощь',
    gestalt: 'Гештальт-терапия',
    cbt: 'КПТ',
    sexology: 'Сексология',
    sexotherapy: 'Сексотерапия',
    psychodrama: 'Психодрама',
    psychoanalysis: 'Психоанализ',
    child_adolescent: 'Детская и подростковая психология',
    neuropsychology: 'Нейропсихология',
    art_therapy: 'Арт-терапия',
    nlp: 'НЛП',
    trauma_therapy: 'Работа с травмой',
    ergotherapy: 'Эрготерапия',
    coaching: 'Коучинг',
    neurology: 'Неврология',
    psychiatry: 'Психиатрия',
    // Категория специалиста (Specialist.category) — на случай, если попадёт в теги.
    psychology: 'Психология',
    // Частые направления, которые могут прийти тем же способом.
    family_therapy: 'Семейная терапия',
    couple_therapy: 'Парная терапия',
    couples_therapy: 'Парная терапия',
    group_therapy: 'Групповая терапия',
    body_oriented: 'Телесно-ориентированная терапия',
    body_therapy: 'Телесно-ориентированная терапия',
    sand_therapy: 'Песочная терапия',
    schema_therapy: 'Схема-терапия',
    emdr: 'ДПДГ (EMDR)',
    existential: 'Экзистенциальная терапия',
    transactional_analysis: 'Транзактный анализ',
    psychosomatics: 'Психосоматика',
};

/** Есть хоть одна кириллическая буква — значит, это текст для людей. */
const CYRILLIC_RE = /[а-яё]/i;

function specializationKey(raw: string): string {
    return raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

/**
 * Направление для показа клиенту.
 *   specializationLabel('GENERAL_PSYCHOLOGY') → 'Общая психология'
 *   specializationLabel('Тревога')            → 'Тревога'
 *   specializationLabel('some_new_key')       → null (скрыть)
 */
export function specializationLabel(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const text = raw.trim();
    if (!text) return null;
    const key = specializationKey(text);
    // hasOwnProperty — чтобы «constructor» не нашёлся в прототипе объекта.
    if (Object.prototype.hasOwnProperty.call(SPECIALIZATION_LABELS, key)) return SPECIALIZATION_LABELS[key];
    if (CYRILLIC_RE.test(text)) return text;
    return null;
}

/** Список направлений для показа: переводит, выкидывает скрытые и повторы. */
export function specializationLabels(list?: readonly unknown[] | null): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of list ?? []) {
        const label = specializationLabel(raw);
        if (!label) continue;
        const k = label.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(label);
    }
    return out;
}
