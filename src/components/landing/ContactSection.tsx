import { motion } from 'framer-motion';
import { Send, Instagram, MapPin } from 'lucide-react';

const glassBtn: React.CSSProperties = {
    background: 'rgba(255,255,255,0.55)',
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
    border: '1px solid rgba(255,255,255,0.65)',
};

export function ContactSection() {
    return (
        <section className="max-w-6xl mx-auto px-6 py-12 pb-20">
            <div className="border-t border-black/10 pt-10">
                <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6"
                >
                    <div>
                        <p className="text-unbox-green text-xs font-bold uppercase tracking-widest mb-2">Связь</p>
                        <h2 className="text-xl font-bold text-unbox-dark">Есть вопросы? Напишите нам</h2>
                        <p className="text-unbox-dark/50 text-sm mt-1">Ответим в Telegram или Instagram</p>
                    </div>

                    <div className="flex flex-wrap gap-3">
                        <a
                            href="https://t.me/UnboxCenter"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-unbox-dark/70 hover:text-unbox-dark transition-all hover:-translate-y-0.5"
                            style={glassBtn}
                        >
                            <Send size={15} />
                            Telegram
                        </a>
                        <a
                            href="https://www.instagram.com/unbox.center/"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-unbox-dark/70 hover:text-unbox-dark transition-all hover:-translate-y-0.5"
                            style={glassBtn}
                        >
                            <Instagram size={15} />
                            Instagram
                        </a>
                        <div
                            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm text-unbox-dark/40"
                            style={glassBtn}
                        >
                            <MapPin size={15} />
                            Батуми, Грузия
                        </div>
                    </div>
                </motion.div>
            </div>
        </section>
    );
}
