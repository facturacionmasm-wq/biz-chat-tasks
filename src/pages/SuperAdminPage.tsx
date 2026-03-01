import { useAuth } from '@/contexts/AuthContext';
import { Navigate } from 'react-router-dom';
import { useSuperAdminData } from '@/hooks/useSuperAdminData';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  DollarSign, TrendingUp, TrendingDown, AlertTriangle, ShieldAlert,
  Users, Gift, BarChart3, Activity, ArrowUpRight, ArrowDownRight,
  Loader2,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell,
} from 'recharts';

const fmt = (n: number) => `$${n.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const fmtPct = (n: number) => `${n.toFixed(1)}%`;

const severityColor: Record<string, string> = {
  critical: 'bg-destructive/10 text-destructive',
  warning: 'bg-warning/10 text-warning',
  info: 'bg-primary/10 text-primary',
};

const riskColor: Record<string, string> = {
  high: 'text-destructive',
  medium: 'text-warning',
  low: 'text-success',
};

const SuperAdminPage = () => {
  const { userRole, loading } = useAuth();

  if (loading) return <div className="flex items-center justify-center h-full"><Loader2 className="animate-spin text-primary" size={32} /></div>;
  if (userRole !== 'super_admin') return <Navigate to="/" replace />;

  return <SuperAdminDashboard />;
};

const SuperAdminDashboard = () => {
  const { margins, fraudAlerts, churnScores, retentionOffers, pricingEvals, marginMetrics, totals } = useSuperAdminData();

  const isLoading = margins.isLoading || fraudAlerts.isLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="animate-spin text-primary" size={32} />
      </div>
    );
  }

  // Projection data from margin_metrics
  const projectionData = (marginMetrics.data || [])
    .slice(0, 30)
    .reverse()
    .map(m => ({
      date: format(new Date(m.metric_date), 'd MMM', { locale: es }),
      revenue: Number(m.revenue_mtd),
      cost: Number(m.cost_mtd),
      margin: Number(m.margin_mtd),
    }));

  // Tenant margin chart data
  const tenantChartData = (margins.data || []).slice(0, 10).map(t => ({
    name: t.tenant_name?.slice(0, 12) || '...',
    margin: Number(t.current_month_margin_pct),
    alert: t.margin_alert_active,
  }));

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-foreground">Panel SuperAdmin</h1>
        <p className="text-muted-foreground text-sm mt-1">Métricas financieras, fraude, churn y proyecciones en tiempo real.</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KPICard icon={DollarSign} label="Ingreso MTD" value={fmt(totals.totalRevenue)} trend={totals.totalRevenue > 0} color="text-primary" />
        <KPICard icon={TrendingUp} label="Margen MTD" value={fmt(totals.totalMargin)} subtitle={fmtPct(totals.avgMarginPct)} trend={totals.avgMarginPct > 20} color="text-success" />
        <KPICard icon={ShieldAlert} label="Alertas fraude" value={String(fraudAlerts.data?.length ?? 0)} trend={false} color="text-destructive" />
        <KPICard icon={Users} label="Tenants en riesgo" value={String(churnScores.data?.filter(c => c.risk_category === 'high').length ?? 0)} trend={false} color="text-warning" />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        {/* Revenue/Cost Trend */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <h3 className="font-semibold text-foreground flex items-center gap-2 mb-4">
            <Activity size={16} className="text-primary" /> Tendencia Ingresos vs Costos (30d)
          </h3>
          {projectionData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={projectionData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
                <Area type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.15)" name="Ingresos" />
                <Area type="monotone" dataKey="cost" stroke="hsl(var(--destructive))" fill="hsl(var(--destructive) / 0.1)" name="Costos" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-10">Sin datos de métricas aún.</p>
          )}
        </div>

        {/* Margin by Tenant */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <h3 className="font-semibold text-foreground flex items-center gap-2 mb-4">
            <BarChart3 size={16} className="text-primary" /> Margen % por Tenant (Top 10)
          </h3>
          {tenantChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={tenantChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="margin" name="Margen %" radius={[4, 4, 0, 0]}>
                  {tenantChartData.map((entry, i) => (
                    <Cell key={i} fill={entry.alert ? 'hsl(var(--destructive))' : entry.margin < 15 ? 'hsl(var(--warning))' : 'hsl(var(--primary))'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-10">Sin datos de margen por tenant.</p>
          )}
        </div>
      </div>

      {/* Tables Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        {/* Fraud Alerts */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <h3 className="font-semibold text-foreground flex items-center gap-2 mb-4">
            <ShieldAlert size={16} className="text-destructive" /> Alertas de Fraude Activas
          </h3>
          {(fraudAlerts.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">✅ Sin alertas activas</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {fraudAlerts.data?.map(alert => (
                <div key={alert.id} className="flex items-start gap-3 p-3 rounded-lg border border-border hover:bg-secondary/30 transition-colors">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${severityColor[alert.severity] || severityColor.info}`}>
                    {alert.severity}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{alert.detection_type.replace(/_/g, ' ')}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Tenant: {alert.tenant_id.slice(0, 8)}… · {format(new Date(alert.created_at), 'd MMM HH:mm', { locale: es })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Churn Scores */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <h3 className="font-semibold text-foreground flex items-center gap-2 mb-4">
            <AlertTriangle size={16} className="text-warning" /> Riesgo de Churn
          </h3>
          {(churnScores.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Sin evaluaciones de churn.</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {churnScores.data?.map(score => (
                <div key={score.id} className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-secondary/30 transition-colors">
                  <div className={`text-lg font-bold ${riskColor[score.risk_category] || 'text-muted-foreground'}`}>
                    {(score.churn_probability * 100).toFixed(0)}%
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">Tenant {score.tenant_id.slice(0, 8)}…</p>
                    <p className="text-xs text-muted-foreground capitalize">{score.risk_category} · {format(new Date(score.calculated_at), 'd MMM', { locale: es })}</p>
                  </div>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                    score.risk_category === 'high' ? 'bg-destructive/10 text-destructive' :
                    score.risk_category === 'medium' ? 'bg-warning/10 text-warning' :
                    'bg-success/10 text-success'
                  }`}>
                    {score.risk_category}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Retention Offers & Pricing Evaluations */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        {/* Pending Retention Offers */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <h3 className="font-semibold text-foreground flex items-center gap-2 mb-4">
            <Gift size={16} className="text-primary" /> Ofertas de Retención Pendientes
          </h3>
          {(retentionOffers.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Sin ofertas pendientes.</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {retentionOffers.data?.map(offer => (
                <div key={offer.id} className="p-3 rounded-lg border border-border hover:bg-secondary/30 transition-colors">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-foreground capitalize">{offer.offer_type.replace(/_/g, ' ')}</span>
                    {offer.discount_pct && (
                      <span className="text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">-{offer.discount_pct}%</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{offer.description || `Tenant: ${offer.tenant_id.slice(0, 8)}…`}</p>
                  {offer.duration_days && <p className="text-xs text-muted-foreground mt-0.5">Duración: {offer.duration_days} días</p>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pricing Evaluations */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <h3 className="font-semibold text-foreground flex items-center gap-2 mb-4">
            <TrendingUp size={16} className="text-primary" /> Evaluaciones de Pricing
          </h3>
          {(pricingEvals.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Sin evaluaciones recientes.</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {pricingEvals.data?.map(ev => (
                <div key={ev.id} className="p-3 rounded-lg border border-border hover:bg-secondary/30 transition-colors">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-foreground capitalize">{ev.recommended_action.replace(/_/g, ' ')}</span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${ev.action_applied ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}>
                      {ev.action_applied ? 'Aplicado' : 'Pendiente'}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Tier: {ev.usage_tier} · Margen 3m: {fmtPct(Number(ev.avg_margin_pct_3m))} · Crecimiento: {fmtPct(Number(ev.growth_rate_pct))}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Tenant Margin Table */}
      <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
        <h3 className="font-semibold text-foreground flex items-center gap-2 mb-4">
          <DollarSign size={16} className="text-primary" /> Margen por Tenant — Tiempo Real
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="py-2 px-3 font-medium text-muted-foreground">Tenant</th>
                <th className="py-2 px-3 font-medium text-muted-foreground text-right">Llamadas</th>
                <th className="py-2 px-3 font-medium text-muted-foreground text-right">Minutos</th>
                <th className="py-2 px-3 font-medium text-muted-foreground text-right">Ingresos</th>
                <th className="py-2 px-3 font-medium text-muted-foreground text-right">Costos</th>
                <th className="py-2 px-3 font-medium text-muted-foreground text-right">Margen</th>
                <th className="py-2 px-3 font-medium text-muted-foreground text-right">%</th>
                <th className="py-2 px-3 font-medium text-muted-foreground text-center">Estado</th>
              </tr>
            </thead>
            <tbody>
              {(margins.data || []).map(t => (
                <tr key={t.tenant_id} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                  <td className="py-2 px-3 font-medium text-foreground">{t.tenant_name}</td>
                  <td className="py-2 px-3 text-right text-muted-foreground">{t.current_month_calls}</td>
                  <td className="py-2 px-3 text-right text-muted-foreground">{Number(t.current_month_minutes).toFixed(0)}</td>
                  <td className="py-2 px-3 text-right text-foreground">{fmt(Number(t.current_month_revenue))}</td>
                  <td className="py-2 px-3 text-right text-muted-foreground">{fmt(Number(t.current_month_cost))}</td>
                  <td className="py-2 px-3 text-right font-semibold text-foreground">{fmt(Number(t.current_month_margin))}</td>
                  <td className={`py-2 px-3 text-right font-semibold ${Number(t.current_month_margin_pct) >= 20 ? 'text-success' : Number(t.current_month_margin_pct) >= 10 ? 'text-warning' : 'text-destructive'}`}>
                    {fmtPct(Number(t.current_month_margin_pct))}
                  </td>
                  <td className="py-2 px-3 text-center">
                    {t.margin_alert_active ? (
                      <span className="text-xs font-bold bg-destructive/10 text-destructive px-2 py-0.5 rounded-full">⚠ Alerta</span>
                    ) : (
                      <span className="text-xs font-bold bg-success/10 text-success px-2 py-0.5 rounded-full">OK</span>
                    )}
                  </td>
                </tr>
              ))}
              {(margins.data?.length ?? 0) === 0 && (
                <tr><td colSpan={8} className="py-6 text-center text-muted-foreground">Sin datos de tenants.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const KPICard = ({ icon: Icon, label, value, subtitle, trend, color }: {
  icon: any; label: string; value: string; subtitle?: string; trend: boolean; color: string;
}) => (
  <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
    <div className="flex items-center justify-between mb-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <Icon size={18} className={color} />
    </div>
    <p className="text-2xl font-bold text-foreground">{value}</p>
    {subtitle && (
      <div className="flex items-center gap-1 mt-1">
        {trend ? <ArrowUpRight size={14} className="text-success" /> : <ArrowDownRight size={14} className="text-destructive" />}
        <span className="text-xs text-muted-foreground">{subtitle}</span>
      </div>
    )}
  </div>
);

export default SuperAdminPage;
