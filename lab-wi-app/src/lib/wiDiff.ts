/* Version-diff logic for work instructions (backlog item D1).
 *
 * Matching runs in two passes:
 *   1. By LINEAGE TOKEN (source_step_id ?? id — migration 046): stable across
 *      version clones and editor re-saves, so a renamed step diffs as
 *      "modified" (with a Name change) instead of removed + added.
 *   2. Fallback for steps without a shared token (pre-046 data): by
 *      (step type + normalized name), duplicates consumed in document order.
 * Anything unmatched on the new side is "added"; unmatched on the old side is
 * "removed"; matched pairs with different name / description / parameters are
 * "modified"; a pair whose position changed is additionally flagged "moved".
 *
 * Pure functions — no fetching, no React — so the matching rules are easy to
 * reason about and test. */

import type { WIStep, WorkInstruction } from '../types';

export interface FieldChange {
  label: string;
  from: string;
  to: string;
}

export type StepDiffKind = 'unchanged' | 'modified' | 'added' | 'removed';

export interface StepDiffRow {
  kind: StepDiffKind;
  base?: WIStep;    // absent for 'added'
  target?: WIStep;  // absent for 'removed'
  changes: FieldChange[];
  moved: boolean;   // matched pair whose step_order changed
}

export interface StepDiffSummary {
  added: number;
  removed: number;
  modified: number;
  moved: number;
  unchanged: number;
}

/** Parameter keys that are implementation detail, not authored content. */
function isInternalKey(k: string): boolean {
  return k.startsWith('_');
}

/** Human-readable value for a parameter (recursively flattens lists/objects). */
export function fmtParamValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (Array.isArray(v)) {
    if (v.length === 0) return '—';
    return v.map(fmtParamValue).join('; ');
  }
  if (typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>)
      .filter(([k]) => !isInternalKey(k))
      .map(([k, val]) => `${labelize(k)}: ${fmtParamValue(val)}`)
      .join(', ');
  }
  return String(v);
}

export function labelize(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function stepTypeOf(s: WIStep): string {
  const p = (s.parameters ?? {}) as Record<string, unknown>;
  return (p._step_type as string) ?? 'custom';
}

/** Authored (non-internal) parameters of a step, for display on added/removed cards. */
export function authoredParams(s: WIStep): { label: string; value: string }[] {
  const p = (s.parameters ?? {}) as Record<string, unknown>;
  return Object.entries(p)
    .filter(([k, v]) => !isInternalKey(k) && v !== null && v !== undefined && v !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => ({ label: labelize(k), value: fmtParamValue(v) }));
}

function matchKey(s: WIStep): string {
  return `${stepTypeOf(s)}::${s.name.trim().toLowerCase()}`;
}

/** Stable identity across versions: the lineage token, falling back to the
 *  row id for steps created before migration 046 populated it. */
function lineageOf(s: WIStep): string {
  return s.source_step_id ?? s.id;
}

/** Field-level changes between a matched pair of steps. */
function diffStepFields(base: WIStep, target: WIStep): FieldChange[] {
  const changes: FieldChange[] = [];
  if (base.name.trim() !== target.name.trim()) {
    changes.push({ label: 'Name', from: base.name.trim() || '—', to: target.name.trim() || '—' });
  }
  if ((base.description ?? '') !== (target.description ?? '')) {
    changes.push({
      label: 'Description',
      from: (base.description ?? '').trim() || '—',
      to: (target.description ?? '').trim() || '—',
    });
  }
  const bp = (base.parameters ?? {}) as Record<string, unknown>;
  const tp = (target.parameters ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(bp), ...Object.keys(tp)])]
    .filter(k => !isInternalKey(k))
    .sort();
  for (const k of keys) {
    const from = fmtParamValue(bp[k]);
    const to = fmtParamValue(tp[k]);
    if (from !== to) changes.push({ label: labelize(k), from, to });
  }
  return changes;
}

/** Diff two versions' step lists. Rows come back in the TARGET version's
 *  order, with removed base steps appended (in base order) at the end. */
export function diffSteps(baseSteps: WIStep[], targetSteps: WIStep[]): StepDiffRow[] {
  const baseSorted = [...baseSteps].sort((a, z) => a.step_order - z.step_order);
  const targetSorted = [...targetSteps].sort((a, z) => a.step_order - z.step_order);

  // Pass 1 — lineage token (stable identity; survives renames).
  const baseByLineage = new Map<string, WIStep>();
  for (const b of baseSorted) baseByLineage.set(lineageOf(b), b);

  const pairFor = new Map<string, WIStep>();   // target id → base step
  const usedBase = new Set<string>();
  for (const t of targetSorted) {
    const b = baseByLineage.get(lineageOf(t));
    if (b && !usedBase.has(b.id)) {
      pairFor.set(t.id, b);
      usedBase.add(b.id);
    }
  }

  // Pass 2 — fallback for the leftovers: (type + name), duplicates in order.
  const queues = new Map<string, WIStep[]>();
  for (const b of baseSorted) {
    if (usedBase.has(b.id)) continue;
    const k = matchKey(b);
    const q = queues.get(k);
    if (q) q.push(b);
    else queues.set(k, [b]);
  }
  for (const t of targetSorted) {
    if (pairFor.has(t.id)) continue;
    const b = queues.get(matchKey(t))?.shift();
    if (b) {
      pairFor.set(t.id, b);
      usedBase.add(b.id);
    }
  }

  // Assemble rows in target order.
  const rows: StepDiffRow[] = [];
  for (const t of targetSorted) {
    const b = pairFor.get(t.id);
    if (!b) {
      rows.push({ kind: 'added', target: t, changes: [], moved: false });
      continue;
    }
    const changes = diffStepFields(b, t);
    rows.push({
      kind: changes.length > 0 ? 'modified' : 'unchanged',
      base: b,
      target: t,
      changes,
      moved: b.step_order !== t.step_order,
    });
  }

  const removed: StepDiffRow[] = baseSorted
    .filter(b => !usedBase.has(b.id))
    .map(b => ({ kind: 'removed' as const, base: b, changes: [], moved: false }));

  return [...rows, ...removed];
}

export function summarize(rows: StepDiffRow[]): StepDiffSummary {
  return {
    added: rows.filter(r => r.kind === 'added').length,
    removed: rows.filter(r => r.kind === 'removed').length,
    modified: rows.filter(r => r.kind === 'modified').length,
    moved: rows.filter(r => r.moved && r.kind !== 'modified').length,
    unchanged: rows.filter(r => r.kind === 'unchanged' && !r.moved).length,
  };
}

/** Header-field changes between two versions of a work instruction. */
export function diffHeader(base: WorkInstruction, target: WorkInstruction): FieldChange[] {
  const fields: { label: string; get: (w: WorkInstruction) => string }[] = [
    { label: 'Description', get: w => (w.description ?? '').trim() || '—' },
    { label: 'Product Name', get: w => w.product_name ?? '—' },
    { label: 'Target Molarity', get: w => (w.target_molarity != null ? `${w.target_molarity} M` : '—') },
    { label: 'Scheduled Duration', get: w => (w.scheduled_minutes != null ? `${w.scheduled_minutes} min` : '—') },
  ];
  const changes: FieldChange[] = [];
  for (const f of fields) {
    const from = f.get(base);
    const to = f.get(target);
    if (from !== to) changes.push({ label: f.label, from, to });
  }
  return changes;
}
