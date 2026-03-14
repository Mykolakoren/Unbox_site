import { useEffect, useState } from 'react';
import { teamApi, type TeamMember } from '../api/team';
import { motion } from 'framer-motion';

const ROLE_BADGE: Record<string, string> = {
    founder: 'Основатель',
    senior_admin: 'Ст. администратор',
    admin: 'Администратор',
    other: '',
};

// API returns camelCase via axios interceptor

export function TeamSection() {
    const [members, setMembers] = useState<TeamMember[]>([]);

    useEffect(() => {
        teamApi.getAll().then(setMembers).catch(() => {});
    }, []);

    if (members.length === 0) return null;

    return (
        <section id="team" className="max-w-6xl mx-auto px-6 pt-10 pb-16">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5 }}
                className="text-center mb-8"
            >
                <p className="text-unbox-green text-xs font-bold uppercase tracking-widest mb-2">Люди</p>
                <h2 className="text-2xl sm:text-3xl font-bold text-unbox-dark leading-tight">
                    Наша команда
                </h2>
                <p className="mt-1.5 text-unbox-dark/55 max-w-xl mx-auto text-sm">
                    Мы создаём пространство, где каждый раскрывает свой потенциал
                </p>
            </motion.div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-5">
                {members.map((m, i) => (
                    <motion.div
                        key={m.id}
                        initial={{ opacity: 0, y: 24 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.4, delay: i * 0.08 }}
                        className="group relative flex flex-col rounded-3xl overflow-hidden"
                        style={{
                            background: 'rgba(255,255,255,0.55)',
                            backdropFilter: 'blur(20px) saturate(150%)',
                            WebkitBackdropFilter: 'blur(20px) saturate(150%)',
                            border: '1px solid rgba(255,255,255,0.65)',
                            boxShadow: '0 4px 20px rgba(0,0,0,0.07)',
                        }}
                    >
                        {/* Photo */}
                        <div className="relative aspect-[3/4] overflow-hidden">
                            {m.photoUrl ? (
                                <img
                                    src={m.photoUrl}
                                    alt={m.name}
                                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                                />
                            ) : (
                                <div className="w-full h-full bg-gradient-to-br from-unbox-green/15 to-unbox-dark/15 flex items-center justify-center">
                                    <span className="text-5xl font-bold text-unbox-dark/20">{m.name[0]}</span>
                                </div>
                            )}
                            <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-black/05 to-transparent" />

                            {ROLE_BADGE[m.roleType] && (
                                <div
                                    className="absolute top-3 left-3 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-unbox-green/80 text-white"
                                    style={{ backdropFilter: 'blur(8px)' }}
                                >
                                    {ROLE_BADGE[m.roleType]}
                                </div>
                            )}
                        </div>

                        {/* Info */}
                        <div className="p-4">
                            <div className="font-bold text-unbox-dark text-sm leading-tight">{m.name}</div>
                            <div className="text-unbox-dark/50 text-xs mt-0.5">{m.role}</div>
                            {m.bio && (
                                <p className="text-unbox-dark/40 text-xs mt-2 leading-relaxed line-clamp-3">
                                    {m.bio}
                                </p>
                            )}
                        </div>
                    </motion.div>
                ))}
            </div>
        </section>
    );
}
