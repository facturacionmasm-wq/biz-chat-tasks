import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  MessageSquare, Phone, Package, Loader2, Plus, Search,
  ToggleLeft, ToggleRight, Trash2, DollarSign, Bot
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const SuperAdminConsumptionTab = () => {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [assignDialog, setAssignDialog] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState('');
  const [selectedCatalog, setSelectedCatalog] = useState('');

  // All tenants with their usage data
  const tenantUsage = useQuery({
    queryKey: ['sa-tenant-usage'],
    queryFn: async () => {
      // Get all tenants
      const { data: tenants } = await supabase
        .from('tenants')
        .select('id, name')
        .order('name');

      if (!tenants) return [];

      const now = new Date();
      const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

      // Get WhatsApp usage for all tenants
      const { data: waEvents } = await supabase
        .from('whatsapp_usage_events')
        .select('tenant_id, units, event_type')
        .gte('occurred_at', monthStart);

      // Get voice costs for all tenants
      const { data: voiceCosts } = await supabase
        .from('call_costs')
        .select('tenant_id, cost_total, revenue_charged, duration_minutes, ai_tokens_used')
        .gte('created_at', monthStart);

      // Get active packages per tenant
      const { data: packages } = await supabase
        .from('usage_packages' as any)
        .select('tenant_id, included_messages, used_messages, included_minutes, used_minutes, status')
        .in('status', ['active']);

      // Aggregate per tenant
      return tenants.map(t => {
        const waEvts = (waEvents || []).filter(e => e.tenant_id === t.id);
        const waMsgs = waEvts.reduce((s, e) => s + Number(e.units), 0);
        const waOut = waEvts.filter(e => e.event_type === 'message_out').reduce((s, e) => s + Number(e.units), 0);
        const waIn = waEvts.filter(e => e.event_type === 'message_in').reduce((s, e) => s + Number(e.units), 0);

        const vc = (voiceCosts || []).filter(e => e.tenant_id === t.id);
        const voiceTotalCost = vc.reduce((s, e) => s + Number(e.cost_total), 0);
        const voiceTotalRevenue = vc.reduce((s, e) => s + Number(e.revenue_charged), 0);
        const voiceMinutes = vc.reduce((s, e) => s + Number(e.duration_minutes), 0);
        const voiceTokens = vc.reduce((s, e) => s + Number(e.ai_tokens_used), 0);

        const pkgs = ((packages || []) as any[]).filter(p => p.tenant_id === t.id);
        const activePackages = pkgs.length;
        const remainingMsgs = pkgs.reduce((s, p) => s + (p.included_messages - p.used_messages), 0);
        const remainingMins = pkgs.reduce((s, p) => s + (Number(p.included_minutes) - Number(p.used_minutes)), 0);

        return {
          id: t.id,
          name: t.name,
          waMsgs, waOut, waIn,
          voiceCalls: vc.length, voiceMinutes, voiceTotalCost, voiceTotalRevenue, voiceTokens,
          activePackages, remainingMsgs, remainingMins,
        };
      });
    },
  });

  // All packages (admin view)
  const allPackages = useQuery({
    queryKey: ['sa-all-packages'],
    queryFn: async () => {
      const { data } = await supabase
        .from('usage_packages' as any)
        .select('*')
        .order('purchased_at', { ascending: false })
        .limit(100);
      return (data || []) as any[];
    },
  });

  // Package catalog
  const catalog = useQuery({
    queryKey: ['sa-package-catalog'],
    queryFn: async () => {
      const { data } = await supabase
        .from('package_catalog' as any)
        .select('*')
        .order('sort_order');
      return (data || []) as any[];
    },
  });

  // Tenants list for assignment
  const tenantsList = useQuery({
    queryKey: ['sa-tenants-list'],
    queryFn: async () => {
      const { data } = await supabase.from('tenants').select('id, name').order('name');
      return data || [];
    },
  });

  // Assign package to tenant
  const assignPackage = useMutation({
    mutationFn: async ({ tenantId, catalogId }: { tenantId: string; catalogId: string }) => {
      const catalogItem = (catalog.data || []).find((c: any) => c.id === catalogId);
      if (!catalogItem) throw new Error('Paquete no encontrado');

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + catalogItem.validity_days);

      const { error } = await supabase.from('usage_packages' as any).insert({
        tenant_id: tenantId,
        package_name: catalogItem.name,
        package_type: catalogItem.package_type,
        included_messages: catalogItem.included_messages,
        included_minutes: catalogItem.included_minutes,
        used_messages: 0,
        used_minutes: 0,
        status: 'active',
        expires_at: expiresAt.toISOString(),
      } as any);

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Paquete asignado exitosamente');
      queryClient.invalidateQueries({ queryKey: ['sa-all-packages'] });
      queryClient.invalidateQueries({ queryKey: ['sa-tenant-usage'] });
      setAssignDialog(false);
      setSelectedTenant('');
      setSelectedCatalog('');
    },
    onError: (e: any) => toast.error(`Error: ${e.message}`),
  });

  // Toggle package status
  const togglePackage = useMutation({
    mutationFn: async ({ id, newStatus }: { id: string; newStatus: string }) => {
      const { error } = await supabase
        .from('usage_packages' as any)
        .update({ status: newStatus } as any)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Estado del paquete actualizado');
      queryClient.invalidateQueries({ queryKey: ['sa-all-packages'] });
      queryClient.invalidateQueries({ queryKey: ['sa-tenant-usage'] });
    },
    onError: (e: any) => toast.error(`Error: ${e.message}`),
  });

  const filtered = (tenantUsage.data || []).filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase())
  );

  if (tenantUsage.isLoading) {
    return <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Aggregated KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-1"><MessageSquare size={14} className="text-green-600" /><span className="text-xs text-muted-foreground">WhatsApp Total</span></div>
          <p className="text-2xl font-bold text-foreground">{filtered.reduce((s, t) => s + t.waMsgs, 0)}</p>
          <p className="text-xs text-muted-foreground">{filtered.reduce((s, t) => s + t.waOut, 0)} env · {filtered.reduce((s, t) => s + t.waIn, 0)} rec</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-1"><Phone size={14} className="text-blue-600" /><span className="text-xs text-muted-foreground">Voice Total</span></div>
          <p className="text-2xl font-bold text-foreground">{filtered.reduce((s, t) => s + t.voiceCalls, 0)}</p>
          <p className="text-xs text-muted-foreground">{filtered.reduce((s, t) => s + t.voiceMinutes, 0).toFixed(1)} min</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-1"><DollarSign size={14} className="text-amber-600" /><span className="text-xs text-muted-foreground">Costo Voice Total</span></div>
          <p className="text-2xl font-bold text-foreground">{fmt(filtered.reduce((s, t) => s + t.voiceTotalCost, 0))}</p>
          <p className="text-xs text-muted-foreground">Revenue: {fmt(filtered.reduce((s, t) => s + t.voiceTotalRevenue, 0))}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-1"><Package size={14} className="text-purple-600" /><span className="text-xs text-muted-foreground">Paquetes Activos</span></div>
          <p className="text-2xl font-bold text-foreground">{filtered.reduce((s, t) => s + t.activePackages, 0)}</p>
          <p className="text-xs text-muted-foreground">{filtered.filter(t => t.activePackages > 0).length} tenants con paquete</p>
        </div>
      </div>

      {/* Tenant consumption table */}
      <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-foreground flex items-center gap-2">
            <Bot size={16} className="text-primary" /> Consumo por Tenant — Mes actual
          </h3>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-2.5 text-muted-foreground" />
              <Input
                placeholder="Buscar tenant..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-8 h-9 w-48 text-sm"
              />
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="py-2 px-3 font-medium text-muted-foreground">Tenant</th>
                <th className="py-2 px-3 font-medium text-muted-foreground text-right">WA Msgs</th>
                <th className="py-2 px-3 font-medium text-muted-foreground text-right">Llamadas</th>
                <th className="py-2 px-3 font-medium text-muted-foreground text-right">Minutos</th>
                <th className="py-2 px-3 font-medium text-muted-foreground text-right">Costo Voice</th>
                <th className="py-2 px-3 font-medium text-muted-foreground text-right">Tokens IA</th>
                <th className="py-2 px-3 font-medium text-muted-foreground text-right">Paquetes</th>
                <th className="py-2 px-3 font-medium text-muted-foreground text-right">Saldo Msgs</th>
                <th className="py-2 px-3 font-medium text-muted-foreground text-right">Saldo Min</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(t => (
                <tr key={t.id} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                  <td className="py-2 px-3 font-medium text-foreground">{t.name}</td>
                  <td className="py-2 px-3 text-right text-muted-foreground">{t.waMsgs}</td>
                  <td className="py-2 px-3 text-right text-muted-foreground">{t.voiceCalls}</td>
                  <td className="py-2 px-3 text-right text-muted-foreground">{t.voiceMinutes.toFixed(1)}</td>
                  <td className="py-2 px-3 text-right text-foreground">{fmt(t.voiceTotalCost)}</td>
                  <td className="py-2 px-3 text-right text-muted-foreground">{t.voiceTokens.toLocaleString()}</td>
                  <td className="py-2 px-3 text-right text-foreground">{t.activePackages}</td>
                  <td className="py-2 px-3 text-right text-muted-foreground">{t.remainingMsgs}</td>
                  <td className="py-2 px-3 text-right text-muted-foreground">{t.remainingMins.toFixed(1)}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={9} className="py-6 text-center text-muted-foreground">Sin datos de tenants.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Package Management */}
      <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-foreground flex items-center gap-2">
            <Package size={16} className="text-primary" /> Gestión de Paquetes
          </h3>
          <Button size="sm" onClick={() => setAssignDialog(true)} className="gap-1.5">
            <Plus size={14} /> Asignar Paquete
          </Button>
        </div>

        {(allPackages.data || []).length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No hay paquetes asignados.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="py-2 px-3 font-medium text-muted-foreground">Tenant</th>
                  <th className="py-2 px-3 font-medium text-muted-foreground">Paquete</th>
                  <th className="py-2 px-3 font-medium text-muted-foreground">Tipo</th>
                  <th className="py-2 px-3 font-medium text-muted-foreground text-right">Msgs</th>
                  <th className="py-2 px-3 font-medium text-muted-foreground text-right">Mins</th>
                  <th className="py-2 px-3 font-medium text-muted-foreground">Expira</th>
                  <th className="py-2 px-3 font-medium text-muted-foreground text-center">Estado</th>
                  <th className="py-2 px-3 font-medium text-muted-foreground text-center">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {(allPackages.data || []).map((pkg: any) => {
                  const tenantName = (tenantsList.data || []).find(t => t.id === pkg.tenant_id)?.name || pkg.tenant_id?.slice(0, 8) + '…';
                  const isActive = pkg.status === 'active';
                  return (
                    <tr key={pkg.id} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                      <td className="py-2 px-3 text-foreground font-medium">{tenantName}</td>
                      <td className="py-2 px-3 text-foreground">{pkg.package_name}</td>
                      <td className="py-2 px-3 text-muted-foreground capitalize">{pkg.package_type}</td>
                      <td className="py-2 px-3 text-right text-muted-foreground">{pkg.used_messages}/{pkg.included_messages}</td>
                      <td className="py-2 px-3 text-right text-muted-foreground">{Number(pkg.used_minutes).toFixed(1)}/{Number(pkg.included_minutes)}</td>
                      <td className="py-2 px-3 text-muted-foreground">
                        {pkg.expires_at ? new Date(pkg.expires_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                      </td>
                      <td className="py-2 px-3 text-center">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                          isActive ? 'bg-green-500/10 text-green-600' : 'bg-muted text-muted-foreground'
                        }`}>{pkg.status}</span>
                      </td>
                      <td className="py-2 px-3 text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => togglePackage.mutate({ id: pkg.id, newStatus: isActive ? 'disabled' : 'active' })}
                          className="h-7 px-2"
                          title={isActive ? 'Deshabilitar' : 'Habilitar'}
                        >
                          {isActive ? <ToggleRight size={16} className="text-green-600" /> : <ToggleLeft size={16} className="text-muted-foreground" />}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Catalog management */}
      <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
        <h3 className="font-semibold text-foreground flex items-center gap-2 mb-4">
          <DollarSign size={16} className="text-primary" /> Catálogo de Paquetes
        </h3>
        {(catalog.data || []).length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No hay paquetes en el catálogo. Agrégalos desde la base de datos.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {(catalog.data || []).map((item: any) => (
              <div key={item.id} className={`border rounded-xl p-4 ${item.active ? 'border-border' : 'border-border opacity-50'}`}>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-bold text-foreground">{item.name}</h4>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${item.active ? 'bg-green-500/10 text-green-600' : 'bg-muted text-muted-foreground'}`}>
                    {item.active ? 'Activo' : 'Inactivo'}
                  </span>
                </div>
                <p className="text-lg font-bold text-foreground">${Number(item.price_mxn).toLocaleString()} MXN <span className="text-xs text-muted-foreground font-normal">/ ${Number(item.price_usd)} USD</span></p>
                <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                  {item.included_messages > 0 && <p>📩 {item.included_messages} mensajes</p>}
                  {Number(item.included_minutes) > 0 && <p>📞 {Number(item.included_minutes)} minutos</p>}
                  <p>📅 {item.validity_days} días de vigencia</p>
                  <p className="capitalize">Tipo: {item.package_type}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Assign Package Dialog */}
      <Dialog open={assignDialog} onOpenChange={setAssignDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Asignar Paquete a Tenant</DialogTitle>
            <DialogDescription>Selecciona el tenant y el paquete que deseas asignar.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Tenant</label>
              <Select value={selectedTenant} onValueChange={setSelectedTenant}>
                <SelectTrigger><SelectValue placeholder="Seleccionar tenant..." /></SelectTrigger>
                <SelectContent>
                  {(tenantsList.data || []).map(t => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Paquete</label>
              <Select value={selectedCatalog} onValueChange={setSelectedCatalog}>
                <SelectTrigger><SelectValue placeholder="Seleccionar paquete..." /></SelectTrigger>
                <SelectContent>
                  {(catalog.data || []).filter((c: any) => c.active).map((c: any) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} — ${Number(c.price_mxn).toLocaleString()} MXN
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignDialog(false)}>Cancelar</Button>
            <Button
              onClick={() => assignPackage.mutate({ tenantId: selectedTenant, catalogId: selectedCatalog })}
              disabled={!selectedTenant || !selectedCatalog || assignPackage.isPending}
            >
              {assignPackage.isPending ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
              Asignar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SuperAdminConsumptionTab;
