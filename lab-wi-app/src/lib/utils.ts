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
