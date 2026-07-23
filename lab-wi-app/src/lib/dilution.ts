// Dilution calculator — the maths behind the `dilution` step type.
// Solves the classic C1·V1 = C2·V2 relationship for whichever of the four
// variables the author left as the unknown.

export type DilutionVar = 'C1' | 'V1' | 'C2' | 'V2';

export interface DilutionVarMeta {
  code: DilutionVar;
  /** key used in parameters / actual_values */
  key: 'c1' | 'v1' | 'c2' | 'v2';
  label: string;
  kind: 'conc' | 'vol';
}

export const DILUTION_VARS: DilutionVarMeta[] = [
  { code: 'C1', key: 'c1', label: 'Stock concentration', kind: 'conc' },
  { code: 'V1', key: 'v1', label: 'Stock volume',        kind: 'vol'  },
  { code: 'C2', key: 'c2', label: 'Final concentration', kind: 'conc' },
  { code: 'V2', key: 'v2', label: 'Final volume',        kind: 'vol'  },
];

export const dilutionVar = (code: DilutionVar) =>
  DILUTION_VARS.find(v => v.code === code)!;

export interface DilutionValues {
  c1?: number | null;
  v1?: number | null;
  c2?: number | null;
  v2?: number | null;
}

const ok = (n: number | null | undefined): n is number => n != null && isFinite(n);

/** Solve C1·V1 = C2·V2 for `solveFor` given the other three values. Returns
 *  null when an input is missing or the maths is invalid (divide-by-zero, or a
 *  non-finite / negative result). */
export function solveDilution(solveFor: DilutionVar, vals: DilutionValues): number | null {
  const { c1, v1, c2, v2 } = vals;
  let result: number;
  switch (solveFor) {
    case 'C1': if (!ok(c2) || !ok(v2) || !ok(v1) || v1 === 0) return null; result = (c2 * v2) / v1; break;
    case 'V1': if (!ok(c2) || !ok(v2) || !ok(c1) || c1 === 0) return null; result = (c2 * v2) / c1; break;
    case 'C2': if (!ok(c1) || !ok(v1) || !ok(v2) || v2 === 0) return null; result = (c1 * v1) / v2; break;
    case 'V2': if (!ok(c1) || !ok(v1) || !ok(c2) || c2 === 0) return null; result = (c1 * v1) / c2; break;
  }
  if (!isFinite(result) || result < 0) return null;
  return result;
}
