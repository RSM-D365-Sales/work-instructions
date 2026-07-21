// Recurrence expansion for standing (recurring) reagent orders.
//
// Everything here is pure and works on `yyyy-mm-dd` strings so the same
// function drives the live preview in the form and the rows actually written
// to the database — what the user sees before saving is exactly what is
// created.
//
// Dates are handled as local calendar days. We deliberately never touch
// toISOString(), which converts to UTC and can shift a date across a day
// boundary for users behind/ahead of GMT.

export type RecurrenceFrequency = 'weekly' | 'monthly';

export type RecurrenceEnd =
  | { mode: 'date'; date: string }     // run until this day (inclusive)
  | { mode: 'count'; count: number };  // run for this many deliveries

export interface RecurrencePattern {
  frequency: RecurrenceFrequency;
  /** "every N weeks" / "every N months". 1 = every week/month. */
  intervalCount: number;
  /** Weekly only. 0 = Sunday … 6 = Saturday. One order per selected day. */
  weekdays: number[];
  /** Monthly only. 1–31, clamped to the last day of shorter months. */
  dayOfMonth: number;
  /** First day the series may deliver on (inclusive). */
  startDate: string;
  end: RecurrenceEnd;
}

/** Hard ceiling on how many orders one series may create. Five years of weekly
 *  deliveries — high enough never to bite a real request, low enough that a
 *  fat-fingered end date can't insert thousands of rows. */
export const MAX_OCCURRENCES = 260;

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export const WEEKDAY_LONG = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
] as const;

export interface ExpandResult {
  dates: string[];
  /** True when generation stopped at MAX_OCCURRENCES rather than at the end
   *  rule — the caller should warn instead of silently truncating. */
  truncated: boolean;
}

/** Parse `yyyy-mm-dd` into a Date at local midnight. */
export function parseISODate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Format a Date as `yyyy-mm-dd` using its local calendar fields. */
export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function daysInMonth(year: number, monthIndex: number): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(year, monthIndex + 1, 0).getDate();
}

/**
 * Expand a pattern into the concrete delivery dates it produces.
 *
 * Candidates are generated in strictly ascending order, so both end rules can
 * terminate the loop as soon as they are satisfied.
 */
export function expandRecurrence(pattern: RecurrencePattern): ExpandResult {
  const { frequency, startDate, end } = pattern;
  const interval = Math.max(1, Math.floor(pattern.intervalCount || 1));

  if (!startDate) return { dates: [], truncated: false };
  if (end.mode === 'date' && !end.date) return { dates: [], truncated: false };
  if (end.mode === 'count' && !(end.count > 0)) return { dates: [], truncated: false };

  const start = parseISODate(startDate);
  const limitDate = end.mode === 'date' ? parseISODate(end.date) : null;
  const limitCount = end.mode === 'count'
    ? Math.min(Math.floor(end.count), MAX_OCCURRENCES + 1)
    : MAX_OCCURRENCES + 1;

  const dates: string[] = [];

  // Collect one candidate; returns false when the caller should stop.
  function offer(candidate: Date): boolean {
    if (limitDate && candidate > limitDate) return false;
    if (candidate >= start) {
      dates.push(toISODate(candidate));
      if (dates.length >= limitCount) return false;
      if (dates.length > MAX_OCCURRENCES) return false;
    }
    return true;
  }

  if (frequency === 'weekly') {
    const days = [...new Set(pattern.weekdays)]
      .filter(d => d >= 0 && d <= 6)
      .sort((a, b) => a - b);
    if (days.length === 0) return { dates: [], truncated: false };

    // Anchor on the Sunday of the week containing startDate, then step whole
    // interval-week blocks. Within a block the selected weekdays are ascending,
    // so the overall sequence stays ordered.
    let weekStart = addDays(start, -start.getDay());

    // A weekly series bounded only by a count still needs a stop condition;
    // MAX_OCCURRENCES + the count limit inside offer() provide it.
    for (let block = 0; ; block++) {
      let keepGoing = true;
      for (const wd of days) {
        if (!offer(addDays(weekStart, wd))) { keepGoing = false; break; }
      }
      if (!keepGoing) break;
      weekStart = addDays(weekStart, interval * 7);
      // Guard against a limitDate that can never be reached (shouldn't happen,
      // since offer() returns false past it, but keeps the loop provably finite).
      if (block > MAX_OCCURRENCES) break;
    }
  } else {
    const dom = Math.min(31, Math.max(1, Math.floor(pattern.dayOfMonth || 1)));
    const anchorYear = start.getFullYear();
    const anchorMonth = start.getMonth();

    for (let step = 0; ; step++) {
      const monthIndex = anchorMonth + step * interval;
      const year = anchorYear + Math.floor(monthIndex / 12);
      const month = ((monthIndex % 12) + 12) % 12;
      // "31st" in a 30-day month lands on the 30th rather than skipping.
      const day = Math.min(dom, daysInMonth(year, month));
      if (!offer(new Date(year, month, day))) break;
      if (step > MAX_OCCURRENCES) break;
    }
  }

  const truncated = dates.length > MAX_OCCURRENCES;
  return { dates: truncated ? dates.slice(0, MAX_OCCURRENCES) : dates, truncated };
}

/** Human-readable summary of the cadence, e.g. "Every 2 weeks on Mon, Wed". */
export function describePattern(pattern: {
  frequency: RecurrenceFrequency;
  intervalCount: number;
  weekdays?: number[] | null;
  dayOfMonth?: number | null;
}): string {
  const n = Math.max(1, Math.floor(pattern.intervalCount || 1));

  if (pattern.frequency === 'weekly') {
    const days = [...new Set(pattern.weekdays ?? [])].sort((a, b) => a - b);
    if (days.length === 0) return 'Weekly';
    const named = days.length === 1
      ? WEEKDAY_LONG[days[0]]
      : days.map(d => WEEKDAY_LABELS[d]).join(', ');
    return n === 1 ? `Every ${named}` : `Every ${n} weeks on ${named}`;
  }

  const dom = pattern.dayOfMonth ?? 1;
  return n === 1
    ? `Day ${ordinal(dom)} of every month`
    : `Day ${ordinal(dom)} of every ${n} months`;
}

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

/** Today as `yyyy-mm-dd` in the user's local timezone. */
export function todayISO(): string {
  return toISODate(new Date());
}

/** `yyyy-mm-dd` N months from today — used for form defaults. */
export function isoMonthsFromToday(months: number): string {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth() + months, now.getDate());
  return toISODate(target);
}
