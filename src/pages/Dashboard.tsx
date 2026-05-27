import { useState, useEffect, useRef, useCallback } from 'react';
import { Phone, PhoneMissed, MessageSquare, CalendarPlus, Download, X, ArrowRight, Sparkles, Zap, Activity, Users, CheckCircle, Clock } from 'lucide-react';
import { mockCallRecords, mockAppointments, mockWAConversations } from '@/data/mockCallsData';
import { projects } from '@/data/mockData';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Link } from 'react-router-dom';
import { useBranding } from '@/hooks/useBranding';
import { useAuth } from '@/contexts/AuthContext';

/* ── 3D Tilt hook ─────────────────────── */
function useTilt(strength = 13) {
  const ref = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);

  const onMove = useCallback((e: MouseEvent) => {
    const el = ref.current;
    if (!el || window.matchMedia('(hover:none)').matches) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width  - 0.5;
    const y = (e.clientY - r.top)  / r.height - 0.5;
    el.style.transform = `perspective(700px) rotateX(${-y * strength}deg) rotateY(${x * strength}deg) scale3d(1.03,1.03,1.03)`;
    if (glowRef.current) {
      glowRef.current.style.left = `${(x + .5) * 100 - 25}%`;
      glowRef.current.style.top  = `${(y + .5) * 100 - 25}%`;
    }
  }, [strength]);

  const onLeave = useCallback(() => {
    if (ref.current) ref.current.style.transform = '';
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.addEventListener('mousemove', onMove);
    el.addEventListener('mouseleave', onLeave);
    return () => { el.removeEventListener('mousemove', onMove); el.removeEventListener('mouseleave', onLeave); };
  }, [onMove, onLeave]);

  return { ref, glowRef };
}

/* ── KPI Card ─────────────────────────── */
interface KpiProps {
  label: string;
  value: number | string;
  sub: string;
  delta: string;
  deltaDir: 'up' | 'dn' | 'eq';
  variant: 'k-brand' | 'k-violet' | 'k-amber' | 'k-rose';
  numClass: string;
  sparks: number[];
  icon: React.ReactNode;
  link: string;
  delay: string;
}
function KpiCard({ label, value, sub, delta, deltaDir, variant, numClass, sparks, icon, link, delay }: KpiProps) {
  const { ref, glowRef } = useTilt(12);
  return (
    <Link to={link} className={`kpi3d ${variant} ${delay} anim-fade-up rounded-[18px] p-5 flex flex-col gap-0 select-none`}
      style={{ background: 'rgba(15,15,26,0.88)', border: '1px solid rgba(255,255,255,0.07)' }}
      ref={ref as React.Ref<HTMLAnchorElement>}>
      <div ref={glowRef} className="kglow3d" />
      <div className="kshim3d" />

      {/* Top row */}
      <div className="flex items-center justify-between mb-3">
        <span style={{ fontFamily: 'var(--font-display)', fontSize: '10px', fontWeight: 700, letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--d-t3)' }}>{label}</span>
        <span className={`icon-badge ${variant.replace('k-', '')}`}>{icon}</span>
      </div>

      {/* Number */}
      <div className={`anim-num ${numClass}`}
        style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(32px,4vw,46px)', fontWeight: 800, letterSpacing: '-.06em', lineHeight: 1 }}>
        {value}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between mt-2.5">
        <span className={`kdelta kdelta-${deltaDir}`}>{delta}</span>
        <span style={{ fontSize: '10.5px', color: 'var(--d-t2)', fontWeight: 500 }}>{sub}</span>
      </div>

      {/* Sparkline */}
      <div className="spark3d">
        {sparks.map((h, i) => (
          <div key={i} className={`sp3d ${i === sparks.length - 1 ? 'hi' : ''}`} style={{ height: `${h}%` }} />
        ))}
      </div>
    </Link>
  );
}

/* ── Apt row ──────────────────────────── */
function AptRow({ time, ampm, initials, color, name, type, tag, tagClass }: any) {
  return (
    <div className="flex items-center gap-3 px-5 py-3 cursor-pointer transition-colors hover:bg-white/[.03]"
      style={{ borderBottom: '1px solid rgba(255,255,255,.04)' }}>
      <div className="flex-shrink-0 text-center w-9">
        <div style={{ fontFamily: 'var(--font-display)', fontSize: '11.5px', fontWeight: 800, color: 'var(--d-brand)', fontVariantNumeric: 'tabular-nums' }}>{time}</div>
        <div style={{ fontSize: '8px', color: 'var(--d-t3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>{ampm}</div>
      </div>
      <div className="w-px h-7 flex-shrink-0" style={{ background: 'rgba(255,255,255,.08)' }} />
      <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-white"
        style={{ background: color }} >
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        <div style={{ fontSize: '12.5px', fontWeight: 650, color: 'var(--d-t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
        <div style={{ fontSize: '10.5px', color: 'var(--d-t3)', marginTop: '1px' }}>{type}</div>
      </div>
      <div className={`hidden sm:block flex-shrink-0 text-[9px] font-bold px-2 py-0.5 rounded-full border ${tagClass}`}>{tag}</div>
    </div>
  );
}

/* ── Health row ───────────────────────── */
function HealthRow({ name, status, stat }: any) {
  return (
    <div className="flex items-center gap-2.5 py-2" style={{ borderBottom: '1px solid rgba(255,255,255,.05)' }}>
      <div className={`hind3d ${status}`} />
      <span className="flex-1" style={{ fontSize: '11.5px', fontWeight: 500, color: 'var(--d-t1)' }}>{name}</span>
      <span className={`text-[10px] font-bold ${status === 'ok' ? 'text-emerald-400' : status === 'warn' ? 'text-amber-400' : 'text-slate-500'}`}>{stat}</span>
    </div>
  );
}

/* ── Pipeline bar ─────────────────────── */
function PipeLine({ label, pct, color, count }: any) {
  return (
    <div className="flex items-center gap-2.5">
      <span style={{ fontSize: '11px', color: 'var(--d-t2)', width: '70px', flexShrink: 0 }}>{label}</span>
      <div className="pipe-track flex-1" style={{ background: 'rgba(255,255,255,.06)' }}>
        <div className="pipe-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span style={{ fontSize: '10.5px', fontWeight: 700, color: 'var(--d-t2)', width: '20px', textAlign: 'right', flexShrink: 0 }}>{count}</span>
    </div>
  );
}

/* ══════════════════════════════════════
   MAIN DASHBOARD
══════════════════════════════════════ */
const Dashboard = () => {
  const { user } = useAuth();
  const [showBanner, setShowBanner] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [greeting, setGreeting] = useState('Buenos días');
  const [dateLabel, setDateLabel] = useState('');

  /* Greeting + date */
  useEffect(() => {
    const update = () => {
      const now = new Date();
      const h = now.getHours();
      const days = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
      const months = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
      const d = `${days[now.getDay()]} ${now.getDate()} ${months[now.getMonth()]}`;
      const t = `${String(h).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
      setDateLabel(`${d} · ${t}`);
      setGreeting(h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches');
    };
    update();
    const id = setInterval(update, 30_000);
    return () => clearInterval(id);
  }, []);

  /* PWA banner */
  useEffect(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    const dismissed = sessionStorage.getItem('pwa-banner-dismissed');
    if (!isStandalone && !dismissed) setShowBanner(true);
    const handler = (e: Event) => { e.preventDefault(); setDeferredPrompt(e); };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (deferredPrompt) { (deferredPrompt as any).prompt(); }
    else { window.location.href = '/install'; }
    setShowBanner(false);
  };

  /* Data */
  const callStats = {
    total: mockCallRecords.length,
    completed: mockCallRecords.filter(c => c.status === 'completed').length,
    missed: mockCallRecords.filter(c => c.status === 'missed').length,
    avgDur: mockCallRecords.filter(c => c.duration > 0).reduce((a,c,_,arr) => a + c.duration / arr.length, 0),
  };
  const openWA    = mockWAConversations.filter(c => c.status === 'open' || c.status === 'pending').length;
  const unreadWA  = mockWAConversations.reduce((s,c) => s + c.unreadCount, 0);
  const pendingWA = mockWAConversations.filter(c => c.status === 'pending').length;
  const closedWA  = mockWAConversations.filter(c => c.status === 'closed').length;
  const upcomingApts = mockAppointments.filter(a => a.status === 'scheduled' || a.status === 'confirmed');
  const activeProjects = projects.filter(p => p.status === 'active');
  const successRate = callStats.total ? Math.round((callStats.completed / callStats.total) * 100) : 0;
  const avgMin = Math.floor(callStats.avgDur / 60);
  const avgSec = Math.round(callStats.avgDur % 60);

  const userName = user?.email?.split('@')[0] || 'Usuario';

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-7xl mx-auto" style={{ fontFamily: 'var(--font-body)' }}>

      {/* PWA Banner */}
      {showBanner && (
        <div className="flex items-center gap-3 rounded-2xl p-4 anim-fade-up"
          style={{ background: 'rgba(0,255,198,.07)', border: '1px solid rgba(0,255,198,.14)' }}>
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg,var(--d-brand),var(--d-brand2))' }}>
            <Download size={18} className="text-black" />
          </div>
          <div className="flex-1 min-w-0">
            <p style={{ fontSize: '13px', fontWeight: 700, color: 'var(--d-t1)' }}>Instala la app</p>
            <p style={{ fontSize: '11px', color: 'var(--d-t2)' }}>Acceso directo desde tu pantalla de inicio</p>
          </div>
          <button onClick={handleInstall}
            className="flex-shrink-0 text-black text-xs font-bold px-4 py-2 rounded-xl transition-opacity hover:opacity-90"
            style={{ background: 'linear-gradient(135deg,var(--d-brand),var(--d-brand2))' }}>
            Instalar
          </button>
          <button onClick={() => { setShowBanner(false); sessionStorage.setItem('pwa-banner-dismissed','1'); }}
            className="flex-shrink-0 p-1.5 rounded-full" style={{ color: 'var(--d-t3)' }}>
            <X size={15} />
          </button>
        </div>
      )}

      {/* ── PAGE HEADER ── */}
      <div className="flex items-end justify-between flex-wrap gap-3 anim-fade-up delay-0">
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(18px,3.5vw,28px)', fontWeight: 800, letterSpacing: '-.04em', color: 'var(--d-t1)', lineHeight: 1.15 }}>
            {greeting},{' '}
            <span className="grad-brand">{userName}</span>
          </h1>
          <p style={{ fontSize: '13px', color: 'var(--d-t2)', marginTop: '4px' }}>
            Tu operación de hoy
            <span style={{ marginLeft: '8px', color: 'var(--d-brand)', fontSize: '11px' }}>
              <span className="live-dot" style={{ marginRight: '5px' }} />
              En vivo
            </span>
          </p>
        </div>
        <div className="text-[11.5px] font-medium px-4 py-2 rounded-full"
          style={{ background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.08)', color: 'var(--d-t3)', whiteSpace: 'nowrap', flexShrink: 0 }}>
          {dateLabel}
        </div>
      </div>

      {/* ── KPI GRID ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" style={{ perspective: '1400px' }}>
        <KpiCard
          label="Llamadas hoy" value={callStats.total} sub={`${callStats.completed} completas`}
          delta={`${successRate}% éxito`} deltaDir="up"
          variant="k-brand" numClass="knum-brand"
          sparks={[40,60,45,80,55,70,100]}
          icon={<Phone size={13} />} link="/calls" delay="delay-0"
        />
        <KpiCard
          label="WhatsApp" value={openWA} sub={`${unreadWA} sin leer`}
          delta={pendingWA > 0 ? `${pendingWA} sin asignar` : '— igual'} deltaDir={pendingWA > 0 ? 'dn' : 'eq'}
          variant="k-violet" numClass="knum-violet"
          sparks={[60,40,75,50,85,65,57]}
          icon={<MessageSquare size={13} />} link="/whatsapp" delay="delay-1"
        />
        <KpiCard
          label="Citas próximas" value={upcomingApts.length} sub={`${upcomingApts.filter(a => a.status === 'confirmed').length} confirmadas`}
          delta="↑ hoy" deltaDir="up"
          variant="k-amber" numClass="knum-amber"
          sparks={[30,55,70,45,80,60,36]}
          icon={<CalendarPlus size={13} />} link="/appointments" delay="delay-2"
        />
        <KpiCard
          label="Perdidas" value={callStats.missed} sub={`${callStats.total ? Math.round((callStats.missed/callStats.total)*100) : 0}% tasa`}
          delta={callStats.missed <= 3 ? '↓ vs ayer' : '↑ revisar'} deltaDir={callStats.missed <= 3 ? 'up' : 'dn'}
          variant="k-rose" numClass="knum-rose"
          sparks={[80,65,55,70,45,35,21]}
          icon={<PhoneMissed size={13} />} link="/calls" delay="delay-3"
        />
      </div>

      {/* ── CONTENT GRID ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 anim-fade-up delay-4">

        {/* Próximas citas */}
        <div className="panel3d">
          <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: '1px solid rgba(255,255,255,.06)' }}>
            <div className="flex items-center gap-2" style={{ fontFamily: 'var(--font-display)', fontSize: '13px', fontWeight: 700, color: 'var(--d-t1)' }}>
              <div className="w-2 h-2 rounded-full" style={{ background: 'var(--d-brand)', boxShadow: '0 0 6px var(--d-brand)' }} />
              Próximas citas
            </div>
            <Link to="/appointments" className="text-[11px] font-semibold flex items-center gap-1 hover:opacity-100 opacity-70 transition-opacity"
              style={{ color: 'var(--d-brand)' }}>Ver todas <ArrowRight size={11} /></Link>
          </div>
          {upcomingApts.slice(0, 4).map((apt, i) => (
            <AptRow key={apt.id}
              time={format(apt.startAt, 'H:mm')}
              ampm={format(apt.startAt, 'a').toUpperCase()}
              initials={apt.contactName.split(' ').map((n: string) => n[0]).join('').slice(0,2)}
              color={['linear-gradient(135deg,#00ffc6,#00c4ff)', 'linear-gradient(135deg,#a374ff,#6366f1)', 'linear-gradient(135deg,#ffb520,#f97316)', 'linear-gradient(135deg,#38d9ff,#0284c7)'][i % 4]}
              name={apt.contactName}
              type={apt.serviceType}
              tag={apt.status === 'confirmed' ? 'Confirmada' : 'Agendada'}
              tagClass={apt.status === 'confirmed'
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                : 'bg-violet-500/10 text-violet-400 border-violet-500/20'}
            />
          ))}
        </div>

        {/* Actividad 7 días */}
        <div className="panel3d">
          <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: '1px solid rgba(255,255,255,.06)' }}>
            <div className="flex items-center gap-2" style={{ fontFamily: 'var(--font-display)', fontSize: '13px', fontWeight: 700, color: 'var(--d-t1)' }}>
              <div className="w-2 h-2 rounded-full" style={{ background: 'var(--d-violet)', boxShadow: '0 0 6px var(--d-violet)' }} />
              Actividad · 7 días
            </div>
            <Link to="/calls" className="text-[11px] font-semibold flex items-center gap-1 hover:opacity-100 opacity-70 transition-opacity"
              style={{ color: 'var(--d-brand)' }}>Detalles <ArrowRight size={11} /></Link>
          </div>
          <div className="px-5 py-4">
            {/* Legend */}
            <div className="flex items-center gap-4 mb-4 flex-wrap">
              {[['Llamadas', 'var(--d-brand)', callStats.total], ['Citas', 'var(--d-amber)', upcomingApts.length], ['WhatsApp', 'var(--d-violet)', openWA]].map(([name, color, val]) => (
                <div key={name as string} className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: color as string }} />
                  <span style={{ fontSize: '11px', color: 'var(--d-t3)' }}>{name as string}</span>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--d-t2)', marginLeft: '2px' }}>{val as number}</span>
                </div>
              ))}
            </div>
            {/* Bars */}
            <div className="flex items-end gap-1.5" style={{ height: '100px' }}>
              {[
                { day: 'Lu', pct: 52, today: false },
                { day: 'Ma', pct: 72, today: false },
                { day: 'Mi', pct: 44, today: false },
                { day: 'Ju', pct: 88, today: false },
                { day: 'Vi', pct: 62, today: false },
                { day: 'Sa', pct: 28, today: false },
                { day: 'Hoy', pct: 55, today: true },
              ].map(({ day, pct, today }) => (
                <div key={day} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                  <div className="w-full rounded-t-sm" style={{
                    height: `${pct}%`,
                    background: today
                      ? 'linear-gradient(180deg, var(--d-brand), var(--d-brand2))'
                      : 'rgba(255,255,255,.12)',
                    boxShadow: today ? '0 0 8px rgba(0,255,198,.3)' : 'none',
                  }} />
                  <div style={{ fontSize: '8.5px', fontWeight: today ? 800 : 700, color: today ? 'var(--d-brand)' : 'var(--d-t3)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{day}</div>
                </div>
              ))}
            </div>
          </div>
          {/* Calls summary mini */}
          <div className="px-5 pb-4">
            <div className="rounded-xl p-3 flex items-center gap-4" style={{ background: 'rgba(0,255,198,.05)', border: '1px solid rgba(0,255,198,.1)' }}>
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: '28px', fontWeight: 800, letterSpacing: '-.05em', background: 'linear-gradient(135deg,var(--d-t1) 40%,var(--d-brand))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>{callStats.total}</div>
                <div style={{ fontSize: '10px', color: 'var(--d-t3)', fontWeight: 500 }}>hoy</div>
              </div>
              <div className="w-px h-10 flex-shrink-0" style={{ background: 'rgba(255,255,255,.08)' }} />
              <div className="flex gap-4 flex-wrap">
                {[
                  { n: callStats.completed, l: 'Completas', c: 'var(--d-brand)' },
                  { n: callStats.missed, l: 'Perdidas', c: 'var(--d-rose)' },
                  { n: `${avgMin}m${avgSec}s`, l: 'Promedio', c: 'var(--d-amber)' },
                  { n: `${successRate}%`, l: 'Éxito', c: 'var(--d-violet)' },
                ].map(({ n, l, c }) => (
                  <div key={l}>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: '17px', fontWeight: 800, letterSpacing: '-.03em', color: c }}>{n}</div>
                    <div style={{ fontSize: '9.5px', color: 'var(--d-t3)', fontWeight: 500 }}>{l}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right Panel — estado + acciones + equipo */}
        <div className="panel3d md:col-span-2 xl:col-span-1">
          {/* Sistema */}
          <div className="px-4 py-3.5" style={{ borderBottom: '1px solid rgba(255,255,255,.06)' }}>
            <div style={{ fontSize: '9px', fontWeight: 800, color: 'var(--d-t3)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '10px' }}>Estado del sistema</div>
            <HealthRow name="Agente de voz"  status="ok"   stat="Activo" />
            <HealthRow name="WhatsApp Bot"   status="ok"   stat="Activo" />
            <HealthRow name="ElevenLabs"     status="ok"   stat="Conectado" />
            <HealthRow name="Google Cal."    status="warn" stat="Token vence" />
            <HealthRow name="Supabase DB"    status="ok"   stat="99.9%" />
          </div>

          {/* Acciones */}
          <div className="px-4 py-3.5" style={{ borderBottom: '1px solid rgba(255,255,255,.06)' }}>
            <div style={{ fontSize: '9px', fontWeight: 800, color: 'var(--d-t3)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '8px' }}>Acciones rápidas</div>
            {[
              { icon: '📞', label: 'Nueva llamada', sub: 'Marcar número', link: '/calls', color: 'rgba(0,255,198,.08)' },
              { icon: '💬', label: 'WhatsApp inbox', sub: `${unreadWA} sin leer`, link: '/whatsapp', color: 'rgba(163,116,255,.08)' },
              { icon: '📅', label: 'Agendar cita', sub: 'Ver disponibilidad', link: '/appointments', color: 'rgba(255,181,32,.08)' },
              { icon: '📊', label: 'Analytics', sub: 'Reporte del mes', link: '/calls', color: 'rgba(56,217,255,.08)' },
            ].map(({ icon, label, sub, link, color }) => (
              <Link key={label} to={link}
                className="flex items-center gap-2.5 p-2 rounded-xl mb-0.5 transition-colors hover:bg-white/[.04]">
                <div className="w-8 h-8 rounded-[9px] flex items-center justify-center text-[14px] flex-shrink-0" style={{ background: color }}>{icon}</div>
                <div className="flex-1">
                  <div style={{ fontSize: '12px', fontWeight: 650, color: 'var(--d-t1)' }}>{label}</div>
                  <div style={{ fontSize: '10px', color: 'var(--d-t3)', marginTop: '1px' }}>{sub}</div>
                </div>
                <ArrowRight size={13} style={{ color: 'var(--d-t3)' }} />
              </Link>
            ))}
          </div>

          {/* Equipo */}
          <div className="px-4 py-3.5">
            <div style={{ fontSize: '9px', fontWeight: 800, color: 'var(--d-t3)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '10px' }}>Equipo activo</div>
            {[
              { initials: userName.slice(0,2).toUpperCase(), name: userName, role: 'Tú', status: 'on', color: 'linear-gradient(135deg,#00ffc6,#00c4ff)', time: '' },
              { initials: 'SM', name: 'Sara Méndez', role: 'Agente', status: 'on', color: 'linear-gradient(135deg,#a374ff,#6366f1)', time: '2m' },
              { initials: 'RV', name: 'Roberto Vega', role: 'Soporte', status: 'aw', color: 'linear-gradient(135deg,#ffb520,#f97316)', time: '18m' },
              { initials: 'LP', name: 'Laura Pérez', role: 'Admin', status: 'of', color: 'linear-gradient(135deg,#38d9ff,#0284c7)', time: 'ayer' },
            ].map(({ initials, name, role, status, color, time }) => (
              <div key={name} className="flex items-center gap-2.5 mb-2.5 last:mb-0">
                <div className="relative w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-[9.5px] font-extrabold text-white"
                  style={{ background: color }}>
                  {initials}
                  <div className={`presence-dot ${status}`} style={{ borderColor: 'var(--d-s1)' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--d-t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                  <div style={{ fontSize: '9.5px', color: 'var(--d-t3)' }}>{role}</div>
                </div>
                <div style={{ fontSize: '10px', color: 'var(--d-t3)' }}>{time}</div>
              </div>
            ))}
          </div>
        </div>

        {/* WhatsApp Pipeline */}
        <div className="panel3d">
          <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: '1px solid rgba(255,255,255,.06)' }}>
            <div className="flex items-center gap-2" style={{ fontFamily: 'var(--font-display)', fontSize: '13px', fontWeight: 700, color: 'var(--d-t1)' }}>
              <div className="w-2 h-2 rounded-full" style={{ background: 'var(--d-violet)', boxShadow: '0 0 6px var(--d-violet)' }} />
              WhatsApp pipeline
            </div>
            <Link to="/whatsapp" className="text-[11px] font-semibold flex items-center gap-1 hover:opacity-100 opacity-70 transition-opacity"
              style={{ color: 'var(--d-brand)' }}>Ir al inbox <ArrowRight size={11} /></Link>
          </div>
          <div className="px-5 py-4">
            <div className="flex gap-5 mb-5 flex-wrap">
              {[
                { n: openWA + closedWA, l: 'Activas', c: 'var(--d-t1)' },
                { n: unreadWA, l: 'Sin resp.', c: 'var(--d-rose)' },
                { n: closedWA, l: 'Resueltas', c: 'var(--d-emerald)' },
              ].map(({ n, l, c }) => (
                <div key={l}>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: '26px', fontWeight: 800, letterSpacing: '-.04em', color: c }}>{n}</div>
                  <div style={{ fontSize: '10px', color: 'var(--d-t3)', marginTop: '2px', fontWeight: 500 }}>{l}</div>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-2.5">
              <PipeLine label="Abiertos"   pct={68} color="linear-gradient(90deg,var(--d-brand),var(--d-brand2))" count={openWA} />
              <PipeLine label="Pendientes" pct={21} color="var(--d-amber)"  count={pendingWA} />
              <PipeLine label="Bot activo" pct={55} color="var(--d-violet)" count={Math.round(openWA * .6)} />
              <PipeLine label="Cerrados"   pct={10} color="rgba(255,255,255,.2)" count={closedWA} />
            </div>
          </div>
        </div>

        {/* Proyectos activos */}
        <div className="panel3d">
          <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: '1px solid rgba(255,255,255,.06)' }}>
            <div className="flex items-center gap-2" style={{ fontFamily: 'var(--font-display)', fontSize: '13px', fontWeight: 700, color: 'var(--d-t1)' }}>
              <div className="w-2 h-2 rounded-full" style={{ background: 'var(--d-amber)', boxShadow: '0 0 6px var(--d-amber)' }} />
              Proyectos activos
            </div>
            <Link to="/projects" className="text-[11px] font-semibold flex items-center gap-1 hover:opacity-100 opacity-70 transition-opacity"
              style={{ color: 'var(--d-brand)' }}>Ver todos <ArrowRight size={11} /></Link>
          </div>
          <div className="px-5 py-4 flex flex-col gap-3">
            {activeProjects.slice(0, 4).map(proj => (
              <div key={proj.id} className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.06)' }}>
                <div className="flex items-center justify-between mb-2">
                  <span style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--d-t1)' }}>{proj.name}</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{
                    background: proj.progress >= 60 ? 'rgba(0,232,122,.1)' : proj.progress >= 30 ? 'rgba(255,181,32,.1)' : 'rgba(255,79,114,.1)',
                    color: proj.progress >= 60 ? 'var(--d-emerald)' : proj.progress >= 30 ? 'var(--d-amber)' : 'var(--d-rose)',
                  }}>{proj.progress}%</span>
                </div>
                <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,.08)' }}>
                  <div className="h-full rounded-full transition-all" style={{
                    width: `${proj.progress}%`,
                    background: proj.progress >= 60
                      ? 'linear-gradient(90deg,var(--d-brand),var(--d-brand2))'
                      : proj.progress >= 30
                        ? 'var(--d-amber)'
                        : 'var(--d-rose)',
                    boxShadow: proj.progress >= 60 ? '0 0 6px rgba(0,255,198,.3)' : 'none',
                  }} />
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>{/* /content grid */}
    </div>
  );
};

export default Dashboard;
