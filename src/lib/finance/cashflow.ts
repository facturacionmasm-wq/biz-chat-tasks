// Forecast simple de flujo de caja Fase 1.
// Basado en saldo actual + inflows/outflows proyectados por promedio histórico.

export interface CashflowInput {
  currentBalance: number;
  dailyInflow: number;   // promedio diario
  dailyOutflow: number;  // promedio diario
  scheduledInflows?: { date: string; amount: number }[]; // AR
  scheduledOutflows?: { date: string; amount: number }[]; // AP
  horizonDays: 7 | 30 | 60 | 90;
}

export interface CashflowPoint {
  date: string;
  projectedBalance: number;
  inflow: number;
  outflow: number;
}

export function projectCashflow(input: CashflowInput): CashflowPoint[] {
  const out: CashflowPoint[] = [];
  let balance = input.currentBalance;
  const start = new Date();
  const scheduledIn = new Map<string, number>();
  const scheduledOut = new Map<string, number>();
  (input.scheduledInflows ?? []).forEach((s) => scheduledIn.set(s.date.slice(0, 10), (scheduledIn.get(s.date.slice(0, 10)) ?? 0) + s.amount));
  (input.scheduledOutflows ?? []).forEach((s) => scheduledOut.set(s.date.slice(0, 10), (scheduledOut.get(s.date.slice(0, 10)) ?? 0) + s.amount));

  for (let i = 1; i <= input.horizonDays; i++) {
    const d = new Date(start.getTime() + i * 86400000);
    const key = d.toISOString().slice(0, 10);
    const inflow = input.dailyInflow + (scheduledIn.get(key) ?? 0);
    const outflow = input.dailyOutflow + (scheduledOut.get(key) ?? 0);
    balance += inflow - outflow;
    out.push({ date: key, projectedBalance: Math.round(balance * 100) / 100, inflow, outflow });
  }
  return out;
}
