export interface TestOption {
    value: number;
    label: string;
}

export interface TestQuestion {
    id: number;
    text: string;
    options: TestOption[];
}

export interface TestResult {
    label: string;
    description: string;
    color: string; // Tailwind color token e.g. 'green' | 'yellow' | 'orange' | 'red'
    cta: string;
}

export interface Test {
    id: string;
    name: string;
    shortName: string;
    emoji: string;
    description: string;
    duration: string;
    questionCount: number;
    questions: TestQuestion[];
    interpret: (score: number) => TestResult;
}

// ─── GAD-7: Тревога ──────────────────────────────────────────────────────────

const GAD7_OPTIONS: TestOption[] = [
    { value: 0, label: 'Никогда' },
    { value: 1, label: 'Несколько дней' },
    { value: 2, label: 'Больше половины дней' },
    { value: 3, label: 'Почти каждый день' },
];

const gad7: Test = {
    id: 'gad7',
    name: 'Шкала тревоги GAD-7',
    shortName: 'GAD-7',
    emoji: '😰',
    description: 'Оцените уровень тревожности за последние 2 недели',
    duration: '3 мин',
    questionCount: 7,
    questions: [
        { id: 1, text: 'Чувствуете нервозность, тревогу или состояние «на взводе»', options: GAD7_OPTIONS },
        { id: 2, text: 'Не можете прекратить беспокоиться или контролировать его', options: GAD7_OPTIONS },
        { id: 3, text: 'Беспокоитесь слишком сильно о разных вещах', options: GAD7_OPTIONS },
        { id: 4, text: 'Трудно расслабиться', options: GAD7_OPTIONS },
        { id: 5, text: 'Такое беспокойство, что трудно усидеть на месте', options: GAD7_OPTIONS },
        { id: 6, text: 'Легко раздражаетесь и становитесь несдержанными', options: GAD7_OPTIONS },
        { id: 7, text: 'Боитесь, что может случиться что-то ужасное', options: GAD7_OPTIONS },
    ],
    interpret: (score: number): TestResult => {
        if (score <= 4) return {
            label: 'Минимальная тревога',
            description: 'Ваш уровень тревоги в норме. Продолжайте заботиться о себе.',
            color: 'green',
            cta: 'Отлично! Возможно, профилактическая консультация поможет поддержать ресурс.',
        };
        if (score <= 9) return {
            label: 'Умеренная тревога',
            description: 'Вы испытываете тревогу, которая влияет на повседневную жизнь. Стоит обратить внимание.',
            color: 'yellow',
            cta: 'Рекомендуем обсудить это с психологом или психотерапевтом.',
        };
        if (score <= 14) return {
            label: 'Выраженная тревога',
            description: 'Уровень тревоги значительно влияет на качество жизни. Профессиональная поддержка поможет.',
            color: 'orange',
            cta: 'Рекомендуем консультацию специалиста. Запишитесь сегодня.',
        };
        return {
            label: 'Тяжёлая тревога',
            description: 'Высокий уровень тревоги требует внимания специалиста.',
            color: 'red',
            cta: 'Пожалуйста, обратитесь к специалисту. Мы готовы помочь.',
        };
    },
};

// ─── PHQ-9: Депрессия ─────────────────────────────────────────────────────────

const PHQ9_OPTIONS: TestOption[] = [
    { value: 0, label: 'Ни разу' },
    { value: 1, label: 'Несколько дней' },
    { value: 2, label: 'Больше половины дней' },
    { value: 3, label: 'Почти каждый день' },
];

const phq9: Test = {
    id: 'phq9',
    name: 'Опросник депрессии PHQ-9',
    shortName: 'PHQ-9',
    emoji: '🌧️',
    description: 'Оцените наличие депрессивных симптомов за последние 2 недели',
    duration: '4 мин',
    questionCount: 9,
    questions: [
        { id: 1, text: 'Отсутствие интереса или удовольствия от занятий', options: PHQ9_OPTIONS },
        { id: 2, text: 'Подавленность, уныние или ощущение безнадёжности', options: PHQ9_OPTIONS },
        { id: 3, text: 'Трудности с засыпанием, нарушения сна или слишком много сна', options: PHQ9_OPTIONS },
        { id: 4, text: 'Усталость или ощущение нехватки энергии', options: PHQ9_OPTIONS },
        { id: 5, text: 'Отсутствие аппетита или переедание', options: PHQ9_OPTIONS },
        { id: 6, text: 'Ощущение себя плохим человеком или что подвели свою семью', options: PHQ9_OPTIONS },
        { id: 7, text: 'Трудности с концентрацией на делах (чтение, телевизор)', options: PHQ9_OPTIONS },
        { id: 8, text: 'Двигаетесь или говорите так медленно, что это замечают другие; или наоборот', options: PHQ9_OPTIONS },
        { id: 9, text: 'Мысли о том, что лучше быть мёртвым или о самоповреждении', options: PHQ9_OPTIONS },
    ],
    interpret: (score: number): TestResult => {
        if (score <= 4) return {
            label: 'Нет депрессии',
            description: 'Симптомов депрессии не выявлено. Вы справляетесь хорошо.',
            color: 'green',
            cta: 'Поддерживайте своё ментальное здоровье регулярными практиками.',
        };
        if (score <= 9) return {
            label: 'Лёгкая депрессия',
            description: 'Лёгкие симптомы депрессии. Стоит обратить внимание на своё состояние.',
            color: 'yellow',
            cta: 'Консультация психолога поможет разобраться в причинах.',
        };
        if (score <= 14) return {
            label: 'Умеренная депрессия',
            description: 'Умеренные симптомы депрессии, влияющие на функционирование.',
            color: 'orange',
            cta: 'Рекомендуем обратиться к специалисту. Не откладывайте.',
        };
        if (score <= 19) return {
            label: 'Умеренно-тяжёлая депрессия',
            description: 'Выраженные симптомы, требующие профессионального внимания.',
            color: 'red',
            cta: 'Пожалуйста, запишитесь к психотерапевту или психиатру.',
        };
        return {
            label: 'Тяжёлая депрессия',
            description: 'Тяжёлые симптомы депрессии. Профессиональная помощь необходима.',
            color: 'red',
            cta: 'Обратитесь к специалисту как можно скорее. Мы здесь для вас.',
        };
    },
};

// ─── PSS-10: Стресс ───────────────────────────────────────────────────────────

const PSS_OPTIONS: TestOption[] = [
    { value: 0, label: 'Никогда' },
    { value: 1, label: 'Почти никогда' },
    { value: 2, label: 'Иногда' },
    { value: 3, label: 'Довольно часто' },
    { value: 4, label: 'Очень часто' },
];

// Some PSS items are reverse-scored (4,5,7,8 in 1-indexed = idx 3,4,6,7)
const PSS_REVERSE = new Set([3, 4, 6, 7]); // 0-indexed

const pss10: Test = {
    id: 'pss10',
    name: 'Шкала воспринимаемого стресса PSS-10',
    shortName: 'PSS-10',
    emoji: '🔥',
    description: 'Оцените ощущение стресса за последний месяц',
    duration: '4 мин',
    questionCount: 10,
    questions: [
        { id: 1, text: 'Как часто вы расстраивались из-за чего-то, что произошло неожиданно?', options: PSS_OPTIONS },
        { id: 2, text: 'Как часто чувствовали, что не можете контролировать важные вещи?', options: PSS_OPTIONS },
        { id: 3, text: 'Как часто чувствовали нервозность и стресс?', options: PSS_OPTIONS },
        { id: 4, text: 'Как часто успешно справлялись с раздражающими жизненными ситуациями?', options: PSS_OPTIONS },
        { id: 5, text: 'Как часто чувствовали, что эффективно справляетесь с важными переменами?', options: PSS_OPTIONS },
        { id: 6, text: 'Как часто были уверены в своей способности справляться с личными проблемами?', options: PSS_OPTIONS },
        { id: 7, text: 'Как часто чувствовали, что всё идёт по-вашему?', options: PSS_OPTIONS },
        { id: 8, text: 'Как часто обнаруживали, что не справляетесь со своими обязанностями?', options: PSS_OPTIONS },
        { id: 9, text: 'Как часто злились из-за вещей, которые вы не могли контролировать?', options: PSS_OPTIONS },
        { id: 10, text: 'Как часто чувствовали, что трудности накапливаются настолько, что не справляетесь?', options: PSS_OPTIONS },
    ],
    interpret: (score: number): TestResult => {
        if (score <= 13) return {
            label: 'Низкий стресс',
            description: 'Вы хорошо справляетесь с жизненными нагрузками.',
            color: 'green',
            cta: 'Отличный результат! Продолжайте поддерживать баланс.',
        };
        if (score <= 26) return {
            label: 'Умеренный стресс',
            description: 'Умеренный уровень стресса. Стоит обратить внимание на качество отдыха и восстановления.',
            color: 'yellow',
            cta: 'Консультация поможет найти эффективные стратегии совладания со стрессом.',
        };
        return {
            label: 'Высокий стресс',
            description: 'Высокий уровень стресса, влияющий на здоровье и благополучие.',
            color: 'red',
            cta: 'Рекомендуем обратиться к специалисту для разработки стратегий управления стрессом.',
        };
    },
};

// ─── MBI (упрощённый): Выгорание ────────────────────────────────────────────

const MBI_OPTIONS: TestOption[] = [
    { value: 0, label: 'Никогда' },
    { value: 1, label: 'Редко (несколько раз в год)' },
    { value: 2, label: 'Иногда (раз в месяц)' },
    { value: 3, label: 'Регулярно (несколько раз в месяц)' },
    { value: 4, label: 'Часто (раз в неделю)' },
    { value: 5, label: 'Очень часто (несколько раз в неделю)' },
    { value: 6, label: 'Каждый день' },
];

const mbi: Test = {
    id: 'mbi',
    name: 'Тест на профессиональное выгорание MBI',
    shortName: 'MBI',
    emoji: '🪫',
    description: 'Оцените признаки эмоционального выгорания на работе',
    duration: '5 мин',
    questionCount: 9,
    questions: [
        { id: 1, text: 'Я чувствую себя эмоционально опустошённым из-за работы', options: MBI_OPTIONS },
        { id: 2, text: 'К концу рабочего дня я чувствую себя использованным', options: MBI_OPTIONS },
        { id: 3, text: 'Я чувствую усталость, когда встаю утром и вспоминаю о работе', options: MBI_OPTIONS },
        { id: 4, text: 'Целый день работать с людьми — это для меня большое напряжение', options: MBI_OPTIONS },
        { id: 5, text: 'Я чувствую себя полностью выгоревшим из-за работы', options: MBI_OPTIONS },
        { id: 6, text: 'Я чувствую большой энтузиазм от своей работы', options: MBI_OPTIONS },
        { id: 7, text: 'Я могу легко создать спокойную атмосферу на рабочем месте', options: MBI_OPTIONS },
        { id: 8, text: 'Я чувствую себя бодрым после работы с клиентами/коллегами', options: MBI_OPTIONS },
        { id: 9, text: 'В работе я достиг многого, что мне самому кажется ценным', options: MBI_OPTIONS },
    ],
    interpret: (score: number): TestResult => {
        if (score <= 17) return {
            label: 'Нет выгорания',
            description: 'Признаков выгорания не выявлено. Вы сохраняете ресурс и вовлечённость.',
            color: 'green',
            cta: 'Отличный результат! Продолжайте заботиться о балансе.',
        };
        if (score <= 29) return {
            label: 'Умеренное выгорание',
            description: 'Есть признаки выгорания. Важно обратить внимание на восстановление.',
            color: 'yellow',
            cta: 'Разговор с психологом поможет найти стратегии восстановления.',
        };
        return {
            label: 'Высокий риск выгорания',
            description: 'Высокий уровень выгорания, требующий внимания.',
            color: 'red',
            cta: 'Рекомендуем обратиться к специалисту. Не игнорируйте своё состояние.',
        };
    },
};

export const TESTS: Test[] = [gad7, phq9, pss10, mbi];

export const getTest = (id: string): Test | undefined => TESTS.find(t => t.id === id);

/**
 * Calculate score with reverse-scoring support for PSS-10.
 * For most tests, just sum all answers.
 */
export function calcScore(testId: string, answers: number[]): number {
    if (testId === 'pss10') {
        return answers.reduce((sum, val, idx) => {
            return sum + (PSS_REVERSE.has(idx) ? 4 - val : val);
        }, 0);
    }
    return answers.reduce((a, b) => a + b, 0);
}
