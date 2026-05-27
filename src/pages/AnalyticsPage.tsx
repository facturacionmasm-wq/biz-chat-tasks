import { useState, useEffect, useCallback } from 'react';
import {
  BarChart3, Phone, MessageSquare, CalendarPlus, TrendingUp,
  TrendingDown, Users, Clock, CheckCircle2, XCircle,
  Loader2, ChevronDown, ArrowUpRight, Zap,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { format, subDays, eachDayOfInterval, startOfDay } from 'date-fns';
import { es } from 'date-fns/locale';

type Period = '7d' | '30d' | '90d';

interface DailyPoint {
  date: string;
  calls: number;
  appointments: number;
  whatsapp: number;
}

interface Stats {
  totalCalls: number;
  completedCalls: number;
  missedCalls: number;
  avgCallDuration: number;
  totalAppointments: number;
  confirmedAppointments: number;
  cancelledAppointments: number;
  totalWAMessages: number;
  openConversations: number;
  totalContacts: number;
  newContacts: number;
}

const EMPTY_STATS: Stats = {
  totalCalls: 0, completedCalls: 0, missedCalls: 0, avgCallDuration: 0,
  totalAppointments: 0, confirmedAppointments: 0, cancelledAppointments: 0,
  totalWAMessages: 0, openConversations: 0, totalContacts: 0, newContacts: 0,
};

const formatDuration = (seconds: number) => {
  if (!seconds) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
};

const MiniChart = ({ data, color = 'hsl(170 60% 40%)' }: { data: number[]; color?: string }) => {
  if (!data.length) return null;
  const max = Math.max(...data, 1);
  const height = 40;
  const width = data.length * 12;

  return (
    <svg width={width} height={height} className="overflow-visible">
      {data.map((val, i) => {
        const barH = (val / max) * height;
        return (
          <rect
            key={i}
            x={i * 12}
            y={height - barH}
            width={9}
            height={Math.max(barH, 2)}
            rx={2}
            fill={color}
            opacity={i === data.length - 1 ? 1 : 0.4 + (i / data.length) * 0.5}
          />
        );
      })}
    </svg>
  );
};

const StatCard = ({
  label, value, subtitle, icon: Icon, trend, trendLabel, chartData, color,
}: {
  label: string;
  value: string | number;
  subtitle?: string;
  icon: any;
  trend?: number;
  trendLabel?: string;
  chartData?: number[];
  color?: string;
}) => (
  <div className="rx-panel">
    <div className="flex items-start justify-between mb-3">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${color || 'bg-primary/10'}`}>
        <Icon size={18} className={color ? 'text-white' : 'text-[var(--rx-brand)]'} />
      </div>
      {trend !== undefined && (
        <div className={`flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full ${
          trend >= 0 ? 'bg-[rgba(0,232,122,.1)] text-[var(--rx-emerald)]' : 'bg-destructive/10 text-[var(--rx-rose)]'
        }`}>
          {trend >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
          {Math.abs(trend)}%
        </div>
      )}
    </div>
    <div className="text-2xl font-extrabold text-foreground mb-0.5">{value}</div>
    <div className="text-xs font-medium text-[var(--rx-t2)]">{label}</div>
    {subtitle && <div className="text-[10px] text-[var(--rx-t2)] mt-0.5">{subtitle}</div>}
    {chartData && chartData.length > 0 && (
      <div className="mt-3 overflow-hidden">
        <MiniChart data={chartData} />
      </div>
    )}
    {trendLabel && (
      <div className="text-[10px] text-[var(--rx-t2)] mt-1">{trendLabel}</div>
    )}
  </div>
);

export default function AnalyticsPage() {
  const { user } = useAuth();
  const [period, setPeriod] = useState<Period>('30d');
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [dailyData, setDailyData] = useState<DailyPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [tenantId, setTenantId] = useState<string | null>(null);

  const periodDays = { '7d': 7, '30d': 30, '90d': 90 }[period];

  const fetchData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data: tid } = await supabase.rpc('get_user_tenant_id', { _user_id: user.id });
      if (!tid) return;
      setTenantId(tid);

      const since = subDays(new Date(), periodDays).toISOString();
      const now = new Date().toISOString();

      const [callsRes, appointmentsRes, waMessagesRes, waConvsRes, contactsRes, newContactsRes] = await Promise.all([
        supabase.from('call_records').select('id, status, duration, started_at').eq('tenant_id', tid).gte('started_at', since).is('deleted_at', null),
        supabase.from('appointments').select('id, status, start_at').eq('tenant_id', tid).gte('created_at', since).is('deleted_at', null),
        supabase.from('whatsapp_messages').select('id, created_at').eq('tenant_id', tid).gte('created_at', since),
        supabase.from('whatsapp_conversations').select('id, status').eq('tenant_id', tid).neq('status', 'closed'),
        supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('tenant_id', tid),
        supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('tenant_id', tid).gte('created_at', since),
      ]);

      const calls = callsRes.data || [];
      const appointments = appointmentsRes.data || [];
      const waMessages = waMessagesRes.data || [];
      const waConvs = waConvsRes.data || [];

      const completedCalls = calls.filter(c => c.status === 'completed');
      const durations = completedCalls.map(c => c.duration || 0).filter(Boolean);
      const avgDuration = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;

      setStats({
        totalCalls: calls.length,
        completedCalls: completedCalls.length,
        missedCalls: calls.filter(c => c.status === 'missed' || c.status === 'no-answer').length,
        avgCallDuration: avgDuration,
        totalAppointments: appointments.length,
        confirmedAppointments: appointments.filter(a => a.status === 'confirmed' || a.status === 'scheduled').length,
        cancelledAppointments: appointments.filter(a => a.status === 'cancelled').length,
        totalWAMessages: waMessages.length,
        openConversations: waConvs.filter(c => c.status === 'open').length,
        totalContacts: contactsRes.count || 0,
        newContacts: newContactsRes.count || 0,
      });

      // Build daily breakdown
      const days = eachDayOfInterval({
        start: subDays(new Date(), periodDays - 1),
        end: new Date(),
      });

      const points: DailyPoint[] = days.map(day => {
        const dayStr = format(day, 'yyyy-MM-dd');
        const dayStart = startOfDay(day).toISOString();
        const dayEnd = new Date(day.setHours(23, 59, 59, 999)).toISOString();

        return {
          date: dayStr,
          calls: calls.filter(c => c.started_at >= dayStart && c.started_at <= dayEnd).length,
          appointments: appointments.filter(a => a.start_at >= dayStart && a.start_at <= dayEnd).length,
          whatsapp: waMessages.filter(m => m.created_at >= dayStart && m.created_at <= dayEnd).length,
        };
      });

      setDailyData(points);
    } catch (err) {
      console.error('[Analytics] error:', err);
    } finally {
      setLoading(false);
    }
  }, [user, periodDays]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const callsChartData = dailyData.map(d => d.calls);
  const appointmentsChartData = dailyData.map(d => d.appointments);
  const waChartData = dailyData.map(d => d.whatsapp);

  const callCompletionRate = stats.totalCalls
    ? Math.round((stats.completedCalls / stats.totalCalls) * 100)
    : 0;

  const appointmentSuccessRate = stats.totalAppointments
    ? Math.round((stats.confirmedAppointments / stats.totalAppointments) * 100)
    : 0;

  // Simple bar chart component
  const BarChartSection = ({ data, label }: { data: DailyPoint[]; label: string }) => {
    const max = Math.max(...data.map(d => d.calls + d.appointments + d.whatsapp), 1);
    const visibleDays = period === '7d' ? data : data.filter((_, i) => i % 3 === 0);

    return (
      <div className="rx-panel">
        <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
          <BarChart3 size={15} className="text-[var(--rx-brand)]" /> {label}
        </h3>
        <div className="flex items-end gap-1 h-32 mb-2 overflow-hidden">
          {visibleDays.map((day, i) => {
            const callH = (day.calls / max) * 128;
            const aptH = (day.appointments / max) * 128;
            const waH = (day.whatsapp / max) * 128;
            return (
              <div key={day.date} className="flex-1 flex flex-col items-center gap-0.5 group relative">
                <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-foreground text-background text-[9px] px-1.5 py-0.5 rounded hidden group-hover:block whitespace-nowrap z-10">
                  {format(new Date(day.date), 'd MMM', { locale: es })}
                  <br/>C:{day.calls} A:{day.appointments} WA:{day.whatsapp}
                </div>
                <div style={{ height: Math.max(waH, 2) }} className="w-full bg-green-400/60 rounded-t-sm" />
                <div style={{ height: Math.max(aptH, 2) }} className="w-full bg-amber-400/70 rounded-t-sm" />
                <div style={{ height: Math.max(callH, 2) }} className="w-full bg-primary/70 rounded-t-sm" />
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-4 text-[10px] text-[var(--rx-t2)]">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-primary/70 inline-block" /> Llamadas</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-amber-400/70 inline-block" /> Citas</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-green-400/60 inline-block" /> WhatsApp</span>
        </div>
      </div>
    );
  };

  return (
    <div className="rx-page">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <BarChart3 size={20} className="text-[var(--rx-brand)]" /> Analytics
          </h1>
          <p className="text-sm text-[var(--rx-t2)] mt-0.5">Métricas de rendimiento en tiempo real</p>
        </div>
        <div className="flex items-center gap-1 bg-[var(--rx-s2)] rounded-xl p-1">
          {(['7d', '30d', '90d'] as Period[]).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-all ${
                period === p
                  ? 'bg-card text-foreground shadow-soft'
                  : 'text-[var(--rx-t2)] hover:text-foreground'
              }`}
            >
              {p === '7d' ? '7 días' : p === '30d' ? '30 días' : '90 días'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 size={28} className="animate-spin text-[var(--rx-brand)]" />
        </div>
      ) : (
        <div className="space-y-5">
          {/* KPI Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard
              label="Llamadas totales"
              value={stats.totalCalls}
              subtitle={`${callCompletionRate}% completadas`}
              icon={Phone}
              chartData={callsChartData}
              color="bg-blue-500"
            />
            <StatCard
              label="Citas agendadas"
              value={stats.totalAppointments}
              subtitle={`${appointmentSuccessRate}% confirmadas`}
              icon={CalendarPlus}
              chartData={appointmentsChartData}
              color="bg-amber-500"
            />
            <StatCard
              label="Mensajes WhatsApp"
              value={stats.totalWAMessages}
              subtitle={`${stats.openConversations} conv. abiertas`}
              icon={MessageSquare}
              chartData={waChartData}
              color="bg-green-500"
            />
            <StatCard
              label="Contactos totales"
              value={stats.totalContacts}
              subtitle={`+${stats.newContacts} nuevos en el período`}
              icon={Users}
              color="bg-violet-500"
            />
          </div>

          {/* Secondary KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              {
                label: 'Duración prom. llamada',
                value: formatDuration(stats.avgCallDuration),
                icon: Clock,
                desc: 'De llamadas completadas',
              },
              {
                label: 'Llamadas perdidas',
                value: stats.missedCalls,
                icon: XCircle,
                desc: `${stats.totalCalls ? Math.round((stats.missedCalls / stats.totalCalls) * 100) : 0}% del total`,
              },
              {
                label: 'Citas canceladas',
                value: stats.cancelledAppointments,
                icon: XCircle,
                desc: `${stats.totalAppointments ? Math.round((stats.cancelledAppointments / stats.totalAppointments) * 100) : 0}% del total`,
              },
              {
                label: 'Citas confirmadas',
                value: stats.confirmedAppointments,
                icon: CheckCircle2,
                desc: 'Activas o futuras',
              },
            ].map(item => (
              <div key={item.label} className="rx-panel">
                <div className="flex items-center gap-2 mb-2">
                  <item.icon size={14} className="text-[var(--rx-t2)]" />
                  <span className="text-xs text-[var(--rx-t2)]">{item.label}</span>
                </div>
                <div className="rx-page-title">{item.value}</div>
                <div className="text-[10px] text-[var(--rx-t2)] mt-0.5">{item.desc}</div>
              </div>
            ))}
          </div>

          {/* Chart */}
          <BarChartSection
            data={dailyData}
            label={`Actividad diaria — últimos ${periodDays} días`}
          />

          {/* Performance summary */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              {
                title: 'Tasa de éxito en llamadas',
                value: `${callCompletionRate}%`,
                desc: `${stats.completedCalls} completadas de ${stats.totalCalls}`,
                icon: Phone,
                good: callCompletionRate >= 70,
              },
              {
                title: 'Tasa de confirmación de citas',
                value: `${appointmentSuccessRate}%`,
                desc: `${stats.confirmedAppointments} confirmadas de ${stats.totalAppointments}`,
                icon: CalendarPlus,
                good: appointmentSuccessRate >= 60,
              },
              {
                title: 'Conversaciones abiertas',
                value: stats.openConversations,
                desc: `De ${stats.totalContacts} contactos totales`,
                icon: MessageSquare,
                good: stats.openConversations < 50,
              },
            ].map(item => (
              <div key={item.title} className="rx-panel">
                <div className="flex items-center justify-between mb-3">
                  <item.icon size={14} className="text-[var(--rx-t2)]" />
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                    item.good ? 'bg-[rgba(0,232,122,.1)] text-[var(--rx-emerald)]' : 'bg-warning/10 text-[var(--rx-amber)]'
                  }`}>
                    {item.good ? 'Bueno' : 'Mejorable'}
                  </span>
                </div>
                <div className="text-2xl font-extrabold text-foreground mb-0.5">{item.value}</div>
                <div className="text-xs font-medium text-foreground mb-0.5">{item.title}</div>
                <div className="text-[10px] text-[var(--rx-t2)]">{item.desc}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
