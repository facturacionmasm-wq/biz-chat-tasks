import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Navigate } from 'react-router-dom';
import { useSuperAdminData, FinancialProjection } from '@/hooks/useSuperAdminData';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  DollarSign, TrendingUp, TrendingDown, AlertTriangle, ShieldAlert,
  Users, Gift, BarChart3, Activity, ArrowUpRight, ArrowDownRight,
  Loader2, Brain, RefreshCw, Calendar, Target, Zap,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell,
} from 'recharts';
import { Button } from '@/components/ui/button';

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
  const { margins, fraudAlerts, churnScores, retentionOffers, pricingEvals, marginMetrics, projections, generateProjections, totals } = useSuperAdminData();

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

      {/* AI Financial Projections */}
      <ProjectionsSection
        projections={projections.data || []}
        isLoading={projections.isLoading}
        onGenerate={() => generateProjections.mutate()}
        isGenerating={generateProjections.isPending}
      />

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

const confidenceLabel = (score: number) => {
  if (score >= 0.8) return { text: 'Alta', color: 'text-success' };
  if (score >= 0.5) return { text: 'Media', color: 'text-warning' };
  return { text: 'Baja', color: 'text-destructive' };
};

const horizonLabel: Record<number, string> = { 30: '30 días', 60: '60 días', 90: '90 días' };
const horizonIcon: Record<number, any> = { 30: Calendar, 60: Target, 90: Zap };

const ProjectionsSection = ({
  projections, isLoading, onGenerate, isGenerating,
}: {
  projections: FinancialProjection[];
  isLoading: boolean;
  onGenerate: () => void;
  isGenerating: boolean;
}) => {
  // Get latest set (same projection_date)
  const latestDate = projections[0]?.projection_date;
  const latest = projections.filter(p => p.projection_date === latestDate);
  const narrative = latest[0]?.ai_narrative;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-foreground flex items-center gap-2">
          <Brain size={18} className="text-primary" /> Proyecciones Financieras IA
        </h3>
        <Button
          variant="outline"
          size="sm"
          onClick={onGenerate}
          disabled={isGenerating}
          className="gap-2"
        >
          {isGenerating ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          {isGenerating ? 'Generando...' : 'Generar proyecciones'}
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="animate-spin text-primary" size={24} />
        </div>
      ) : latest.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-8 text-center">
          <Brain size={32} className="mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">No hay proyecciones generadas aún.</p>
          <p className="text-xs text-muted-foreground mt-1">Haz clic en "Generar proyecciones" para crear el análisis con IA.</p>
        </div>
      ) : (
        <>
          {/* Projection Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {latest.map(p => {
              const HIcon = horizonIcon[p.horizon_days] || Calendar;
              const conf = confidenceLabel(Number(p.confidence_score));
              return (
                <div key={p.id} className="bg-card border border-border rounded-xl p-5 shadow-sm">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <HIcon size={16} className="text-primary" />
                      <span className="font-semibold text-foreground">{horizonLabel[p.horizon_days]}</span>
                    </div>
                    <span className={`text-xs font-semibold ${conf.color}`}>
                      Confianza: {conf.text}
                    </span>
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Ingresos</span>
                      <span className="text-sm font-semibold text-foreground">{fmt(Number(p.projected_revenue))}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Costos</span>
                      <span className="text-sm text-muted-foreground">{fmt(Number(p.projected_cost))}</span>
                    </div>
                    <div className="flex justify-between border-t border-border pt-2">
                      <span className="text-sm font-medium text-foreground">Margen</span>
                      <span className={`text-sm font-bold ${Number(p.projected_margin_pct) >= 20 ? 'text-success' : Number(p.projected_margin_pct) >= 10 ? 'text-warning' : 'text-destructive'}`}>
                        {fmt(Number(p.projected_margin))} ({fmtPct(Number(p.projected_margin_pct))})
                      </span>
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground pt-1">
                      <span>📞 {p.projected_calls} llamadas</span>
                      <span>⏱ {Number(p.projected_minutes).toFixed(0)} min</span>
                    </div>
                  </div>

                  {/* Risk factors */}
                  {(p.risk_factors as any[])?.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-border">
                      <p className="text-xs font-semibold text-muted-foreground mb-1">Riesgos:</p>
                      {(p.risk_factors as any[]).slice(0, 2).map((r, i) => (
                        <p key={i} className="text-xs text-muted-foreground">
                          <span className={`font-bold ${r.impact === 'high' ? 'text-destructive' : r.impact === 'medium' ? 'text-warning' : 'text-muted-foreground'}`}>
                            {r.impact === 'high' ? '🔴' : r.impact === 'medium' ? '🟡' : '🟢'}
                          </span>{' '}
                          {r.description}
                        </p>
                      ))}
                    </div>
                  )}

                  {/* Opportunities */}
                  {(p.opportunities as any[])?.length > 0 && (
                    <div className="mt-2">
                      <p className="text-xs font-semibold text-muted-foreground mb-1">Oportunidades:</p>
                      {(p.opportunities as any[]).slice(0, 2).map((o, i) => (
                        <p key={i} className="text-xs text-muted-foreground">
                          💡 {o.description} ({fmt(o.potential_revenue)})
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* AI Narrative */}
          {narrative && (
            <div className="bg-primary/5 border border-primary/15 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-2">
                <Brain size={16} className="text-primary" />
                <span className="text-sm font-semibold text-foreground">Análisis Ejecutivo IA</span>
                <span className="text-xs text-muted-foreground ml-auto">
                  {latestDate && format(new Date(latestDate), "d MMM yyyy", { locale: es })}
                </span>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">{narrative}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default SuperAdminPage;
