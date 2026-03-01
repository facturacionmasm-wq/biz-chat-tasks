import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, CartesianGrid } from 'recharts';
import { Phone, Clock, CalendarPlus, TrendingUp, AlertTriangle } from 'lucide-react';
import { format, subDays, startOfDay, eachDayOfInterval } from 'date-fns';
import { es } from 'date-fns/locale';

interface CallAnalyticsProps {
  calls: any[];
  jobs: any[];
}

const COLORS = ['hsl(170, 60%, 40%)', 'hsl(38, 92%, 50%)', 'hsl(0, 72%, 51%)', 'hsl(220, 10%, 46%)'];

const CallAnalytics = ({ calls, jobs }: CallAnalyticsProps) => {
  const analytics = useMemo(() => {
    const now = new Date();
    const last30 = subDays(now, 30);
    const recentCalls = calls.filter(c => new Date(c.startedAt || c.created_at) >= last30);

    // Calls per day
    const days = eachDayOfInterval({ start: last30, end: now });
    const callsPerDay = days.map(day => {
      const dayStart = startOfDay(day);
      const count = recentCalls.filter(c => {
        const d = startOfDay(new Date(c.startedAt || c.created_at));
        return d.getTime() === dayStart.getTime();
      }).length;
      return { date: format(day, 'd MMM', { locale: es }), calls: count };
    });

    // Status distribution
    const statusCounts: Record<string, number> = {};
    recentCalls.forEach(c => {
      const s = c.status || 'pending';
      statusCounts[s] = (statusCounts[s] || 0) + 1;
    });
    const statusData = Object.entries(statusCounts).map(([name, value]) => ({ name, value }));

    // Avg duration
    const completedCalls = recentCalls.filter(c => c.duration > 0);
    const avgDuration = completedCalls.length > 0
      ? Math.round(completedCalls.reduce((s, c) => s + c.duration, 0) / completedCalls.length)
      : 0;

    // Appointment rate
    const withAppointment = recentCalls.filter(c => c.extractedData?.appointmentRequested).length;
    const appointmentRate = recentCalls.length > 0 ? Math.round((withAppointment / recentCalls.length) * 100) : 0;

    // Duration trend (weekly avg)
    const durationTrend = days.filter((_, i) => i % 7 === 0).map(day => {
      const weekCalls = recentCalls.filter(c => {
        const d = new Date(c.startedAt || c.created_at);
        return d >= day && d < subDays(day, -7) && c.duration > 0;
      });
      const avg = weekCalls.length > 0
        ? Math.round(weekCalls.reduce((s, c) => s + c.duration, 0) / weekCalls.length)
        : 0;
      return { date: format(day, 'd MMM', { locale: es }), avgDuration: avg };
    });

    // Job success rate
    const totalJobs = jobs.length;
    const successJobs = jobs.filter(j => j.status === 'success').length;
    const errorJobs = jobs.filter(j => j.status === 'error').length;
    const jobSuccessRate = totalJobs > 0 ? Math.round((successJobs / totalJobs) * 100) : 100;

    return {
      callsPerDay,
      statusData,
      avgDuration,
      appointmentRate,
      durationTrend,
      totalCalls: recentCalls.length,
      completedCalls: completedCalls.length,
      jobSuccessRate,
      errorJobs,
    };
  }, [calls, jobs]);

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Phone size={14} />
            <span className="text-xs">Llamadas (30d)</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{analytics.totalCalls}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Clock size={14} />
            <span className="text-xs">Duración promedio</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{formatDuration(analytics.avgDuration)}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <CalendarPlus size={14} />
            <span className="text-xs">Tasa de citas</span>
          </div>
          <p className="text-2xl font-bold text-primary">{analytics.appointmentRate}%</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <TrendingUp size={14} />
            <span className="text-xs">Éxito pipeline</span>
          </div>
          <p className="text-2xl font-bold text-success">{analytics.jobSuccessRate}%</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <AlertTriangle size={14} />
            <span className="text-xs">Jobs con error</span>
          </div>
          <p className="text-2xl font-bold text-destructive">{analytics.errorJobs}</p>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Calls per day */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-foreground mb-4">📊 Llamadas por día</h3>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analytics.callsPerDay}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
                <Bar dataKey="calls" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Status distribution */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-foreground mb-4">📈 Distribución de estados</h3>
          <div className="h-48 flex items-center justify-center">
            {analytics.statusData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={analytics.statusData}
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={70}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {analytics.statusData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground">Sin datos</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2 mt-2 justify-center">
            {analytics.statusData.map((entry, i) => (
              <div key={entry.name} className="flex items-center gap-1.5 text-xs">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                <span className="text-muted-foreground capitalize">{entry.name}: {entry.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Duration trend */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm lg:col-span-2">
          <h3 className="text-sm font-semibold text-foreground mb-4">⏱️ Tendencia de duración (promedio semanal)</h3>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={analytics.durationTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                <Tooltip
                  formatter={(v: number) => [`${formatDuration(v)}`, 'Duración']}
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
                <Line type="monotone" dataKey="avgDuration" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CallAnalytics;
