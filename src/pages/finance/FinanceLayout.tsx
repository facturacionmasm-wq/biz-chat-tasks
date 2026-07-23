import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Landmark, ArrowLeftRight, TrendingUp, TrendingDown,
  Wallet, PiggyBank, Activity, Bot, Plug, GitCompare, Receipt, FileText,
} from 'lucide-react';

const tabs = [
  { to: '/finance', end: true, icon: LayoutDashboard, label: 'Resumen' },
  { to: '/finance/accounts', icon: Landmark, label: 'Cuentas' },
  { to: '/finance/transactions', icon: ArrowLeftRight, label: 'Transacciones' },
  { to: '/finance/expenses', icon: Receipt, label: 'Gastos' },
  { to: '/finance/reconciliation', icon: GitCompare, label: 'Conciliación' },
  { to: '/finance/cashflow', icon: Wallet, label: 'Flujo de efectivo' },
  { to: '/finance/receivables', icon: TrendingUp, label: 'Por cobrar' },
  { to: '/finance/payables', icon: TrendingDown, label: 'Por pagar' },
  { to: '/finance/budgets', icon: PiggyBank, label: 'Presupuestos' },
  { to: '/finance/cfdi', icon: FileText, label: 'CFDI' },
  { to: '/finance/health', icon: Activity, label: 'Health Score' },
  { to: '/finance/cfo-ai', icon: Bot, label: 'CFO AI' },
  { to: '/finance/integrations', icon: Plug, label: 'Integraciones' },
];



export default function FinanceLayout() {
  const { pathname } = useLocation();
  return (
    <div className="min-h-screen pb-24">
      <div className="px-4 pt-6 pb-3">
        <h1 className="text-2xl font-bold text-foreground">Finanzas Inteligentes</h1>
        <p className="text-sm text-muted-foreground mt-1">Vista financiera consolidada a nivel empresa</p>
      </div>

      <div className="mb-4">
        <div className="h-scroll gap-2 px-4 pb-1">
          {tabs.map((t) => {
            const active = t.end ? pathname === t.to : pathname.startsWith(t.to);
            return (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.end}
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-all shrink-0 ${
                  active
                    ? 'bg-[var(--rx-brand)] text-[var(--rx-brand-foreground,white)] shadow-soft'
                    : 'bg-[var(--rx-s2)] text-[var(--rx-t2)] hover:bg-[var(--rx-s2)]/70'
                }`}
              >
                <t.icon size={13} />
                {t.label}
              </NavLink>
            );
          })}
        </div>
      </div>


      <div className="px-4">
        <Outlet />
      </div>
    </div>
  );
}
