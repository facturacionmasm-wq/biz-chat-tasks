// Forecast de flujo de caja con soporte de escenarios what-if (Fase 2).

export interface ScenarioAssumptions {
  /** % de variación sobre ingresos base. +0.10 = +10%, -0.15 = -15% */
  revenueDelta?: number;
  /** % de variación sobre egresos base. +0.10 = +10% */
  expenseDelta?: number;
  /** Días extra de retraso en cobranza (empuja scheduledInflows) */
  collectionDelayDays?: number;
}

export interface CashflowInput extends ScenarioAssumptions {
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

export type ScenarioKey = 'conservative' | 'base' | 'optimistic' | 'custom';

export const SCENARIO_PRESETS: Record<Exclude<ScenarioKey, 'custom'>, Required<ScenarioAssumptions>> = {
  conservative: { revenueDelta: -0.15, expenseDelta: 0.10, collectionDelayDays: 10 },
  base:         { revenueDelta: 0,      expenseDelta: 0,     collectionDelayDays: 0 },
  optimistic:   { revenueDelta: 0.15,  expenseDelta: -0.05, collectionDelayDays: -5 },
};

function shiftDateKey(iso: string, days: number): string {
  const d = new Date(iso.slice(0, 10) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function projectCashflow(input: CashflowInput): CashflowPoint[] {
  const revenueDelta = input.revenueDelta ?? 0;
  const expenseDelta = input.expenseDelta ?? 0;
  const collectionDelay = Math.round(input.collectionDelayDays ?? 0);

  const out: CashflowPoint[] = [];
  let balance = input.currentBalance;
  const start = new Date();
  const scheduledIn = new Map<string, number>();
  const scheduledOut = new Map<string, number>();

  (input.scheduledInflows ?? []).forEach((s) => {
    const key = shiftDateKey(s.date, collectionDelay);
    scheduledIn.set(key, (scheduledIn.get(key) ?? 0) + s.amount * (1 + revenueDelta));
  });
  (input.scheduledOutflows ?? []).forEach((s) => {
    const key = s.date.slice(0, 10);
    scheduledOut.set(key, (scheduledOut.get(key) ?? 0) + s.amount * (1 + expenseDelta));
  });

  const baseIn = input.dailyInflow * (1 + revenueDelta);
  const baseOut = input.dailyOutflow * (1 + expenseDelta);

  for (let i = 1; i <= input.horizonDays; i++) {
    const d = new Date(start.getTime() + i * 86400000);
    const key = d.toISOString().slice(0, 10);
    const inflow = baseIn + (scheduledIn.get(key) ?? 0);
    const outflow = baseOut + (scheduledOut.get(key) ?? 0);
    balance += inflow - outflow;
    out.push({
      date: key,
      projectedBalance: Math.round(balance * 100) / 100,
      inflow: Math.round(inflow * 100) / 100,
      outflow: Math.round(outflow * 100) / 100,
    });
  }
  return out;
}
