// Aging report: 0 / 1-30 / 31-60 / 61-90 / +90

export type AgingBucket = 'current' | '1-30' | '31-60' | '61-90' | '90+';

export interface AgingItem {
  id: string;
  contactName: string;
  amount: number;
  currency: string;
  dueDate?: string | null;
}

export interface AgingResult {
  buckets: Record<AgingBucket, { count: number; total: number; items: AgingItem[] }>;
  grandTotal: number;
}

export function bucketFor(dueDate: string | null | undefined): AgingBucket {
  if (!dueDate) return 'current';
  const d = new Date(dueDate).getTime();
  const now = Date.now();
  const days = Math.floor((now - d) / 86400000);
  if (days <= 0) return 'current';
  if (days <= 30) return '1-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

export function buildAging(items: AgingItem[]): AgingResult {
  const empty = () => ({ count: 0, total: 0, items: [] as AgingItem[] });
  const buckets: AgingResult['buckets'] = {
    current: empty(),
    '1-30': empty(),
    '31-60': empty(),
    '61-90': empty(),
    '90+': empty(),
  };
  let grand = 0;
  items.forEach((it) => {
    const b = bucketFor(it.dueDate);
    buckets[b].items.push(it);
    buckets[b].count += 1;
    buckets[b].total += it.amount;
    grand += it.amount;
  });
  return { buckets, grandTotal: grand };
}
