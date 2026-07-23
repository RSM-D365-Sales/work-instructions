import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Identity for a work-instruction version lineage. Versions of the same WI
 *  share an item link (or product name when unlinked) and title — both are
 *  carried forward when a New Version is created. */
export function wiLineageKey(wi: { reagent_item_id?: string | null; product_name?: string | null; title?: string | null }): string {
  const itemKey = wi.reagent_item_id ?? `noitem:${wi.product_name ?? ''}`;
  return `${itemKey}::${wi.title ?? ''}`;
}

export function calculateTolerance(
  measured: number,
  target: number,
  tolerancePct: number
): { inTolerance: boolean; deviationPct: number } {
  const deviationPct = Math.abs((measured - target) / target) * 100;
  return {
    inTolerance: deviationPct <= tolerancePct,
    deviationPct: Math.round(deviationPct * 100) / 100,
  };
}

/** Round a number for display without wrecking either very small volumes or
 *  very large counts: whole numbers ≥1000 (e.g. cells/mL), 3 dp for ~unit-scale
 *  values, 5 dp below 1. */
export function roundSmart(n: number): number {
  if (!isFinite(n)) return n;
  const abs = Math.abs(n);
  if (abs === 0) return 0;
  if (abs >= 1000) return Math.round(n);
  if (abs >= 1) return Math.round(n * 1000) / 1000;
  return Math.round(n * 100000) / 100000;
}
