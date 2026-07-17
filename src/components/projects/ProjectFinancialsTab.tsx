import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid,
} from 'recharts';
import {
  AlertTriangle, TrendingUp, DollarSign, Target, Percent, Sparkles,
  Paperclip, Trash2, Download, RefreshCw, Save, PlusCircle,
} from 'lucide-react';
import { useProjectFinancials, CostCategory, CostType } from '@/hooks/useProjectFinancials';

interface Props { projectId: string; }

const CATEGORY_LABEL: Record<CostCategory, string> = {
  materials: 'Materiales',
  labor: 'Mano de obra',
  equipment: 'Equipo/Maquinaria',
  subcontracts: 'Subcontratos',
  overhead: 'Indirectos',
  contingency: 'Imprevistos',
};

const ProjectFinancialsTab = ({ projectId }: Props) => {
  const {
    costs, snapshots, settings, loading, canEditSettings,
    createCost, deleteCost, updateSettings, downloadAttachment, triggerAgent,
  } = useProjectFinancials(projectId);

  const [showForm, setShowForm] = useState(false);
  const [category, setCategory] = useState<CostCategory>('materials');
  const [costType, setCostType] = useState<CostType>('variable');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [costDate, setCostDate] = useState(new Date().toISOString().slice(0, 10));
  const [file, setFile] = useState<File | null>(null);

  const [contractDraft, setContractDraft] = useState<string>('');
  const [marginDraft, setMarginDraft] = useState<string>('');
  const [progressDraft, setProgressDraft] = useState<string>('');
  const [durationDraft, setDurationDraft] = useState<string>('');

  const currency = settings?.contract_currency || 'MXN';
  const fmt = (n: number | null | undefined) =>
    n == null ? '—' : new Intl.NumberFormat('es-MX', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(n));

  const chartData = useMemo(() => {
    const sorted = [...costs].sort((a, b) => a.cost_date.localeCompare(b.cost_date));
    let acc = 0;
    const contract = settings?.contract_amount || 0;
    const progress = settings?.physical_progress_pct || 0;
    const progressAmount = (progress / 100) * contract;
    return sorted.map((c) => {
      acc += Number(c.amount);
      return {
        date: format(new Date(c.cost_date), 'd MMM', { locale: es }),
        Costo: Math.round(acc),
        Contrato: contract,
        AvanceValorizado: Math.round(progressAmount),
      };
    });
  }, [costs, settings?.contract_amount, settings?.physical_progress_pct]);

  const latest = snapshots[0];

  const handleCreateCost = async (e: React.FormEvent) => {
    e.preventDefault();
    const num = Number(amount);
    if (!num || num <= 0) return;
    const res = await createCost({
      category, cost_type: costType, amount: num,
      cost_date: costDate, description, file,
    });
    if (res) {
      setAmount(''); setDescription(''); setFile(null);
      setCostDate(new Date().toISOString().slice(0, 10));
      setShowForm(false);
    }
  };

  const handleSaveSettings = async () => {
    const patch: any = {};
    if (contractDraft !== '') patch.contract_amount = Number(contractDraft);
    if (marginDraft !== '') patch.target_margin_pct = Number(marginDraft);
    if (progressDraft !== '') patch.physical_progress_pct = Number(progressDraft);
    if (durationDraft !== '') patch.estimated_duration_days = Number(durationDraft);
    if (Object.keys(patch).length === 0) return;
    await updateSettings(patch);
    setContractDraft(''); setMarginDraft(''); setProgressDraft(''); setDurationDraft('');
  };

  if (loading) {
    return <div className="text-center text-sm text-muted-foreground py-8">Cargando análisis financiero...</div>;
  }

  const alerts = (latest?.alerts as any[]) || [];

  return (
    <div className="space-y-4">
      {/* Settings */}
      <div className="bg-card rounded-2xl p-4 shadow-soft">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground">Datos financieros del proyecto</h3>
          <button
            onClick={() => triggerAgent('manual_refresh')}
            className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
          >
            <RefreshCw size={12} /> Recalcular
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SettingField
            label="Contrato / Ingreso"
            value={settings?.contract_amount != null ? String(settings.contract_amount) : ''}
            draft={contractDraft}
            onDraft={setContractDraft}
            editable={canEditSettings}
            suffix={currency}
          />
          <SettingField
            label="Margen objetivo (%)"
            value={settings?.target_margin_pct != null ? String(settings.target_margin_pct) : ''}
            draft={marginDraft}
            onDraft={setMarginDraft}
            editable={canEditSettings}
            suffix="%"
          />
          <SettingField
            label="Avance físico (%)"
            value={settings?.physical_progress_pct != null ? String(settings.physical_progress_pct) : ''}
            draft={progressDraft}
            onDraft={setProgressDraft}
            editable={canEditSettings}
            suffix="%"
          />
          <SettingField
            label="Duración estimada (días)"
            value={settings?.estimated_duration_days != null ? String(settings.estimated_duration_days) : ''}
            draft={durationDraft}
            onDraft={setDurationDraft}
            editable={canEditSettings}
            suffix="d"
          />
        </div>
        {canEditSettings && (contractDraft || marginDraft || progressDraft || durationDraft) && (
          <button
            onClick={handleSaveSettings}
            className="mt-3 inline-flex items-center gap-1.5 bg-primary text-primary-foreground text-xs font-semibold px-4 py-2 rounded-xl hover:opacity-90"
          >
            <Save size={12} /> Guardar cambios
          </button>
        )}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard icon={DollarSign} label="Costo total" value={fmt(latest?.total_cost ?? sum(costs))} />
        <KpiCard icon={Target} label="Punto de equilibrio" value={fmt(latest?.break_even_amount)} sub={latest?.break_even_progress_pct != null ? `${latest.break_even_progress_pct}% del contrato` : undefined} />
        <KpiCard icon={TrendingUp} label="Precio mínimo recomendado" value={fmt(latest?.recommended_min_price)} />
        <KpiCard icon={Percent} label="Utilidad proyectada" value={fmt(latest?.projected_profit)} sub={latest?.cost_performance_index != null ? `CPI ${latest.cost_performance_index}` : undefined} />
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map((a: any, i: number) => (
            <div key={i} className={`flex items-start gap-2 rounded-2xl p-3 text-xs ${
              a.severity === 'high'
                ? 'bg-destructive/10 text-destructive border border-destructive/20'
                : 'bg-warning/10 text-warning border border-warning/20'
            }`}>
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>{a.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* Chart */}
      {chartData.length > 0 && (
        <div className="bg-card rounded-2xl p-4 shadow-soft">
          <h3 className="text-sm font-semibold text-foreground mb-3">Costo acumulado vs contrato vs avance valorizado</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="date" fontSize={11} />
                <YAxis fontSize={11} tickFormatter={(v) => new Intl.NumberFormat('es-MX', { notation: 'compact' }).format(v)} />
                <Tooltip formatter={(v: any) => fmt(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="Costo" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Contrato" stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" strokeWidth={1.5} dot={false} />
                <Line type="monotone" dataKey="AvanceValorizado" stroke="hsl(var(--success, 142 76% 36%))" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* AI history */}
      {snapshots.length > 0 && (
        <div className="bg-card rounded-2xl p-4 shadow-soft">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <Sparkles size={14} className="text-primary" /> Historial de análisis IA
          </h3>
          <div className="space-y-3">
            {snapshots.map((s) => (
              <div key={s.id} className="border border-border rounded-xl p-3">
                <div className="text-[11px] text-muted-foreground mb-1">
                  {format(new Date(s.snapshot_at), "d MMM yyyy · HH:mm", { locale: es })}
                  {s.trigger_source && <span> · {s.trigger_source}</span>}
                </div>
                <p className="text-xs text-foreground whitespace-pre-wrap">{s.ai_summary}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Costs */}
      <div className="bg-card rounded-2xl p-4 shadow-soft">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground">Registros de costo</h3>
          <button
            onClick={() => setShowForm((s) => !s)}
            className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground text-xs font-semibold px-3 py-1.5 rounded-xl hover:opacity-90"
          >
            <PlusCircle size={13} /> {showForm ? 'Cancelar' : 'Nuevo costo'}
          </button>
        </div>

        {showForm && (
          <form onSubmit={handleCreateCost} className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4 p-3 bg-muted/40 rounded-xl">
            <select value={category} onChange={(e) => setCategory(e.target.value as CostCategory)} className="bg-background border border-border rounded-lg px-3 py-2 text-sm">
              {Object.entries(CATEGORY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <select value={costType} onChange={(e) => setCostType(e.target.value as CostType)} className="bg-background border border-border rounded-lg px-3 py-2 text-sm">
              <option value="variable">Variable</option>
              <option value="fixed">Fijo</option>
            </select>
            <input type="number" step="0.01" min="0" placeholder="Monto" value={amount} onChange={(e) => setAmount(e.target.value)} className="bg-background border border-border rounded-lg px-3 py-2 text-sm" required />
            <input type="date" value={costDate} onChange={(e) => setCostDate(e.target.value)} className="bg-background border border-border rounded-lg px-3 py-2 text-sm" />
            <input type="text" placeholder="Descripción" value={description} onChange={(e) => setDescription(e.target.value)} className="bg-background border border-border rounded-lg px-3 py-2 text-sm md:col-span-2" />
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer md:col-span-2">
              <Paperclip size={13} /> {file ? file.name : 'Adjuntar factura/recibo (opcional)'}
              <input type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </label>
            <button type="submit" className="md:col-span-2 bg-primary text-primary-foreground text-xs font-semibold px-4 py-2 rounded-xl hover:opacity-90">
              Registrar costo
            </button>
          </form>
        )}

        {costs.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-6">Aún no hay costos registrados.</div>
        ) : (
          <div className="space-y-2">
            {[...costs].reverse().map((c) => (
              <div key={c.id} className="flex items-center gap-3 p-3 border border-border rounded-xl">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-[10px] font-semibold text-primary text-center">
                  {CATEGORY_LABEL[c.category].split(' ')[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">{fmt(Number(c.amount))}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${c.cost_type === 'fixed' ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary'}`}>
                      {c.cost_type === 'fixed' ? 'Fijo' : 'Variable'}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {CATEGORY_LABEL[c.category]} · {format(new Date(c.cost_date), 'd MMM yyyy', { locale: es })}
                    {c.created_by_name && ` · ${c.created_by_name}`}
                  </div>
                  {c.description && <div className="text-xs text-foreground/80 mt-0.5 truncate">{c.description}</div>}
                </div>
                {c.attachment_path && (
                  <button onClick={() => downloadAttachment(c.attachment_path!)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground">
                    <Download size={13} />
                  </button>
                )}
                <button onClick={() => deleteCost(c.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive">
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const KpiCard = ({ icon: Icon, label, value, sub }: { icon: any; label: string; value: string; sub?: string }) => (
  <div className="bg-card rounded-2xl p-3 shadow-soft">
    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1">
      <Icon size={12} /> {label}
    </div>
    <div className="text-lg font-bold text-foreground">{value}</div>
    {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
  </div>
);

const SettingField = ({ label, value, draft, onDraft, editable, suffix }: {
  label: string; value: string; draft: string; onDraft: (v: string) => void; editable: boolean; suffix?: string;
}) => (
  <div>
    <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">{label}</div>
    {editable ? (
      <input
        type="number"
        step="0.01"
        placeholder={value || '—'}
        value={draft}
        onChange={(e) => onDraft(e.target.value)}
        className="w-full bg-muted/40 border border-border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
    ) : (
      <div className="text-sm font-semibold text-foreground">{value || '—'} {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}</div>
    )}
  </div>
);

const sum = (arr: { amount: number | string }[]) =>
  arr.reduce((acc, c) => acc + Number(c.amount || 0), 0);

export default ProjectFinancialsTab;
