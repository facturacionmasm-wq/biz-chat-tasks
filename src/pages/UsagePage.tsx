import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { useTenantBilling } from '@/hooks/useTenantBilling';
import {
  MessageSquare, Phone, Zap, TrendingUp, Package, DollarSign, Loader2,
  BarChart3, Clock, Bot, ArrowUpRight, ShoppingCart, CheckCircle, AlertTriangle
} from 'lucide-react';
import { toast } from 'sonner';

const UsagePage = () => {
  const { user, userRole } = useAuth();
  const [tenantId, setTenantId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    supabase.from('profiles').select('tenant_id').eq('user_id', user.id).maybeSingle()
      .then(({ data }) => setTenantId(data?.tenant_id || null));
  }, [user]);

  const { currentMonth, costHistory, fxRate, isLoading: billingLoading } = useTenantBilling(tenantId);

  // Voice Agent metrics from realtime_margin_state
  const voiceMetrics = useQuery({
    queryKey: ['voice-metrics', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data } = await supabase
        .from('realtime_margin_state')
        .select('*')
        .eq('tenant_id', tenantId!)
        .maybeSingle();
      return data;
    },
  });

  // Voice call costs for current month
  const voiceCosts = useQuery({
    queryKey: ['voice-costs-month', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const now = new Date();
      const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      const { data } = await supabase
        .from('call_costs')
        .select('cost_total, revenue_charged, margin, duration_minutes, ai_tokens_used')
        .eq('tenant_id', tenantId!)
        .gte('created_at', monthStart);
      return data || [];
    },
  });

  // Active packages
  const packages = useQuery({
    queryKey: ['usage-packages', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data } = await supabase
        .from('usage_packages' as any)
        .select('*')
        .eq('tenant_id', tenantId!)
        .in('status', ['active'])
        .order('purchased_at', { ascending: false });
      return (data || []) as any[];
    },
  });

  // Package catalog
  const catalog = useQuery({
    queryKey: ['package-catalog'],
    queryFn: async () => {
      const { data } = await supabase
        .from('package_catalog' as any)
        .select('*')
        .eq('active', true)
        .order('sort_order');
      return (data || []) as any[];
    },
  });

  // Aggregate voice costs
  const voiceSummary = (() => {
    const costs = voiceCosts.data || [];
    let totalCost = 0, totalRevenue = 0, totalMinutes = 0, totalTokens = 0;
    for (const c of costs) {
      totalCost += Number(c.cost_total);
      totalRevenue += Number(c.revenue_charged);
      totalMinutes += Number(c.duration_minutes);
      totalTokens += Number(c.ai_tokens_used);
    }
    return { totalCost, totalRevenue, totalMinutes, totalTokens, callCount: costs.length };
  })();

  // Package balance summary
  const packageSummary = (() => {
    const pkgs = packages.data || [];
    let remainingMessages = 0, remainingMinutes = 0;
    for (const p of pkgs) {
      remainingMessages += (p.included_messages - p.used_messages);
      remainingMinutes += (Number(p.included_minutes) - Number(p.used_minutes));
    }
    return { remainingMessages, remainingMinutes, activeCount: pkgs.length };
  })();

  const history = costHistory.data || [];
  const isLoading = billingLoading || voiceMetrics.isLoading || voiceCosts.isLoading;

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <BarChart3 size={22} className="text-primary" /> Consumo y Paquetes
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Métricas unificadas de WhatsApp, Voice Agent y paquetes prepago
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-muted-foreground" /></div>
      ) : (
        <>
          {/* ── KPI Cards ── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {/* WhatsApp */}
            <KpiCard
              icon={MessageSquare}
              iconColor="text-green-600"
              label="Mensajes WhatsApp"
              value={currentMonth.totalUnits}
              sub={`${currentMonth.byType['message_out'] || 0} enviados · ${currentMonth.byType['message_in'] || 0} recibidos`}
            />
            {/* Voice */}
            <KpiCard
              icon={Phone}
              iconColor="text-blue-600"
              label="Llamadas Voice AI"
              value={voiceSummary.callCount}
              sub={`${voiceSummary.totalMinutes.toFixed(1)} min`}
            />
            {/* AI Tokens */}
            <KpiCard
              icon={Bot}
              iconColor="text-purple-600"
              label="Tokens IA"
              value={voiceSummary.totalTokens.toLocaleString()}
              sub="Consumo del mes"
            />
            {/* FX Rate */}
            <KpiCard
              icon={DollarSign}
              iconColor="text-amber-600"
              label="Tipo de cambio"
              value={`$${fxRate.data?.rate?.toFixed(2) || '—'}`}
              sub="USD/MXN"
            />
          </div>

          {/* ── Package Balance ── */}
          <div className="bg-card border border-border rounded-xl p-5">
            <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
              <Package size={16} className="text-primary" /> Saldo de Paquetes Activos
            </h2>
            {packageSummary.activeCount === 0 ? (
              <div className="text-center py-6">
                <Package size={32} className="mx-auto text-muted-foreground/40 mb-2" />
                <p className="text-sm text-muted-foreground">No tienes paquetes activos</p>
                <p className="text-xs text-muted-foreground mt-1">Adquiere un paquete para obtener créditos de mensajes o minutos</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 rounded-lg border border-border bg-secondary/20">
                  <p className="text-xs text-muted-foreground">Mensajes restantes</p>
                  <p className="text-2xl font-bold text-foreground">{packageSummary.remainingMessages}</p>
                </div>
                <div className="p-4 rounded-lg border border-border bg-secondary/20">
                  <p className="text-xs text-muted-foreground">Minutos restantes</p>
                  <p className="text-2xl font-bold text-foreground">{packageSummary.remainingMinutes.toFixed(1)}</p>
                </div>
                <div className="p-4 rounded-lg border border-border bg-secondary/20">
                  <p className="text-xs text-muted-foreground">Paquetes activos</p>
                  <p className="text-2xl font-bold text-foreground">{packageSummary.activeCount}</p>
                </div>
              </div>
            )}

            {/* Active packages list */}
            {(packages.data || []).length > 0 && (
              <div className="mt-4 space-y-2">
                {(packages.data || []).map((pkg: any) => (
                  <div key={pkg.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-background">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                        pkg.package_type === 'voice' ? 'bg-blue-500/10' : pkg.package_type === 'mixed' ? 'bg-purple-500/10' : 'bg-green-500/10'
                      }`}>
                        {pkg.package_type === 'voice' ? <Phone size={16} className="text-blue-600" /> :
                         pkg.package_type === 'mixed' ? <Zap size={16} className="text-purple-600" /> :
                         <MessageSquare size={16} className="text-green-600" />}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">{pkg.package_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {pkg.included_messages > 0 && `${pkg.included_messages - pkg.used_messages}/${pkg.included_messages} msgs`}
                          {pkg.included_messages > 0 && Number(pkg.included_minutes) > 0 && ' · '}
                          {Number(pkg.included_minutes) > 0 && `${(Number(pkg.included_minutes) - Number(pkg.used_minutes)).toFixed(1)}/${Number(pkg.included_minutes)} min`}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      {pkg.expires_at && (
                        <p className="text-xs text-muted-foreground">
                          Expira: {new Date(pkg.expires_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}
                        </p>
                      )}
                      <span className="text-xs bg-green-500/10 text-green-600 px-2 py-0.5 rounded-full">Activo</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Package Catalog ── */}
          {(catalog.data || []).length > 0 && (
            <div className="bg-card border border-border rounded-xl p-5">
              <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                <ShoppingCart size={16} className="text-primary" /> Paquetes Disponibles
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {(catalog.data || []).map((item: any) => (
                  <div key={item.id} className="border border-border rounded-xl p-4 hover:border-primary/50 transition-colors">
                    <div className="flex items-center gap-2 mb-2">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                        item.package_type === 'voice' ? 'bg-blue-500/10' : item.package_type === 'mixed' ? 'bg-purple-500/10' : 'bg-green-500/10'
                      }`}>
                        {item.package_type === 'voice' ? <Phone size={16} className="text-blue-600" /> :
                         item.package_type === 'mixed' ? <Zap size={16} className="text-purple-600" /> :
                         <MessageSquare size={16} className="text-green-600" />}
                      </div>
                      <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">{item.package_type}</span>
                    </div>
                    <h3 className="text-base font-bold text-foreground">{item.name}</h3>
                    <p className="text-2xl font-bold text-foreground mt-1">
                      ${Number(item.price_mxn).toLocaleString()} <span className="text-xs text-muted-foreground font-normal">MXN</span>
                    </p>
                    <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                      {item.included_messages > 0 && <p>✓ {item.included_messages} mensajes</p>}
                      {Number(item.included_minutes) > 0 && <p>✓ {Number(item.included_minutes)} minutos</p>}
                      <p>✓ Válido por {item.validity_days} días</p>
                    </div>
                    <button
                      onClick={() => toast.info('Contacta al administrador para adquirir este paquete')}
                      className="w-full mt-3 bg-primary text-primary-foreground text-sm px-4 py-2 rounded-lg hover:opacity-90 transition-opacity font-medium"
                    >
                      Adquirir
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Voice Agent Detail ── */}
          <div className="bg-card border border-border rounded-xl p-5">
            <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
              <Phone size={16} className="text-primary" /> Detalle Voice Agent — Mes actual
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <MetricBox label="Llamadas" value={voiceSummary.callCount} />
              <MetricBox label="Minutos" value={voiceSummary.totalMinutes.toFixed(1)} />
              <MetricBox label="Tokens IA" value={voiceSummary.totalTokens.toLocaleString()} />
              <MetricBox label="Costo USD" value={`$${voiceSummary.totalCost.toFixed(2)}`} />
              <MetricBox label="Cobro USD" value={`$${voiceSummary.totalRevenue.toFixed(2)}`} />
            </div>
          </div>

          {/* ── WhatsApp Detail ── */}
          <div className="bg-card border border-border rounded-xl p-5">
            <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
              <MessageSquare size={16} className="text-primary" /> Detalle WhatsApp — Mes actual
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <MetricBox label="Total mensajes" value={currentMonth.totalUnits} />
              <MetricBox label="Enviados" value={currentMonth.byType['message_out'] || 0} />
              <MetricBox label="Recibidos" value={currentMonth.byType['message_in'] || 0} />
              <MetricBox label="Eventos" value={currentMonth.eventCount} />
            </div>
          </div>

          {/* ── Cost History ── */}
          {history.length > 0 && (
            <div className="bg-card border border-border rounded-xl p-5">
              <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                <TrendingUp size={16} className="text-primary" /> Historial de Costos (WhatsApp)
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="py-2 px-3 font-medium text-muted-foreground">Periodo</th>
                      <th className="py-2 px-3 font-medium text-muted-foreground text-right">Unidades</th>
                      <th className="py-2 px-3 font-medium text-muted-foreground text-right">Costo</th>
                      <th className="py-2 px-3 font-medium text-muted-foreground text-right">USD</th>
                      <th className="py-2 px-3 font-medium text-muted-foreground text-right">Margen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map(h => (
                      <tr key={h.id} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                        <td className="py-2 px-3 text-foreground">{h.period_start}</td>
                        <td className="py-2 px-3 text-right text-muted-foreground">{h.total_units}</td>
                        <td className="py-2 px-3 text-right text-foreground">${Number(h.real_cost_local_currency).toFixed(2)}</td>
                        <td className="py-2 px-3 text-right text-muted-foreground">${Number(h.real_cost_usd).toFixed(2)}</td>
                        <td className="py-2 px-3 text-right font-semibold text-foreground">{Number(h.margin_pct).toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

// ── Small components ──
const KpiCard = ({ icon: Icon, iconColor, label, value, sub }: { icon: any; iconColor: string; label: string; value: string | number; sub: string }) => (
  <div className="bg-card border border-border rounded-xl p-4">
    <div className="flex items-center gap-2 mb-2">
      <Icon size={16} className={iconColor} />
      <span className="text-xs text-muted-foreground font-medium">{label}</span>
    </div>
    <p className="text-2xl font-bold text-foreground">{value}</p>
    <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
  </div>
);

const MetricBox = ({ label, value }: { label: string; value: string | number }) => (
  <div className="p-3 rounded-lg border border-border">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="text-xl font-bold text-foreground">{value}</p>
  </div>
);

export default UsagePage;
