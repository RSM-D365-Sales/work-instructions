import type { QCResultType } from '../types';

/** The spec portion shared by a QC test definition and a captured result. */
export interface QCSpec {
  result_type: QCResultType;
  lower_limit?: number | null;
  upper_limit?: number | null;
  target?: number | null;
  expected_text?: string | null;
  unit?: string | null;
}

/** Evaluate whether a captured value meets its specification.
 *  Returns true/false, or null when there is no value yet or no spec to
 *  judge against (treated as "not applicable"). */
export function evaluateQC(
  spec: QCSpec,
  resultNumeric: number | null | undefined,
  resultText: string | null | undefined,
): boolean | null {
  if (spec.result_type === 'passfail') {
    // qualitative check captured as a Pass/Fail determination
    const v = (resultText ?? '').trim().toLowerCase();
    if (v === 'pass') return true;
    if (v === 'fail') return false;
    return null; // not yet assessed
  }

  if (spec.result_type === 'text') {
    const expected = (spec.expected_text ?? '').trim().toLowerCase();
    const actual = (resultText ?? '').trim().toLowerCase();
    if (!actual) return null;
    if (!expected) return null; // no expectation defined → informational only
    return actual === expected;
  }

  // numeric
  if (resultNumeric == null || Number.isNaN(resultNumeric)) return null;
  const hasLower = spec.lower_limit != null;
  const hasUpper = spec.upper_limit != null;
  if (!hasLower && !hasUpper) return null; // no limits → informational only
  if (hasLower && resultNumeric < (spec.lower_limit as number)) return false;
  if (hasUpper && resultNumeric > (spec.upper_limit as number)) return false;
  return true;
}

const fmt = (n: number): string => {
  // trim trailing zeros but keep meaningful precision
  return Number.parseFloat(n.toFixed(4)).toString();
};

/** Human-readable specification, e.g. "7.2 – 7.6 mOsm/kg", "≤ 0.5", "Clear, colorless". */
export function formatSpec(spec: QCSpec): string {
  const unit = spec.unit ? ` ${spec.unit}` : '';
  if (spec.result_type === 'passfail') {
    // the acceptance criteria text (if any) is the spec; the operator just checks Pass/Fail
    return spec.expected_text?.trim() || 'Pass / Fail';
  }
  if (spec.result_type === 'text') {
    return spec.expected_text?.trim() || '—';
  }
  const hasLower = spec.lower_limit != null;
  const hasUpper = spec.upper_limit != null;
  if (hasLower && hasUpper) return `${fmt(spec.lower_limit as number)} – ${fmt(spec.upper_limit as number)}${unit}`;
  if (hasUpper) return `≤ ${fmt(spec.upper_limit as number)}${unit}`;
  if (hasLower) return `≥ ${fmt(spec.lower_limit as number)}${unit}`;
  if (spec.target != null) return `${fmt(spec.target as number)}${unit} (target)`;
  return '—';
}

/** Display a captured result value with its unit. */
export function formatResultValue(
  result_type: QCResultType,
  resultNumeric: number | null | undefined,
  resultText: string | null | undefined,
  unit?: string | null,
): string {
  if (result_type === 'text' || result_type === 'passfail') return resultText?.trim() || '—';
  if (resultNumeric == null || Number.isNaN(resultNumeric)) return '—';
  return `${fmt(resultNumeric)}${unit ? ` ${unit}` : ''}`;
}

/** Common buffer-lab QC tests, offered as quick-add presets. */
export interface QCPreset {
  name: string;
  unit: string;
  result_type: QCResultType;
  lower_limit?: number;
  upper_limit?: number;
  expected_text?: string;
  method?: string;
}

export const QC_PRESETS: QCPreset[] = [
  { name: 'pH', unit: '', result_type: 'numeric', lower_limit: 7.2, upper_limit: 7.6, method: 'USP <791>' },
  { name: 'Osmolality', unit: 'mOsm/kg', result_type: 'numeric', lower_limit: 280, upper_limit: 300, method: 'Freezing-point depression' },
  { name: 'Conductivity', unit: 'mS/cm', result_type: 'numeric', lower_limit: 12, upper_limit: 16, method: 'USP <645>' },
  { name: 'Appearance / Color', unit: '', result_type: 'passfail', expected_text: 'Clear, colorless solution; free from visible particulates', method: 'Visual' },
  { name: 'Density', unit: 'g/mL', result_type: 'numeric', lower_limit: 1.000, upper_limit: 1.010, method: 'Densitometer' },
  { name: 'Specific Gravity', unit: '', result_type: 'numeric', lower_limit: 1.000, upper_limit: 1.010 },
  { name: 'Bioburden', unit: 'CFU/mL', result_type: 'numeric', upper_limit: 10, method: 'USP <61>' },
  { name: 'Endotoxin', unit: 'EU/mL', result_type: 'numeric', upper_limit: 0.5, method: 'USP <85> LAL' },
  { name: 'Fill Volume', unit: 'mL', result_type: 'numeric', lower_limit: 9.8, upper_limit: 10.2 },
  { name: 'Particulate Matter', unit: 'particles/mL', result_type: 'numeric', upper_limit: 25, method: 'USP <788>' },
];
