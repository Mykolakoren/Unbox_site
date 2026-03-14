import { useState } from 'react';
import { motion } from 'framer-motion';
import { Share2, Check } from 'lucide-react';

const REFERRAL_URL = 'https://unbox.center/?ref=client';

export function ReferralSection() {
    const [copied, setCopied] = useState(false);

    const handleShare = async () => {
        if (navigator.share) {
            try {
                await navigator.share({
                    title: 'Unbox — пространство для специалистов в Батуми',
                    text: 'Знаешь психолога или терапевта в Батуми? Расскажи ему про Unbox — уютные кабинеты для практики.',
                    url: REFERRAL_URL,
                });
            } catch {
                copyToClipboard();
            }
        } else {
            copyToClipboard();
        }
    };

    const copyToClipboard = () => {
        navigator.clipboard.writeText(REFERRAL_URL).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2500);
        });
    };

    return (
        <section className="max-w-6xl mx-auto px-6 py-12">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                className="rounded-3xl p-8 sm:p-10 flex flex-col sm:flex-row items-center gap-6"
                style={{
                    background: 'rgba(71,109,107,0.12)',
                    backdropFilter: 'blur(20px) saturate(150%)',
                    WebkitBackdropFilter: 'blur(20px) saturate(150%)',
                    border: '1px solid rgba(71,109,107,0.30)',
                    boxShadow: '0 4px 20px rgba(71,109,107,0.08)',
                }}
            >
                <div className="flex-1 text-center sm:text-left">
                    <p className="text-unbox-green text-xs font-bold uppercase tracking-widest mb-2">Расскажи о нас</p>
                    <h3 className="text-xl sm:text-2xl font-bold text-unbox-dark mb-2">
                        Ваш специалист ещё не знает об Unbox?
                    </h3>
                    <p className="text-unbox-dark/55 text-sm leading-relaxed max-w-md">
                        Если ваш психолог работает в Батуми и ищет пространство для практики — поделитесь ссылкой. Комфортная среда помогает обоим.
                    </p>
                </div>
                <button
                    onClick={handleShare}
                    className="flex items-center gap-2.5 px-6 py-3 rounded-2xl font-semibold text-sm transition-all hover:scale-105 active:scale-95 shrink-0 text-white"
                    style={{
                        background: copied ? 'rgba(71,109,107,0.75)' : 'rgba(71,109,107,0.65)',
                        border: '1px solid rgba(71,109,107,0.50)',
                    }}
                >
                    {copied ? <Check size={16} /> : <Share2 size={16} />}
                    {copied ? 'Скопировано!' : 'Поделиться ссылкой'}
                </button>
            </motion.div>
        </section>
    );
}
