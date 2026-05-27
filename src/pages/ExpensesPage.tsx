import { useState, useEffect } from 'react';
import { Receipt, DollarSign, Calendar, TrendingUp, Loader2, FileText, ExternalLink, CheckCircle, XCircle, Clock, AlertCircle, Search, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface Expense {
  id: string;
  user_id: string;
  type: string;
  category: string | null;
  description: string | null;
  vendor_name: string | null;
  concept: string | null;
  amount: number;
  currency: string;
  expense_date: string;
  status: string;
  approval_required: boolean;
  approver_user_id: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  paid_at: string | null;
  folio: string | null;
  payment_method: string | null;
  document_budget_drive_url: string | null;
  document_payment_drive_url: string | null;
  source: string;
  created_at: string;
  user_name?: string;
  approver_name?: string;
}

const STATUS_CONFIG: Record<string, { label: string; class: string; icon: React.ElementType }> = {
  paid: { label: 'Pagado', class: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400', icon: CheckCircle },
  pending: { label: 'Pendiente', class: 'bg-amber-500/10 text-amber-600 dark:text-amber-400', icon: Clock },
  pending_approval: { label: 'Por aprobar', class: 'bg-blue-500/10 text-blue-600 dark:text-blue-400', icon: AlertCircle },
  approved: { label: 'Aprobado', class: 'bg-violet-500/10 text-violet-600 dark:text-violet-400', icon: CheckCircle },
  rejected: { label: 'Rechazado', class: 'bg-red-500/10 text-red-600 dark:text-red-400', icon: XCircle },
};

const ExpensesPage = () => {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'list' | 'by_user'>('list');
  const [periodFilter, setPeriodFilter] = useState<'day' | 'month' | 'year' | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'expense' | 'budget'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'paid' | 'pending_approval' | 'approved' | 'rejected'>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchExpenses();
  }, []);

  const fetchExpenses = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('expenses')
      .select('id, user_id, type, category, description, vendor_name, concept, amount, currency, expense_date, status, approval_required, approver_user_id, approved_at, rejected_at, rejection_reason, paid_at, folio, payment_method, document_budget_drive_url, document_payment_drive_url, source, created_at')
      .order('expense_date', { ascending: false })
      .limit(300);

    if (!error && data) {
      const userIds = [...new Set(data.map(e => e.user_id).concat(data.filter(e => e.approver_user_id).map(e => e.approver_user_id!)))];
      const { data: profiles } = await supabase
        .from('profiles_safe' as any)
        .select('user_id, name')
        .in('user_id', userIds) as { data: any[] | null };

      const nameMap = new Map(profiles?.map(p => [p.user_id, p.name]) || []);
      setExpenses(data.map(e => ({
        ...e,
        user_name: nameMap.get(e.user_id) || 'Desconocido',
        approver_name: e.approver_user_id ? nameMap.get(e.approver_user_id) || null : null,
      })));
    }
    setLoading(false);
  };

  const now = new Date();
  const q = search.trim().toLowerCase();
  const hasSearch = q.length > 0;
  const filteredExpenses = expenses.filter(e => {
    const d = new Date(e.expense_date);
    // When searching, ignore period filter so users find expenses across any date
    if (!hasSearch) {
      if (periodFilter === 'day' && d.toDateString() !== now.toDateString()) return false;
      if (periodFilter === 'month' && (d.getMonth() !== now.getMonth() || d.getFullYear() !== now.getFullYear())) return false;
      if (periodFilter === 'year' && d.getFullYear() !== now.getFullYear()) return false;
    }
    if (typeFilter !== 'all' && e.type !== typeFilter) return false;
    if (statusFilter !== 'all' && e.status !== statusFilter) return false;
    if (hasSearch) {
      const amountStr = Number(e.amount).toString();
      const amountFmt = Number(e.amount).toLocaleString('es-MX', { minimumFractionDigits: 2 });
      const haystack = [
        e.user_name, e.vendor_name, e.description, e.concept, e.category,
        e.folio, e.payment_method, e.currency, amountStr, amountFmt,
      ].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  const totalAmount = filteredExpenses.reduce((s, e) => s + Number(e.amount), 0);
  const budgetCount = filteredExpenses.filter(e => e.type === 'budget').length;
  const paidCount = filteredExpenses.filter(e => e.status === 'paid').length;
  const pendingApprovalCount = filteredExpenses.filter(e => e.status === 'pending_approval').length;

  const byUser = filteredExpenses.reduce((acc, e) => {
    const name = e.user_name || 'Desconocido';
    if (!acc[name]) acc[name] = { total: 0, count: 0, expenses: [] };
    acc[name].total += Number(e.amount);
    acc[name].count += 1;
    acc[name].expenses.push(e);
    return acc;
  }, {} as Record<string, { total: number; count: number; expenses: Expense[] }>);

  const getStatusBadge = (status: string) => {
    const config = STATUS_CONFIG[status] || { label: status, class: 'bg-muted text-muted-foreground', icon: Clock };
    const Icon = config.icon;
    return (
      <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${config.class}`}>
        <Icon size={12} />
        {config.label}
      </span>
    );
  };

  const getTypeBadge = (type: string) => (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${type === 'budget' ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400' : 'bg-muted text-muted-foreground'}`}>
      {type === 'budget' ? '📋 Presupuesto' : '🧾 Gasto'}
    </span>
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 size={24} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Receipt size={24} className="text-primary" /> Control de Gastos y Presupuestos
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Registros de gastos pagados y presupuestos por autorizar vía WhatsApp</p>
        </div>
        <div className="flex items-center gap-2">
          {(['day', 'month', 'year', 'all'] as const).map(p => (
            <button
              key={p}
              onClick={() => setPeriodFilter(p)}
              className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${periodFilter === p ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'}`}
            >
              {p === 'day' ? 'Hoy' : p === 'month' ? 'Este mes' : p === 'year' ? 'Este año' : 'Todos'}
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-muted-foreground">Total</span>
            <DollarSign size={16} className="text-primary" />
          </div>
          <p className="text-xl font-bold text-foreground">${totalAmount.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-muted-foreground">Pagados</span>
            <CheckCircle size={16} className="text-emerald-500" />
          </div>
          <p className="text-xl font-bold text-foreground">{paidCount}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-muted-foreground">Presupuestos</span>
            <FileText size={16} className="text-blue-500" />
          </div>
          <p className="text-xl font-bold text-foreground">{budgetCount}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-muted-foreground">Por aprobar</span>
            <AlertCircle size={16} className="text-amber-500" />
          </div>
          <p className="text-xl font-bold text-foreground">{pendingApprovalCount}</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por autor, proveedor, descripción, monto, folio..."
          className="w-full pl-9 pr-9 py-2 text-sm bg-card border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-muted-foreground hover:bg-secondary"
            aria-label="Limpiar búsqueda"
          >
            <X size={14} />
          </button>
        )}
        {hasSearch && (
          <p className="text-[11px] text-muted-foreground mt-1.5 ml-1">
            Mostrando {filteredExpenses.length} resultados de todos los periodos
          </p>
        )}
      </div>

      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 mr-2">
          <button onClick={() => setViewMode('list')} className={`text-xs px-3 py-1.5 rounded-md font-medium ${viewMode === 'list' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'}`}>
            Lista
          </button>
          <button onClick={() => setViewMode('by_user')} className={`text-xs px-3 py-1.5 rounded-md font-medium ${viewMode === 'by_user' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'}`}>
            Por empleado
          </button>
        </div>
        <div className="h-4 w-px bg-border" />
        <div className="flex items-center gap-1">
          {(['all', 'expense', 'budget'] as const).map(t => (
            <button key={t} onClick={() => setTypeFilter(t)}
              className={`text-xs px-2.5 py-1 rounded-md ${typeFilter === t ? 'bg-secondary text-foreground font-medium' : 'text-muted-foreground hover:bg-secondary/50'}`}>
              {t === 'all' ? 'Todos' : t === 'expense' ? 'Gastos' : 'Presupuestos'}
            </button>
          ))}
        </div>
        <div className="h-4 w-px bg-border" />
        <div className="flex items-center gap-1">
          {(['all', 'paid', 'pending_approval', 'approved', 'rejected'] as const).map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`text-xs px-2.5 py-1 rounded-md ${statusFilter === s ? 'bg-secondary text-foreground font-medium' : 'text-muted-foreground hover:bg-secondary/50'}`}>
              {s === 'all' ? 'Todos' : STATUS_CONFIG[s]?.label || s}
            </button>
          ))}
        </div>
      </div>

      {viewMode === 'list' ? (
        <div className="bg-card border border-border rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Fecha</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Tipo</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Empleado</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Proveedor</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Descripción</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Categoría</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Monto</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Estado</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Docs</th>
              </tr>
            </thead>
            <tbody>
              {filteredExpenses.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground text-xs">No hay registros en este periodo</td></tr>
              )}
              {filteredExpenses.map(e => (
                <tr key={e.id} className="border-b border-border last:border-b-0 hover:bg-secondary/30">
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{format(new Date(e.expense_date), 'd MMM yyyy', { locale: es })}</td>
                  <td className="px-4 py-3">{getTypeBadge(e.type)}</td>
                  <td className="px-4 py-3 font-medium text-foreground whitespace-nowrap">{e.user_name}</td>
                  <td className="px-4 py-3 text-foreground">{e.vendor_name || '—'}</td>
                  <td className="px-4 py-3 text-foreground max-w-[200px] truncate">{e.description || e.concept || '—'}</td>
                  <td className="px-4 py-3"><span className="text-xs bg-secondary px-2 py-0.5 rounded-full">{e.category || 'General'}</span></td>
                  <td className="px-4 py-3 text-right font-semibold text-foreground whitespace-nowrap">${Number(e.amount).toLocaleString('es-MX', { minimumFractionDigits: 2 })} {e.currency}</td>
                  <td className="px-4 py-3">
                    <div className="space-y-1">
                      {getStatusBadge(e.status)}
                      {e.approver_name && (
                        <p className="text-[10px] text-muted-foreground">Aprobador: {e.approver_name}</p>
                      )}
                      {e.rejection_reason && (
                        <p className="text-[10px] text-red-500 truncate max-w-[120px]" title={e.rejection_reason}>💬 {e.rejection_reason}</p>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      {e.document_budget_drive_url && (
                        <a href={e.document_budget_drive_url} target="_blank" rel="noopener noreferrer"
                          className="text-blue-500 hover:text-blue-600" title="Presupuesto en Drive">
                          <FileText size={14} />
                        </a>
                      )}
                      {e.document_payment_drive_url && (
                        <a href={e.document_payment_drive_url} target="_blank" rel="noopener noreferrer"
                          className="text-emerald-500 hover:text-emerald-600" title="Comprobante en Drive">
                          <ExternalLink size={14} />
                        </a>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(byUser).sort(([,a], [,b]) => b.total - a.total).map(([name, data]) => (
            <div key={name} className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                    {name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{name}</p>
                    <p className="text-xs text-muted-foreground">{data.count} registros</p>
                  </div>
                </div>
                <p className="text-lg font-bold text-foreground">${data.total.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</p>
              </div>
              <div className="space-y-1">
                {data.expenses.slice(0, 8).map(e => (
                  <div key={e.id} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-secondary/30 text-xs gap-2">
                    <span className="text-muted-foreground whitespace-nowrap">{format(new Date(e.expense_date), 'd MMM', { locale: es })}</span>
                    {getTypeBadge(e.type)}
                    <span className="text-foreground flex-1 truncate">{e.vendor_name || e.description || '—'}</span>
                    {getStatusBadge(e.status)}
                    <span className="font-medium text-foreground whitespace-nowrap">${Number(e.amount).toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {Object.keys(byUser).length === 0 && (
            <div className="text-center py-12 text-muted-foreground text-sm">No hay registros en este periodo</div>
          )}
        </div>
      )}
    </div>
  );
};

export default ExpensesPage;