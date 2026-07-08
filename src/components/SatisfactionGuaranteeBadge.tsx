import { ShieldCheck, Sparkles } from 'lucide-react';

/**
 * Prominent 30-day satisfaction guarantee badge/banner.
 * Language auto-detected from the browser (ES default, EN when the UA prefers English).
 * Uses the RYBIX brand gradient for maximum visibility.
 */
export type GuaranteeVariant = 'banner' | 'compact';

const detectLang = (): 'es' | 'en' => {
  if (typeof navigator === 'undefined') return 'es';
  const lang = (navigator.language || 'es').toLowerCase();
  return lang.startsWith('en') ? 'en' : 'es';
};

const COPY = {
  es: {
    title: 'Garantía de satisfacción de 30 días',
    subtitle: 'Si no te enamora, te devolvemos tu dinero. Sin preguntas.',
    chip: 'Sin riesgo',
  },
  en: {
    title: '30-day satisfaction guarantee',
    subtitle: "If you don't love it, we refund your money. No questions asked.",
    chip: 'Risk-free',
  },
} as const;

interface Props {
  variant?: GuaranteeVariant;
  className?: string;
}

export const SatisfactionGuaranteeBadge = ({ variant = 'banner', className = '' }: Props) => {
  const lang = detectLang();
  const t = COPY[lang];

  if (variant === 'compact') {
    return (
      <div
        className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold text-white shadow-md ${className}`}
        style={{
          background:
            'linear-gradient(135deg, var(--rx-brand, #6366f1) 0%, #8b5cf6 55%, #ec4899 100%)',
        }}
      >
        <ShieldCheck size={14} />
        <span>{t.title}</span>
      </div>
    );
  }

  return (
    <div
      className={`relative overflow-hidden rounded-2xl p-[1.5px] shadow-xl ${className}`}
      style={{
        background:
          'linear-gradient(135deg, var(--rx-brand, #6366f1) 0%, #8b5cf6 45%, #ec4899 100%)',
      }}
    >
      <div className="relative rounded-2xl bg-[var(--rx-s1,#0b0f1a)]/95 backdrop-blur-sm p-4 sm:p-5">
        {/* Decorative sparkles */}
        <Sparkles
          size={80}
          className="absolute -top-6 -right-6 text-white/5 pointer-events-none"
        />
        <div className="relative flex items-center gap-4">
          <div
            className="shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg"
            style={{
              background:
                'linear-gradient(135deg, var(--rx-brand, #6366f1) 0%, #ec4899 100%)',
            }}
          >
            <ShieldCheck size={26} className="text-white" strokeWidth={2.4} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm sm:text-base font-bold text-white">
                {t.title}
              </p>
              <span className="text-[10px] font-bold uppercase tracking-wider text-white/90 bg-white/15 px-2 py-0.5 rounded-full">
                {t.chip}
              </span>
            </div>
            <p className="text-xs sm:text-[13px] text-white/80 mt-0.5 leading-snug">
              {t.subtitle}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SatisfactionGuaranteeBadge;
