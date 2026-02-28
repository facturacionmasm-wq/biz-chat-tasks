import { useState, useEffect } from 'react';
import { Receipt, DollarSign, Calendar, TrendingUp, Filter, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface Expense {
  id: string;
  user_id: string;
  category: string | null;
  description: string | null;
  amount: number;
  currency: string;
  expense_date: string;
  status: string;
  created_at: string;
  user_name?: string;
}

const ExpensesPage = () => {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'list' | 'by_user'>('list');
  const [periodFilter, setPeriodFilter] = useState<'day' | 'month' | 'year'>('month');

  useEffect(() => {
    fetchExpenses();
  }, []);

  const fetchExpenses = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('expenses')
      .select('*')
      .order('expense_date', { ascending: false })
      .limit(200);

    if (!error && data) {
      // Fetch user names
      const userIds = [...new Set(data.map(e => e.user_id))];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, name')
        .in('user_id', userIds);

      const nameMap = new Map(profiles?.map(p => [p.user_id, p.name]) || []);
      setExpenses(data.map(e => ({ ...e, user_name: nameMap.get(e.user_id) || 'Desconocido' })));
    }
    setLoading(false);
  };

  const now = new Date();
  const filteredExpenses = expenses.filter(e => {
    const d = new Date(e.expense_date);
    if (periodFilter === 'day') return d.toDateString() === now.toDateString();
    if (periodFilter === 'month') return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    return d.getFullYear() === now.getFullYear();
  });

  const totalAmount = filteredExpenses.reduce((s, e) => s + Number(e.amount), 0);

  const byUser = filteredExpenses.reduce((acc, e) => {
    const name = e.user_name || 'Desconocido';
    if (!acc[name]) acc[name] = { total: 0, count: 0, expenses: [] };
    acc[name].total += Number(e.amount);
    acc[name].count += 1;
    acc[name].expenses.push(e);
    return acc;
  }, {} as Record<string, { total: number; count: number; expenses: Expense[] }>);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 size={24} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Receipt size={24} className="text-primary" /> Control de Gastos
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Gastos registrados por empleados vía WhatsApp</p>
        </div>
        <div className="flex items-center gap-2">
          {(['day', 'month', 'year'] as const).map(p => (
            <button
              key={p}
              onClick={() => setPeriodFilter(p)}
              className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${periodFilter === p ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'}`}
            >
              {p === 'day' ? 'Hoy' : p === 'month' ? 'Este mes' : 'Este año'}
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-muted-foreground">Total gastos</span>
            <DollarSign size={18} className="text-primary" />
          </div>
          <p className="text-2xl font-bold text-foreground">${totalAmount.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-muted-foreground">Registros</span>
            <Receipt size={18} className="text-warning" />
          </div>
          <p className="text-2xl font-bold text-foreground">{filteredExpenses.length}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-muted-foreground">Empleados</span>
            <TrendingUp size={18} className="text-success" />
          </div>
          <p className="text-2xl font-bold text-foreground">{Object.keys(byUser).length}</p>
        </div>
      </div>

      {/* View toggle */}
      <div className="flex items-center gap-2">
        <button onClick={() => setViewMode('list')} className={`text-xs px-3 py-1.5 rounded-md font-medium ${viewMode === 'list' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'}`}>
          Lista
        </button>
        <button onClick={() => setViewMode('by_user')} className={`text-xs px-3 py-1.5 rounded-md font-medium ${viewMode === 'by_user' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'}`}>
          Por empleado
        </button>
      </div>

      {viewMode === 'list' ? (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Fecha</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Empleado</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Descripción</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Categoría</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Monto</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Estado</th>
              </tr>
            </thead>
            <tbody>
              {filteredExpenses.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-xs">No hay gastos registrados en este periodo</td></tr>
              )}
              {filteredExpenses.map(e => (
                <tr key={e.id} className="border-b border-border last:border-b-0 hover:bg-secondary/30">
                  <td className="px-4 py-3 text-muted-foreground">{format(new Date(e.expense_date), 'd MMM yyyy', { locale: es })}</td>
                  <td className="px-4 py-3 font-medium text-foreground">{e.user_name}</td>
                  <td className="px-4 py-3 text-foreground">{e.description || '—'}</td>
                  <td className="px-4 py-3"><span className="text-xs bg-secondary px-2 py-0.5 rounded-full">{e.category || 'General'}</span></td>
                  <td className="px-4 py-3 text-right font-semibold text-foreground">${Number(e.amount).toLocaleString('es-MX', { minimumFractionDigits: 2 })}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${e.status === 'approved' ? 'bg-success/10 text-success' : e.status === 'rejected' ? 'bg-destructive/10 text-destructive' : 'bg-warning/10 text-warning'}`}>
                      {e.status === 'approved' ? 'Aprobado' : e.status === 'rejected' ? 'Rechazado' : 'Pendiente'}
                    </span>
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
                    <p className="text-xs text-muted-foreground">{data.count} gastos registrados</p>
                  </div>
                </div>
                <p className="text-lg font-bold text-foreground">${data.total.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</p>
              </div>
              <div className="space-y-1">
                {data.expenses.slice(0, 5).map(e => (
                  <div key={e.id} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-secondary/30 text-xs">
                    <span className="text-muted-foreground">{format(new Date(e.expense_date), 'd MMM', { locale: es })}</span>
                    <span className="text-foreground flex-1 mx-3">{e.description || '—'}</span>
                    <span className="font-medium text-foreground">${Number(e.amount).toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {Object.keys(byUser).length === 0 && (
            <div className="text-center py-12 text-muted-foreground text-sm">No hay gastos registrados en este periodo</div>
          )}
        </div>
      )}
    </div>
  );
};

export default ExpensesPage;
