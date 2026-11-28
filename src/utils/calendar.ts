

export interface CalendarEvent {
    title: string;
    description: string;
    location: string;
    startTime: Date;
    endTime: Date;
}

export const generateGoogleCalendarUrl = (event: CalendarEvent): string => {
    const formatDate = (date: Date) => date.toISOString().replace(/-|:|\.\d\d\d/g, "");

    const start = formatDate(event.startTime);
    const end = formatDate(event.endTime);

    const url = new URL('https://calendar.google.com/calendar/render');
    url.searchParams.append('action', 'TEMPLATE');
    url.searchParams.append('text', event.title);
    url.searchParams.append('dates', `${start}/${end}`);
    url.searchParams.append('details', event.description);
    url.searchParams.append('location', event.location);

    return url.toString();
};

/** Текст для .ics: запятая, точка с запятой и перенос строки — служебные знаки
 *  формата; без экранирования адрес «Парнаваз Мепе, 99» обрезался на запятой. */
function icsText(v: string): string {
    return (v || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1');
}

export const downloadIcsFile = (event: CalendarEvent) => {
    const formatDate = (date: Date) => date.toISOString().replace(/-|:|\.\d\d\d/g, "");
    const now = formatDate(new Date());

    const content = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Unbox Booking//EN',
        'BEGIN:VEVENT',
        `UID:${now}-${Math.random().toString(36).substr(2, 9)}@unbox.ge`,
        `DTSTAMP:${now}`,
        `DTSTART:${formatDate(event.startTime)}`,
        `DTEND:${formatDate(event.endTime)}`,
        `SUMMARY:${icsText(event.title)}`,
        `DESCRIPTION:${icsText(event.description)}`,
        `LOCATION:${icsText(event.location)}`,
        'END:VEVENT',
        'END:VCALENDAR'
    ].join('\r\n');

    const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
    const link = document.createElement('a');
    link.href = window.URL.createObjectURL(blob);
    link.setAttribute('download', 'booking.ics');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

/**
 * «В календарь» одной кнопкой (28.11, шаг 1 плана мобильной брони).
 * iPhone / iPad — файл .ics: его открывает системный «Календарь».
 * Остальные (Android, компьютер) — готовое событие в Google Календаре.
 */
function isAppleTouch(): boolean {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent;
    // iPad в «настольном» режиме представляется Mac — отличаем по тач-экрану.
    return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** Подпись под «Добавить в календарь»: что именно откроется на этом устройстве. */
export const calendarHint = (): string =>
    (isAppleTouch() ? 'Откроется файл для календаря телефона' : 'Откроется Google Календарь');

/** Возвращает, каким путём пошли, — экран показывает короткий отклик. */
export const addToCalendar = (event: CalendarEvent): 'ics' | 'google' => {
    if (isAppleTouch()) {
        downloadIcsFile(event);
        return 'ics';
    }
    window.open(generateGoogleCalendarUrl(event), '_blank', 'noopener,noreferrer');
    return 'google';
};
