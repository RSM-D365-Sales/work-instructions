import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '../lib/utils';

export interface FilterOption { value: string; label: string }

/** Build a sorted, de-duplicated <option> list from raw string values. */
export function toOptions(values: (string | null | undefined)[]): FilterOption[] {
  const set = new Set<string>();
  for (const v of values) {
    const s = (v ?? '').trim();
    if (s) set.add(s);
  }
  return [...set].sort((a, b) => a.localeCompare(b)).map(v => ({ value: v, label: v }));
}

/** Inclusive date-range test. `value` may be a date or timestamp; `from`/`to`
 *  are YYYY-MM-DD (empty = unbounded). */
export function inDateRange(value: string | null | undefined, from: string, to: string): boolean {
  if (!from && !to) return true;
  if (!value) return false;
  const d = value.slice(0, 10);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

interface ListFiltersProps {
  labOptions?: FilterOption[];
  lab?: string;
  onLab?: (v: string) => void;

  itemOptions?: FilterOption[];
  item?: string;
  onItem?: (v: string) => void;

  /** Prefix for the date inputs, e.g. "Required", "Needed", "Updated". */
  dateLabel?: string;
  dateFrom?: string;
  dateTo?: string;
  onDateFrom?: (v: string) => void;
  onDateTo?: (v: string) => void;

  active?: boolean;
  onClear?: () => void;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">{label}</span>
      {children}
    </label>
  );
}

const SELECT_CLS =
  'border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[10rem]';
const DATE_CLS =
  'border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

/** Reusable filter bar: optional Lab / Item dropdowns and a date range. */
export default function ListFilters({
  labOptions, lab, onLab,
  itemOptions, item, onItem,
  dateLabel = 'Date', dateFrom, dateTo, onDateFrom, onDateTo,
  active, onClear,
}: ListFiltersProps) {
  return (
    <div className="flex items-end gap-3 flex-wrap">
      {labOptions && onLab && (
        <Field label="Lab">
          <select value={lab ?? ''} onChange={e => onLab(e.target.value)} className={SELECT_CLS}>
            <option value="">All labs</option>
            {labOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>
      )}

      {itemOptions && onItem && (
        <Field label="Item">
          <select value={item ?? ''} onChange={e => onItem(e.target.value)} className={SELECT_CLS}>
            <option value="">All items</option>
            {itemOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>
      )}

      {onDateFrom && (
        <Field label={`${dateLabel} from`}>
          <input type="date" value={dateFrom ?? ''} onChange={e => onDateFrom(e.target.value)} className={DATE_CLS} />
        </Field>
      )}
      {onDateTo && (
        <Field label={`${dateLabel} to`}>
          <input type="date" value={dateTo ?? ''} onChange={e => onDateTo(e.target.value)} className={DATE_CLS} />
        </Field>
      )}

      {onClear && (
        <button
          onClick={onClear}
          disabled={!active}
          className={cn(
            'flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors',
            active
              ? 'text-gray-600 border-gray-200 hover:bg-gray-50'
              : 'text-gray-300 border-gray-100 cursor-not-allowed'
          )}
        >
          <X size={13} /> Clear
        </button>
      )}
    </div>
  );
}
