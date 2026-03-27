import { motion } from 'framer-motion';
import { Calendar, Video, MapPin, ArrowRight } from 'lucide-react';

const EVENTS = [
    {
        id: '1',
        title: 'Групповая супервизия для психологов',
        date: '22 марта 2026',
        time: '18:00',
        format: 'offline',
        location: 'Unbox One, Батуми',
        tag: 'Супервизия',
    },
    {
        id: '2',
        title: 'Воркшоп: работа с тревогой и паническими атаками',
        date: '28 марта 2026',
        time: '15:00',
        format: 'online',
        location: 'Zoom',
        tag: 'Воркшоп',
    },
    {
        id: '3',
        title: 'Открытый разговор: осознанность в повседневной жизни',
        date: '5 апреля 2026',
        time: '17:30',
        format: 'offline',
        location: 'Unbox Uni, Батуми',
        tag: 'Встреча',
    },
];

const glassCard: React.CSSProperties = {
    background: 'rgba(255,255,255,0.55)',
    backdropFilter: 'blur(20px) saturate(150%)',
    WebkitBackdropFilter: 'blur(20px) saturate(150%)',
    border: '1px solid rgba(255,255,255,0.65)',
    boxShadow: '0 4px 20px rgba(0,0,0,0.06)',
};

export function EventsSection() {
    // Filter out past events
    const now = new Date();
    const upcomingEvents = EVENTS.filter(ev => {
        const [day, monthName, year] = ev.date.split(' ');
        const months: Record<string, number> = { 'января': 0, 'февраля': 1, 'марта': 2, 'апреля': 3, 'мая': 4, 'июня': 5, 'июля': 6, 'августа': 7, 'сентября': 8, 'октября': 9, 'ноября': 10, 'декабря': 11 };
        const eventDate = new Date(Number(year), months[monthName] ?? 0, Number(day));
        return eventDate >= new Date(now.getFullYear(), now.getMonth(), now.getDate());
    });

    if (upcomingEvents.length === 0) return null;

    return (
        <section className="max-w-6xl mx-auto px-6 py-12">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                className="flex items-end justify-between mb-8"
            >
                <div className="inline-block px-6 py-3 rounded-2xl" style={{ background: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}>
                    <p className="text-unbox-green text-xs font-bold uppercase tracking-widest mb-2">Анонсы</p>
                    <h2 className="text-2xl sm:text-3xl font-bold text-unbox-dark">Ближайшие мероприятия</h2>
                </div>
                <button className="hidden sm:flex items-center gap-2 text-sm text-unbox-dark/60 hover:text-unbox-dark/80 transition-colors px-4 py-2 rounded-xl" style={{ background: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}>
                    Все события <ArrowRight size={14} />
                </button>
            </motion.div>

            <div className={`grid grid-cols-1 ${upcomingEvents.length >= 3 ? 'sm:grid-cols-3' : upcomingEvents.length === 2 ? 'sm:grid-cols-2' : ''} gap-4`}>
                {upcomingEvents.map((ev, i) => (
                    <motion.div
                        key={ev.id}
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ delay: i * 0.1 }}
                        className="flex flex-col gap-3 p-5 rounded-2xl cursor-pointer hover:-translate-y-0.5 transition-all"
                        style={glassCard}
                    >
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-unbox-green/15 text-unbox-green">
                                {ev.tag}
                            </span>
                            <span className="flex items-center gap-1 text-[10px] text-unbox-dark/45">
                                {ev.format === 'online'
                                    ? <><Video size={9} /> Онлайн</>
                                    : <><MapPin size={9} /> Оффлайн</>
                                }
                            </span>
                        </div>

                        <div className="font-semibold text-unbox-dark text-sm leading-snug">
                            {ev.title}
                        </div>

                        <div className="flex items-center gap-1.5 text-unbox-dark/45 text-xs mt-auto">
                            <Calendar size={11} />
                            {ev.date} · {ev.time}
                        </div>
                        <div className="text-unbox-dark/35 text-xs">{ev.location}</div>
                    </motion.div>
                ))}
            </div>
        </section>
    );
}
