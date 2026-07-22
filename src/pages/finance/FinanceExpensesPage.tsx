import ExpensesPage from '@/pages/ExpensesPage';

/**
 * Finance-scoped expenses page — same component as /expenses, but with the
 * approval workflow enabled for tenant admins/owners/super_admin.
 */
export default function FinanceExpensesPage() {
  return <ExpensesPage enableApproval />;
}
