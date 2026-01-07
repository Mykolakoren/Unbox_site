

interface CalendarEvent {
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
        `SUMMARY:${event.title}`,
        `DESCRIPTION:${event.description}`,
        `LOCATION:${event.location}`,
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
