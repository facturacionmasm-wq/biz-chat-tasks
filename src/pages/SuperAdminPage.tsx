import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Navigate } from 'react-router-dom';
import { useSuperAdminData, FinancialProjection } from '@/hooks/useSuperAdminData';
import { useGlobalMetrics, GlobalMetric, UsageCostReconciled } from '@/hooks/useGlobalMetrics';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  DollarSign, TrendingUp, TrendingDown, AlertTriangle, ShieldAlert,
  Users, Gift, BarChart3, Activity, ArrowUpRight, ArrowDownRight,
  Loader2, Brain, RefreshCw, Calendar, Target, Zap, Globe, MapPin,
  Repeat, PieChart,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, PieChart as RPieChart, Pie,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
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

const REGION_COLORS: Record<string, string> = {
  LATAM: 'hsl(var(--primary))',
  NA: 'hsl(var(--success))',
  EU: 'hsl(142 70% 45%)',
  APAC: 'hsl(280 70% 50%)',
};

const SuperAdminPage = () => {
  const { userRole, loading } = useAuth();

  if (loading) return <div className="flex items-center justify-center h-full"><Loader2 className="animate-spin text-primary" size={32} /></div>;
  if (userRole !== 'super_admin') return <Navigate to="/" replace />;

  return <SuperAdminDashboard />;
};

const SuperAdminDashboard = () => {
  const { margins, fraudAlerts, churnScores, retentionOffers, pricingEvals, marginMetrics, projections, generateProjections, totals } = useSuperAdminData();
  const globalData = useGlobalMetrics();

  const isLoading = margins.isLoading || fraudAlerts.isLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="animate-spin text-primary" size={32} />
      </div>
    );
  }

  const projectionData = (marginMetrics.data || [])
    .slice(0, 30)
    .reverse()
    .map(m => ({
      date: format(new Date(m.metric_date), 'd MMM', { locale: es }),
      revenue: Number(m.revenue_mtd),
      cost: Number(m.cost_mtd),
      margin: Number(m.margin_mtd),
    }));

  const tenantChartData = (margins.data || []).slice(0, 10).map(t => ({
    name: t.tenant_name?.slice(0, 12) || '...',
    margin: Number(t.current_month_margin_pct),
    alert: t.margin_alert_active,
  }));

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground flex items-center gap-2">
            <Globe size={24} className="text-primary" /> Panel SuperAdmin Global
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Métricas financieras, KPIs unicornio, fraude, churn y proyecciones.</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => globalData.generateMetrics.mutate()}
          disabled={globalData.generateMetrics.isPending}
          className="gap-2"
        >
          {globalData.generateMetrics.isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Calcular métricas
        </Button>
      </div>

      <Tabs defaultValue="global" className="space-y-4">
        <TabsList className="bg-muted/50">
          <TabsTrigger value="global" className="gap-1.5"><Globe size={14} /> Métricas Globales</TabsTrigger>
          <TabsTrigger value="operations" className="gap-1.5"><Activity size={14} /> Operaciones</TabsTrigger>
          <TabsTrigger value="risk" className="gap-1.5"><ShieldAlert size={14} /> Riesgo</TabsTrigger>
          <TabsTrigger value="projections" className="gap-1.5"><Brain size={14} /> Proyecciones IA</TabsTrigger>
        </TabsList>

        {/* === GLOBAL METRICS TAB === */}
        <TabsContent value="global" className="space-y-6">
          <GlobalMetricsTab globalData={globalData} />
        </TabsContent>

        {/* === OPERATIONS TAB === */}
        <TabsContent value="operations" className="space-y-6">
          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <KPICard icon={DollarSign} label="Ingreso MTD" value={fmt(totals.totalRevenue)} trend={totals.totalRevenue > 0} color="text-primary" />
            <KPICard icon={TrendingUp} label="Margen MTD" value={fmt(totals.totalMargin)} subtitle={fmtPct(totals.avgMarginPct)} trend={totals.avgMarginPct > 20} color="text-success" />
            <KPICard icon={ShieldAlert} label="Alertas fraude" value={String(fraudAlerts.data?.length ?? 0)} trend={false} color="text-destructive" />
            <KPICard icon={Users} label="Tenants en riesgo" value={String(churnScores.data?.filter(c => c.risk_category === 'high').length ?? 0)} trend={false} color="text-warning" />
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
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

          {/* Tenant Table */}
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

          {/* Retention & Pricing */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
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
                    </div>
                  ))}
                </div>
              )}
            </div>

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
        </TabsContent>

        {/* === RISK TAB === */}
        <TabsContent value="risk" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
            <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
              <h3 className="font-semibold text-foreground flex items-center gap-2 mb-4">
                <ShieldAlert size={16} className="text-destructive" /> Alertas de Fraude Activas
              </h3>
              {(fraudAlerts.data?.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">✅ Sin alertas activas</p>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto">
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

            <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
              <h3 className="font-semibold text-foreground flex items-center gap-2 mb-4">
                <AlertTriangle size={16} className="text-warning" /> Riesgo de Churn
              </h3>
              {(churnScores.data?.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">Sin evaluaciones de churn.</p>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto">
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

          {/* LTV Estimates */}
          {(globalData.ltvEstimates.data?.length ?? 0) > 0 && (
            <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
              <h3 className="font-semibold text-foreground flex items-center gap-2 mb-4">
                <TrendingUp size={16} className="text-primary" /> Top LTV por Tenant (USD)
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="py-2 px-3 font-medium text-muted-foreground">Tenant</th>
                      <th className="py-2 px-3 font-medium text-muted-foreground text-right">LTV (USD)</th>
                      <th className="py-2 px-3 font-medium text-muted-foreground text-right">Rev Mensual</th>
                      <th className="py-2 px-3 font-medium text-muted-foreground text-right">Vida (meses)</th>
                      <th className="py-2 px-3 font-medium text-muted-foreground text-right">Churn Prob</th>
                      <th className="py-2 px-3 font-medium text-muted-foreground text-right">Riesgo País</th>
                    </tr>
                  </thead>
                  <tbody>
                    {globalData.ltvEstimates.data?.slice(0, 10).map(ltv => (
                      <tr key={ltv.id} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                        <td className="py-2 px-3 font-medium text-foreground">{ltv.tenant_id.slice(0, 8)}…</td>
                        <td className="py-2 px-3 text-right font-semibold text-foreground">{fmt(Number(ltv.estimated_ltv_usd))}</td>
                        <td className="py-2 px-3 text-right text-muted-foreground">{fmt(Number(ltv.avg_monthly_revenue))}</td>
                        <td className="py-2 px-3 text-right text-muted-foreground">{Number(ltv.estimated_lifetime_months).toFixed(0)}</td>
                        <td className="py-2 px-3 text-right text-muted-foreground">{fmtPct(Number(ltv.churn_probability) * 100)}</td>
                        <td className="py-2 px-3 text-right text-muted-foreground">×{Number(ltv.country_risk_factor).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </TabsContent>

        {/* === PROJECTIONS TAB === */}
        <TabsContent value="projections" className="space-y-6">
          <ProjectionsSection
            projections={projections.data || []}
            isLoading={projections.isLoading}
            onGenerate={() => generateProjections.mutate()}
            isGenerating={generateProjections.isPending}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
};

/* ===== GLOBAL METRICS TAB ===== */
const GlobalMetricsTab = ({ globalData }: { globalData: ReturnType<typeof useGlobalMetrics> }) => {
  const latest = globalData.latest;
  const regionData = globalData.regionMetrics.data || [];
  const historyData = (globalData.globalMetrics.data || []).slice(0, 14).reverse();

  const mrrTrend = historyData.map(m => ({
    date: format(new Date(m.metric_date), 'd MMM', { locale: es }),
    mrr: Number(m.mrr),
    arr: Number(m.arr),
  }));

  const regionPieData = regionData.map(r => ({
    name: r.region,
    value: Number(r.mrr),
    fill: REGION_COLORS[r.region] || 'hsl(var(--muted-foreground))',
  })).filter(r => r.value > 0);

  return (
    <div className="space-y-6">
      {/* Unicorn KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <UnicornKPI label="MRR" value={fmt(Number(latest?.mrr ?? 0))} icon={DollarSign} />
        <UnicornKPI label="ARR" value={fmt(Number(latest?.arr ?? 0))} icon={TrendingUp} />
        <UnicornKPI label="ARPU" value={fmt(Number(latest?.arpu ?? 0))} icon={Users} />
        <UnicornKPI label="LTV Avg" value={fmt(Number(latest?.ltv_avg ?? 0))} icon={Target} />
        <UnicornKPI label="Gross Margin" value={fmtPct(Number(latest?.gross_margin_pct ?? 0))} icon={PieChart} />
        <UnicornKPI label="Churn Rate" value={fmtPct(Number(latest?.churn_rate_pct ?? 0))} icon={TrendingDown} negative />
      </div>

      {/* Secondary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
          <p className="text-xs text-muted-foreground">NRR</p>
          <p className="text-xl font-bold text-foreground">{fmtPct(Number(latest?.net_revenue_retention_pct ?? 100))}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
          <p className="text-xs text-muted-foreground">LTV/CAC</p>
          <p className="text-xl font-bold text-foreground">{Number(latest?.ltv_cac_ratio ?? 0).toFixed(1)}x</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
          <p className="text-xs text-muted-foreground">Tenants Activos</p>
          <p className="text-xl font-bold text-foreground">{latest?.active_tenants ?? 0} / {latest?.total_tenants ?? 0}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
          <p className="text-xs text-muted-foreground">Revenue USD (MTD)</p>
          <p className="text-xl font-bold text-foreground">{fmt(Number(latest?.total_revenue_usd ?? 0))}</p>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        {/* MRR Trend */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <h3 className="font-semibold text-foreground flex items-center gap-2 mb-4">
            <TrendingUp size={16} className="text-primary" /> Tendencia MRR (14d)
          </h3>
          {mrrTrend.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={mrrTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
                <Area type="monotone" dataKey="mrr" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.15)" name="MRR (USD)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-10">Sin historial de MRR. Ejecuta "Calcular métricas".</p>
          )}
        </div>

        {/* MRR by Region */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <h3 className="font-semibold text-foreground flex items-center gap-2 mb-4">
            <MapPin size={16} className="text-primary" /> MRR por Región
          </h3>
          {regionData.length > 0 ? (
            <div className="flex items-center gap-6">
              <ResponsiveContainer width="50%" height={200}>
                <RPieChart>
                  <Pie data={regionPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                    {regionPieData.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
                </RPieChart>
              </ResponsiveContainer>
              <div className="space-y-2 flex-1">
                {regionData.map(r => (
                  <div key={r.region} className="flex items-center justify-between text-sm">
                    <span className="font-medium text-foreground">{r.region}</span>
                    <div className="text-right">
                      <span className="font-semibold text-foreground">{fmt(Number(r.mrr))}</span>
                      <span className="text-xs text-muted-foreground ml-2">{r.active_tenants} tenants</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-10">Sin datos por región.</p>
          )}
        </div>
      </div>

      {/* Regional Targets */}
      {(globalData.regionalTargets.data?.length ?? 0) > 0 && (
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <h3 className="font-semibold text-foreground flex items-center gap-2 mb-4">
            <Target size={16} className="text-primary" /> Objetivos por Región
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {globalData.regionalTargets.data?.map(t => (
              <div key={t.id} className="p-3 rounded-lg border border-border">
                <p className="text-sm font-semibold text-foreground">{t.region}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Margen objetivo: <span className="font-bold text-foreground">{fmtPct(Number(t.target_gross_margin_pct))}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  Máx cambio: {fmtPct(Number(t.max_price_change_pct))} · Riesgo: ×{Number(t.country_risk_multiplier).toFixed(2)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* WhatsApp Usage Costs - Global */}
      {(globalData.usageCosts.data?.length ?? 0) > 0 && (
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <h3 className="font-semibold text-foreground flex items-center gap-2 mb-4">
            <Repeat size={16} className="text-primary" /> Costos WhatsApp Reconciliados (Global)
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="py-2 px-3 font-medium text-muted-foreground">Periodo</th>
                  <th className="py-2 px-3 font-medium text-muted-foreground">Región</th>
                  <th className="py-2 px-3 font-medium text-muted-foreground text-right">Unidades</th>
                  <th className="py-2 px-3 font-medium text-muted-foreground text-right">Costo USD</th>
                  <th className="py-2 px-3 font-medium text-muted-foreground text-right">Revenue USD</th>
                  <th className="py-2 px-3 font-medium text-muted-foreground text-right">Margen %</th>
                </tr>
              </thead>
              <tbody>
                {globalData.usageCosts.data?.slice(0, 20).map(c => (
                  <tr key={c.id} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                    <td className="py-2 px-3 text-foreground">{c.period_start}</td>
                    <td className="py-2 px-3 text-muted-foreground">{c.region}</td>
                    <td className="py-2 px-3 text-right text-muted-foreground">{c.total_units}</td>
                    <td className="py-2 px-3 text-right text-foreground">{fmt(Number(c.real_cost_usd))}</td>
                    <td className="py-2 px-3 text-right text-foreground">{fmt(Number(c.revenue_usd))}</td>
                    <td className={`py-2 px-3 text-right font-semibold ${Number(c.margin_pct) >= 20 ? 'text-success' : 'text-warning'}`}>
                      {fmtPct(Number(c.margin_pct))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

const UnicornKPI = ({ label, value, icon: Icon, negative }: { label: string; value: string; icon: any; negative?: boolean }) => (
  <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
    <div className="flex items-center justify-between mb-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Icon size={14} className={negative ? 'text-destructive' : 'text-primary'} />
    </div>
    <p className={`text-lg font-bold ${negative ? 'text-destructive' : 'text-foreground'}`}>{value}</p>
  </div>
);

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
  const latestDate = projections[0]?.projection_date;
  const latest = projections.filter(p => p.projection_date === latestDate);
  const narrative = latest[0]?.ai_narrative;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-foreground flex items-center gap-2">
          <Brain size={18} className="text-primary" /> Proyecciones Financieras IA
        </h3>
        <Button variant="outline" size="sm" onClick={onGenerate} disabled={isGenerating} className="gap-2">
          {isGenerating ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          {isGenerating ? 'Generando...' : 'Generar proyecciones'}
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-10"><Loader2 className="animate-spin text-primary" size={24} /></div>
      ) : latest.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-8 text-center">
          <Brain size={32} className="mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">No hay proyecciones generadas aún.</p>
          <p className="text-xs text-muted-foreground mt-1">Haz clic en "Generar proyecciones" para crear el análisis con IA.</p>
        </div>
      ) : (
        <>
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
                    <span className={`text-xs font-semibold ${conf.color}`}>Confianza: {conf.text}</span>
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
                  {(p.risk_factors as any[])?.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-border">
                      <p className="text-xs font-semibold text-muted-foreground mb-1">Riesgos:</p>
                      {(p.risk_factors as any[]).slice(0, 2).map((r, i) => (
                        <p key={i} className="text-xs text-muted-foreground">
                          <span className={`font-bold ${r.impact === 'high' ? 'text-destructive' : r.impact === 'medium' ? 'text-warning' : 'text-muted-foreground'}`}>
                            {r.impact === 'high' ? '🔴' : r.impact === 'medium' ? '🟡' : '🟢'}
                          </span>{' '}{r.description}
                        </p>
                      ))}
                    </div>
                  )}
                  {(p.opportunities as any[])?.length > 0 && (
                    <div className="mt-2">
                      <p className="text-xs font-semibold text-muted-foreground mb-1">Oportunidades:</p>
                      {(p.opportunities as any[]).slice(0, 2).map((o, i) => (
                        <p key={i} className="text-xs text-muted-foreground">💡 {o.description} ({fmt(o.potential_revenue)})</p>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

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
