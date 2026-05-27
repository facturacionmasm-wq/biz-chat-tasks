import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Phone, PhoneMissed, MessageSquare, CalendarPlus,
  FolderKanban, Users, TrendingUp, ArrowRight,
  Download, X, Zap, Activity, Globe,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

// ─── Types ────────────────────────────────────────────────────
interface DashStats {
  callsToday: number;
  callsMissed: number;
  openWA: number;
  upcomingApts: number;
  activeProjects: number;
  teamMembers: number;
}

interface Appointment {
  id: string;
  contact_name: string;
  start_at: string;
  service_type: string | null;
  status: string;
}

const EMPTY: DashStats = {
  callsToday: 0, callsMissed: 0, openWA: 0,
  upcomingApts: 0, activeProjects: 0, teamMembers: 0,
};

// ─── Animated Number ──────────────────────────────────────────
function AnimatedNumber({ value, duration = 1200 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef<number>();
  const startRef = useRef<number>();

  useEffect(() => {
    if (value === 0) { setDisplay(0); return; }
    const start = performance.now();
    startRef.current = start;
    const animate = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(eased * value));
      if (progress < 1) rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [value, duration]);

  return <>{display}</>;
}

// ─── 3D Tilt Card ─────────────────────────────────────────────
function TiltCard({
  children, className = '', intensity = 12,
}: {
  children: React.ReactNode;
  className?: string;
  intensity?: number;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const card = cardRef.current;
    const glow = glowRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = (e.clientX - cx) / (rect.width / 2);
    const dy = (e.clientY - cy) / (rect.height / 2);
    const rotX = -dy * intensity;
    const rotY = dx * intensity;
    card.style.transform = `perspective(800px) rotateX(${rotX}deg) rotateY(${rotY}deg) scale3d(1.03,1.03,1.03)`;
    if (glow) {
      glow.style.background = `radial-gradient(circle at ${((dx + 1) / 2) * 100}% ${((dy + 1) / 2) * 100}%, rgba(255,255,255,0.18) 0%, transparent 65%)`;
    }
  }, [intensity]);

  const handleMouseLeave = useCallback(() => {
    const card = cardRef.current;
    const glow = glowRef.current;
    if (card) card.style.transform = 'perspective(800px) rotateX(0deg) rotateY(0deg) scale3d(1,1,1)';
    if (glow) glow.style.background = 'transparent';
  }, []);

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className={className}
      style={{ transformStyle: 'preserve-3d', transition: 'transform 0.15s ease-out, box-shadow 0.15s ease-out', willChange: 'transform' }}
    >
      <div ref={glowRef} className="absolute inset-0 rounded-[inherit] pointer-events-none z-10 transition-all duration-100" />
      {children}
    </div>
  );
}

// ─── Floating Orb ─────────────────────────────────────────────
function FloatingOrb({ color, size, x, y, delay, blur }: {
  color: string; size: number; x: string; y: string; delay: number; blur: number;
}) {
  return (
    <div
      className="absolute rounded-full pointer-events-none select-none"
      style={{
        width: size, height: size,
        left: x, top: y,
        background: color,
        filter: `blur(${blur}px)`,
        animation: `floatOrb ${6 + delay}s ease-in-out ${delay}s infinite alternate`,
        opacity: 0.55,
        zIndex: 0,
      }}
    />
  );
}

// ─── Main Dashboard ───────────────────────────────────────────
export default function Dashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState<DashStats>(EMPTY);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPWA, setShowPWA] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [mousePos, setMousePos] = useState({ x: 0.5, y: 0.5 });
  const heroRef = useRef<HTMLDivElement>(null);

  // PWA
  useEffect(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    const dismissed = sessionStorage.getItem('pwa-dismissed');
    if (!isStandalone && !dismissed) setShowPWA(true);
    const handler = (e: Event) => { e.preventDefault(); setDeferredPrompt(e); };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  // Mouse parallax on hero
  useEffect(() => {
    const hero = heroRef.current;
    if (!hero) return;
    const handler = (e: MouseEvent) => {
      const r = hero.getBoundingClientRect();
      setMousePos({
        x: Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1),
        y: Math.min(Math.max((e.clientY - r.top) / r.height, 0), 1),
      });
    };
    hero.addEventListener('mousemove', handler);
    return () => hero.removeEventListener('mousemove', handler);
  }, []);

  // Data
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const load = async () => {
      try {
        const { data: tid } = await supabase.rpc('get_user_tenant_id', { _user_id: user.id });
        if (!tid || cancelled) return;

        const now = new Date();
        const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);

        const [callsRes, waRes, aptsRes, projRes, teamRes] = await Promise.all([
          supabase.from('call_records').select('id,status').eq('tenant_id', tid)
            .gte('started_at', todayStart.toISOString())
            .lte('started_at', todayEnd.toISOString())
            .is('deleted_at', null),
          supabase.from('whatsapp_conversations').select('id,status')
            .eq('tenant_id', tid).neq('status', 'closed'),
          supabase.from('appointments').select('id,contact_name,start_at,service_type,status')
            .eq('tenant_id', tid).gte('start_at', now.toISOString())
            .neq('status', 'cancelled').is('deleted_at', null)
            .order('start_at', { ascending: true }).limit(4),
          supabase.from('projects').select('id').eq('tenant_id', tid).eq('status', 'active'),
          supabase.from('profiles').select('user_id').eq('tenant_id', tid).eq('status', 'active'),
        ]);

        if (cancelled) return;
        const calls = callsRes.data || [];
        setStats({
          callsToday: calls.length,
          callsMissed: calls.filter(c => c.status === 'missed' || c.status === 'no-answer').length,
          openWA: (waRes.data || []).filter(c => c.status === 'open').length,
          upcomingApts: (aptsRes.data || []).length,
          activeProjects: projRes.data?.length || 0,
          teamMembers: teamRes.data?.length || 0,
        });
        setAppointments((aptsRes.data || []) as Appointment[]);
      } catch (e) {
        console.error('[Dashboard]', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [user]);

  const userName = user?.user_metadata?.name || user?.email?.split('@')[0] || 'equipo';

  // Parallax shift based on mouse
  const px = (mousePos.x - 0.5) * 30;
  const py = (mousePos.y - 0.5) * 20;

  // ── Stat cards config ──
  const mainStats = [
    {
      label: 'Llamadas hoy',
      value: stats.callsToday,
      icon: Phone,
      link: '/calls',
      gradient: 'from-cyan-500 via-teal-500 to-emerald-500',
      glow: 'rgba(20,184,166,0.45)',
      bg: 'rgba(20,184,166,0.12)',
      iconBg: 'rgba(20,184,166,0.25)',
    },
    {
      label: 'WhatsApp abiertos',
      value: stats.openWA,
      icon: MessageSquare,
      link: '/whatsapp',
      gradient: 'from-green-400 via-emerald-500 to-teal-600',
      glow: 'rgba(16,185,129,0.45)',
      bg: 'rgba(16,185,129,0.12)',
      iconBg: 'rgba(16,185,129,0.25)',
    },
    {
      label: 'Citas próximas',
      value: stats.upcomingApts,
      icon: CalendarPlus,
      link: '/appointments',
      gradient: 'from-amber-400 via-orange-500 to-rose-500',
      glow: 'rgba(245,158,11,0.45)',
      bg: 'rgba(245,158,11,0.12)',
      iconBg: 'rgba(245,158,11,0.25)',
    },
    {
      label: 'Llamadas perdidas',
      value: stats.callsMissed,
      icon: PhoneMissed,
      link: '/calls',
      gradient: 'from-rose-500 via-pink-500 to-fuchsia-500',
      glow: 'rgba(244,63,94,0.45)',
      bg: 'rgba(244,63,94,0.12)',
      iconBg: 'rgba(244,63,94,0.25)',
    },
  ];

  const secondaryStats = [
    { label: 'Proyectos activos', value: stats.activeProjects, icon: FolderKanban, link: '/projects' },
    { label: 'Miembros del equipo', value: stats.teamMembers, icon: Users, link: '/settings' },
  ];

  return (
    <>
      {/* ── Global keyframes ── */}
      <style>{`
        @keyframes floatOrb {
          from { transform: translate(0, 0) scale(1); }
          to   { transform: translate(18px, -22px) scale(1.08); }
        }
        @keyframes shimmerSlide {
          0%   { background-position: -200% center; }
          100% { background-position:  200% center; }
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulseRing {
          0%   { transform: scale(1);   opacity: 0.6; }
          100% { transform: scale(2.2); opacity: 0; }
        }
        @keyframes rotateSlow {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes gridFloat {
          0%, 100% { opacity: 0.04; }
          50%       { opacity: 0.09; }
        }
        .card-3d {
          transform-style: preserve-3d;
          transition: transform 0.18s ease-out, box-shadow 0.18s ease-out;
        }
        .stat-shimmer {
          background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.15) 50%, transparent 100%);
          background-size: 200% 100%;
          animation: shimmerSlide 2.4s linear infinite;
        }
        .stagger-1 { animation: fadeUp 0.5s cubic-bezier(.16,1,.3,1) 0.05s both; }
        .stagger-2 { animation: fadeUp 0.5s cubic-bezier(.16,1,.3,1) 0.10s both; }
        .stagger-3 { animation: fadeUp 0.5s cubic-bezier(.16,1,.3,1) 0.15s both; }
        .stagger-4 { animation: fadeUp 0.5s cubic-bezier(.16,1,.3,1) 0.20s both; }
        .stagger-5 { animation: fadeUp 0.5s cubic-bezier(.16,1,.3,1) 0.25s both; }
        .stagger-6 { animation: fadeUp 0.5s cubic-bezier(.16,1,.3,1) 0.30s both; }
        .stagger-7 { animation: fadeUp 0.5s cubic-bezier(.16,1,.3,1) 0.35s both; }
      `}</style>

      <div className="min-h-full bg-background overflow-x-hidden">

        {/* ═══════════════════════════════════════════════════════
            HERO — animated mesh background + parallax orbs
        ═══════════════════════════════════════════════════════ */}
        <div
          ref={heroRef}
          className="relative overflow-hidden"
          style={{ background: 'linear-gradient(135deg, hsl(222 47% 8%) 0%, hsl(222 40% 12%) 50%, hsl(200 50% 10%) 100%)' }}
        >
          {/* Animated grid */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage: `
                linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px),
                linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)
              `,
              backgroundSize: '48px 48px',
              animation: 'gridFloat 4s ease-in-out infinite',
            }}
          />

          {/* Parallax orbs */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ transform: `translate(${px * 0.6}px, ${py * 0.4}px)`, transition: 'transform 0.1s ease-out' }}
          >
            <FloatingOrb color="radial-gradient(circle, rgba(20,184,166,0.9), transparent)" size={340} x="10%" y="-20%" delay={0} blur={80} />
            <FloatingOrb color="radial-gradient(circle, rgba(99,102,241,0.7), transparent)" size={280} x="65%" y="-10%" delay={1.5} blur={90} />
            <FloatingOrb color="radial-gradient(circle, rgba(245,158,11,0.5), transparent)" size={200} x="80%" y="40%" delay={3} blur={70} />
          </div>

          {/* Rotating ring decoration */}
          <div
            className="absolute -top-24 -right-24 w-96 h-96 rounded-full pointer-events-none"
            style={{
              border: '1px solid rgba(20,184,166,0.15)',
              animation: 'rotateSlow 20s linear infinite',
              boxShadow: 'inset 0 0 60px rgba(20,184,166,0.06)',
            }}
          />
          <div
            className="absolute -top-12 -right-12 w-72 h-72 rounded-full pointer-events-none"
            style={{
              border: '1px solid rgba(20,184,166,0.10)',
              animation: 'rotateSlow 14s linear infinite reverse',
            }}
          />

          {/* Hero content */}
          <div className="relative z-10 px-4 sm:px-6 pt-8 pb-16 max-w-7xl mx-auto">

            {/* PWA Banner */}
            {showPWA && (
              <div className="stagger-1 mb-6 flex items-center gap-3 bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-4">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-teal-400 flex items-center justify-center shrink-0">
                  <Download size={18} className="text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white">Instala la app</p>
                  <p className="text-xs text-white/60">Acceso directo desde tu pantalla</p>
                </div>
                <button
                  onClick={() => { deferredPrompt?.prompt(); setShowPWA(false); }}
                  className="shrink-0 bg-white/15 hover:bg-white/25 text-white text-xs font-semibold px-4 py-2 rounded-xl transition-colors"
                >
                  Instalar
                </button>
                <button onClick={() => { setShowPWA(false); sessionStorage.setItem('pwa-dismissed', '1'); }}>
                  <X size={15} className="text-white/50 hover:text-white transition-colors" />
                </button>
              </div>
            )}

            {/* Greeting */}
            <div className="stagger-2 mb-8">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold text-teal-400 uppercase tracking-widest flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse inline-block" />
                  Dashboard en vivo
                </span>
              </div>
              <h1 className="text-3xl sm:text-4xl font-extrabold text-white leading-tight">
                Hola, <span className="text-transparent bg-clip-text bg-gradient-to-r from-teal-300 to-cyan-200">{userName}</span> 👋
              </h1>
              <p className="text-white/50 text-sm mt-1.5">
                {format(new Date(), "EEEE d 'de' MMMM · HH:mm", { locale: es })}
              </p>
            </div>

            {/* ── 4 Main 3D Stat Cards ── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 stagger-3">
              {mainStats.map((stat, i) => (
                <Link to={stat.link} key={stat.label}>
                  <TiltCard
                    className="relative overflow-hidden rounded-2xl cursor-pointer group"
                    style={{
                      background: stat.bg,
                      border: '1px solid rgba(255,255,255,0.10)',
                      backdropFilter: 'blur(20px)',
                      boxShadow: loading ? 'none' : `0 8px 32px -8px ${stat.glow}, 0 0 0 1px rgba(255,255,255,0.05)`,
                    } as React.CSSProperties}
                  >
                    {/* Shimmer overlay */}
                    <div className="stat-shimmer absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />

                    {/* Gradient stripe at top */}
                    <div className={`absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r ${stat.gradient} opacity-80`} />

                    {/* Glowing orb behind icon */}
                    <div
                      className="absolute -top-6 -right-6 w-24 h-24 rounded-full blur-2xl pointer-events-none"
                      style={{ background: stat.glow }}
                    />

                    <div className="relative z-10 p-4 sm:p-5">
                      {/* Icon */}
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center mb-4"
                        style={{ background: stat.iconBg, border: '1px solid rgba(255,255,255,0.12)' }}
                      >
                        <stat.icon size={18} className="text-white" />
                      </div>

                      {/* Number */}
                      <div className="text-3xl sm:text-4xl font-extrabold text-white tabular-nums leading-none mb-1">
                        {loading ? (
                          <div className="h-9 w-12 rounded-lg skeleton" />
                        ) : (
                          <AnimatedNumber value={stat.value} />
                        )}
                      </div>

                      {/* Label */}
                      <div className="text-xs font-medium text-white/60 leading-tight">{stat.label}</div>

                      {/* Arrow */}
                      <div className="absolute bottom-4 right-4 opacity-0 group-hover:opacity-100 transition-all duration-200 translate-x-1 group-hover:translate-x-0">
                        <ArrowRight size={14} className="text-white/60" />
                      </div>
                    </div>
                  </TiltCard>
                </Link>
              ))}
            </div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════
            BODY — light section with cards
        ═══════════════════════════════════════════════════════ */}
        <div className="px-4 sm:px-6 max-w-7xl mx-auto -mt-6 pb-8 relative z-10 space-y-5">

          {/* Secondary stats */}
          <div className="grid grid-cols-2 gap-3 stagger-4">
            {secondaryStats.map(stat => (
              <Link to={stat.link} key={stat.label}>
                <TiltCard
                  className="rx-panel"
                  intensity={6}
                >
                  <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
                    <stat.icon size={19} className="text-[var(--rx-brand)]" />
                  </div>
                  <div className="flex-1">
                    <div className="text-2xl font-extrabold text-foreground">
                      {loading ? <div className="h-7 w-8 rounded-md skeleton" /> : <AnimatedNumber value={stat.value} />}
                    </div>
                    <div className="text-xs text-[var(--rx-t2)]">{stat.label}</div>
                  </div>
                  <ArrowRight size={14} className="text-[var(--rx-t2)]/40 group-hover:text-[var(--rx-brand)] transition-colors shrink-0" />
                </TiltCard>
              </Link>
            ))}
          </div>

          {/* Appointments + Quick Actions grid */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 stagger-5">

            {/* Upcoming appointments */}
            <div className="lg:col-span-3 bg-card border border-[var(--rx-b1)] rounded-2xl shadow-soft overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--rx-b1)]">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <CalendarPlus size={15} className="text-[var(--rx-brand)]" />
                  </div>
                  <h2 className="text-sm font-bold text-foreground">Próximas citas</h2>
                </div>
                <Link
                  to="/appointments"
                  className="text-xs text-[var(--rx-brand)] hover:underline flex items-center gap-1 font-medium"
                >
                  Ver todas <ArrowRight size={11} />
                </Link>
              </div>

              {loading ? (
                <div className="p-5 space-y-3">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl skeleton shrink-0" />
                      <div className="flex-1 space-y-2">
                        <div className="h-3.5 w-3/4 rounded skeleton" />
                        <div className="h-3 w-1/2 rounded skeleton" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : appointments.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                  <div className="w-14 h-14 rounded-2xl bg-[var(--rx-s2)] flex items-center justify-center mb-3">
                    <CalendarPlus size={24} className="text-[var(--rx-t2)]/40" />
                  </div>
                  <p className="text-sm font-medium text-[var(--rx-t2)]">Sin citas próximas</p>
                  <Link
                    to="/appointments"
                    className="mt-3 text-xs text-[var(--rx-brand)] font-semibold hover:underline"
                  >
                    + Agendar cita
                  </Link>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {appointments.map((apt, i) => {
                    const dt = new Date(apt.start_at);
                    const isToday = new Date().toDateString() === dt.toDateString();
                    return (
                      <div key={apt.id} className="flex items-center gap-3.5 px-5 py-3.5 hover:bg-[var(--rx-s2)]/30 transition-colors group">
                        {/* Time column */}
                        <div className="text-center shrink-0 w-11">
                          <div className={`text-xs font-bold ${isToday ? 'text-[var(--rx-brand)]' : 'text-[var(--rx-t2)]'}`}>
                            {format(dt, 'HH:mm')}
                          </div>
                          <div className="text-[9px] text-[var(--rx-t2)]">
                            {isToday ? 'HOY' : format(dt, 'd MMM', { locale: es }).toUpperCase()}
                          </div>
                        </div>

                        {/* Divider */}
                        <div className={`w-0.5 h-10 rounded-full shrink-0 ${isToday ? 'bg-[var(--rx-brand)]' : 'bg-border'}`} />

                        {/* Avatar */}
                        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary to-teal-400 flex items-center justify-center text-white text-[11px] font-bold shrink-0">
                          {apt.contact_name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate">{apt.contact_name}</p>
                          {apt.service_type && (
                            <p className="text-xs text-[var(--rx-t2)] truncate">{apt.service_type}</p>
                          )}
                        </div>

                        {/* Status badge */}
                        <span className={`text-[10px] font-semibold px-2 py-1 rounded-full shrink-0 ${
                          apt.status === 'confirmed'
                            ? 'bg-[rgba(0,232,122,.1)] text-[var(--rx-emerald)]'
                            : 'bg-primary/10 text-[var(--rx-brand)]'
                        }`}>
                          {apt.status === 'confirmed' ? '✓ Confirmada' : 'Agendada'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Quick Actions */}
            <div className="lg:col-span-2 space-y-3">
              {/* Activity widget */}
              <div
                className="rounded-2xl p-5 relative overflow-hidden"
                style={{
                  background: 'linear-gradient(135deg, hsl(172 65% 36%) 0%, hsl(200 70% 32%) 100%)',
                  boxShadow: '0 8px 32px -8px rgba(20,184,166,0.5)',
                }}
              >
                <div className="absolute -right-8 -top-8 w-32 h-32 rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }} />
                <div className="absolute -right-4 -bottom-4 w-24 h-24 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }} />
                <div className="relative z-10">
                  <div className="flex items-center gap-2 mb-4">
                    <Activity size={15} className="text-white/80" />
                    <span className="text-xs font-semibold text-white/80 uppercase tracking-wide">Actividad</span>
                  </div>
                  <div className="flex items-end gap-1 h-14 mb-3">
                    {/* Mini bar chart — visual only */}
                    {[30, 55, 40, 80, 60, 95, stats.callsToday > 0 ? 100 : 45].map((h, i) => (
                      <div key={i} className="flex-1 rounded-t-sm" style={{
                        height: `${h}%`,
                        background: i === 6 ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.25)',
                        transition: 'height 0.8s cubic-bezier(.16,1,.3,1)',
                        transitionDelay: `${i * 60}ms`,
                      }} />
                    ))}
                  </div>
                  <p className="text-white text-2xl font-extrabold">
                    {loading ? '—' : stats.callsToday + stats.openWA + stats.upcomingApts}
                    <span className="text-sm font-medium text-white/60 ml-1.5">acciones hoy</span>
                  </p>
                </div>
              </div>

              {/* Quick nav links */}
              <div className="rx-panel">
                <div className="px-4 py-3 border-b border-[var(--rx-b1)]">
                  <h3 className="text-xs font-bold text-foreground flex items-center gap-2">
                    <Zap size={13} className="text-[var(--rx-brand)]" /> Accesos rápidos
                  </h3>
                </div>
                {[
                  { label: 'WhatsApp Inbox', to: '/whatsapp', icon: MessageSquare, color: 'text-green-500' },
                  { label: 'Ver llamadas', to: '/calls', icon: Phone, color: 'text-blue-500' },
                  { label: 'Proyectos', to: '/projects', icon: FolderKanban, color: 'text-violet-500' },
                  { label: 'Analytics', to: '/analytics', icon: TrendingUp, color: 'text-amber-500' },
                ].map(item => (
                  <Link
                    key={item.to}
                    to={item.to}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--rx-s2)]/50 transition-colors group border-b border-[var(--rx-b1)] last:border-0"
                  >
                    <item.icon size={15} className={item.color} />
                    <span className="text-sm text-foreground flex-1">{item.label}</span>
                    <ArrowRight size={12} className="text-[var(--rx-t2)]/40 group-hover:text-[var(--rx-t2)] group-hover:translate-x-0.5 transition-all" />
                  </Link>
                ))}
              </div>
            </div>
          </div>

          {/* ── Globe / Status card ── */}
          <div className="stagger-6">
            <TiltCard
              className="relative overflow-hidden rounded-2xl"
              intensity={4}
              style={{
                background: 'linear-gradient(135deg, hsl(224 47% 9%) 0%, hsl(224 40% 13%) 100%)',
                border: '1px solid rgba(255,255,255,0.07)',
                boxShadow: '0 4px 24px -6px rgba(0,0,0,0.4)',
              } as React.CSSProperties}
            >
              {/* Decorative rings */}
              <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-48 h-48 rounded-full" style={{ border: '1px solid rgba(20,184,166,0.12)' }} />
              <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/4 w-32 h-32 rounded-full" style={{ border: '1px solid rgba(20,184,166,0.18)' }} />
              {/* Glow */}
              <div className="absolute right-8 top-1/2 -translate-y-1/2 w-16 h-16 rounded-full blur-2xl" style={{ background: 'rgba(20,184,166,0.3)' }} />

              <div className="relative z-10 flex items-center justify-between p-5 sm:p-6">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-2 h-2 rounded-full bg-teal-400 animate-pulse" />
                    <span className="text-[11px] font-semibold text-teal-400 uppercase tracking-widest">Sistema operativo</span>
                  </div>
                  <h3 className="text-lg font-bold text-white">Todos los servicios activos</h3>
                  <p className="text-sm text-white/50 mt-0.5">Agentes de voz · WhatsApp Bot · Notificaciones</p>
                </div>
                <div className="shrink-0 w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(20,184,166,0.15)', border: '1px solid rgba(20,184,166,0.2)' }}>
                  <Globe size={26} className="text-teal-400" />
                </div>
              </div>
            </TiltCard>
          </div>

        </div>
      </div>

      {/* Skeleton style */}
      <style>{`
        .skeleton {
          background: linear-gradient(90deg, hsl(var(--muted)) 25%, hsl(var(--secondary)) 50%, hsl(var(--muted)) 75%);
          background-size: 200% 100%;
          animation: shimmerSlide 1.5s infinite;
          border-radius: 8px;
        }
      `}</style>
    </>
  );
}
