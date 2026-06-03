/* Auto-scheduler for unscheduled production orders.
 *
 * Strategy: earliest-required-date first (then oldest first), packed into the
 * next free working-hours slot for each *resource* (the assignee — so a single
 * person is never double-booked). Orders never overlap an already-scheduled
 * order, nor each other. Unassigned orders share one serial timeline.
 *
 * Pure + side-effect free so it can be reasoned about and unit-tested; the page
 * feeds it the unscheduled orders plus the existing busy intervals and applies
 * the returned assignments. */

export const UNASSIGNED_KEY = '__unassigned__';

export interface SchedulableOrder {
  id: string;
  durationMinutes: number;
  /** assignee id, or UNASSIGNED_KEY */
  resourceKey: string;
  /** YYYY-MM-DD, or null (no requirement → scheduled last) */
  requiredBy: string | null;
  createdAt: string;
}

/** A busy window on a resource's timeline, in epoch milliseconds. */
export interface BusyInterval {
  start: number;
  end: number;
}

export interface ScheduleOptions {
  /** Earliest permissible start (e.g. now). */
  from: Date;
  /** Working-day open/close hours in local time (default 07:00–18:00). */
  workStartHour?: number;
  workEndHour?: number;
  /** Rounding granularity for start times, in minutes (default 15). */
  slotMinutes?: number;
  /** Per-resource set of weekdays (0=Sun..6=Sat) the resource works. A resource
   *  with no entry (or an empty set) is treated as available every day. Days a
   *  person is off / on PTO are skipped when packing their slots. */
  workingDays?: Map<string, Set<number>>;
}

export interface Assignment {
  id: string;
  start: Date;
  end: Date;
  /** True when the slot ends after the order's required_by date. */
  late: boolean;
}

const MIN_MS = 60_000;

function roundUpMs(ms: number, stepMs: number): number {
  return Math.ceil(ms / stepMs) * stepMs;
}

/** Open/close epoch-ms for the working window of the day containing `ms`. */
function workWindow(ms: number, startHour: number, endHour: number): { open: number; close: number } {
  const open = new Date(ms);
  open.setHours(startHour, 0, 0, 0);
  const close = new Date(ms);
  close.setHours(endHour, 0, 0, 0);
  return { open: open.getTime(), close: close.getTime() };
}

function nextDayOpen(ms: number, startHour: number): number {
  const d = new Date(ms);
  d.setDate(d.getDate() + 1);
  d.setHours(startHour, 0, 0, 0);
  return d.getTime();
}

/** End of the required_by day (orders are "on time" if they finish by then). */
function requiredByEndMs(requiredBy: string | null): number | null {
  if (!requiredBy) return null;
  const d = new Date(requiredBy + 'T23:59:59');
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

function byPriority(a: SchedulableOrder, b: SchedulableOrder): number {
  // Earliest required_by first; nulls (no deadline) last; then oldest created.
  const ra = a.requiredBy, rb = b.requiredBy;
  if (ra !== rb) {
    if (ra == null) return 1;
    if (rb == null) return -1;
    return ra < rb ? -1 : 1;
  }
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

/**
 * Compute a non-overlapping schedule. Returns one Assignment per order, in the
 * order they were placed (earliest-priority first).
 */
export function planSchedule(
  orders: SchedulableOrder[],
  busyByResource: Map<string, BusyInterval[]>,
  opts: ScheduleOptions,
): Assignment[] {
  const startHour = opts.workStartHour ?? 7;
  const endHour = opts.workEndHour ?? 18;
  const slotMs = (opts.slotMinutes ?? 15) * MIN_MS;
  const earliest = roundUpMs(opts.from.getTime(), slotMs);

  // Group orders by resource, each group already in priority order.
  const sorted = [...orders].sort(byPriority);
  const groups = new Map<string, SchedulableOrder[]>();
  for (const o of sorted) {
    const arr = groups.get(o.resourceKey);
    if (arr) arr.push(o);
    else groups.set(o.resourceKey, [o]);
  }

  const assignments: Assignment[] = [];

  for (const [resource, group] of groups) {
    // Working copy of this resource's busy windows, kept sorted by start.
    const busy: BusyInterval[] = [...(busyByResource.get(resource) ?? [])].sort((a, b) => a.start - b.start);
    // Weekdays this resource works (empty/absent = every day).
    const workDays = opts.workingDays?.get(resource);
    const hasWorkConstraint = !!workDays && workDays.size > 0;
    let cursor = earliest;

    for (const o of group) {
      const durMs = Math.max(o.durationMinutes, 1) * MIN_MS;

      // Find the first free, in-hours slot at or after the cursor.
      // Guard bounds the (otherwise impossible) runaway loop.
      for (let guard = 0; guard < 100_000; guard++) {
        // Skip whole days the resource is off / on PTO.
        if (hasWorkConstraint && !workDays!.has(new Date(cursor).getDay())) {
          cursor = nextDayOpen(cursor, startHour);
          continue;
        }

        const win = workWindow(cursor, startHour, endHour);
        if (cursor < win.open) cursor = win.open;

        // Not enough room before close → jump to next day's open, unless the
        // batch is longer than a whole working day (then place it as-is).
        if (cursor + durMs > win.close && cursor > win.open) {
          cursor = nextDayOpen(cursor, startHour);
          continue;
        }

        const slotStart = cursor;
        const slotEnd = cursor + durMs;
        const clash = busy.find(b => slotStart < b.end && slotEnd > b.start);
        if (clash) {
          cursor = Math.max(cursor, clash.end);
          continue;
        }

        // Place it.
        const reqEnd = requiredByEndMs(o.requiredBy);
        assignments.push({
          id: o.id,
          start: new Date(slotStart),
          end: new Date(slotEnd),
          late: reqEnd != null && slotEnd > reqEnd,
        });
        busy.push({ start: slotStart, end: slotEnd });
        busy.sort((a, b) => a.start - b.start);
        cursor = slotEnd;
        break;
      }
    }
  }

  return assignments;
}

/* ── Assignment-aware scheduling ─────────────────────────────────────────── */

export interface AssignableOrder {
  id: string;
  durationMinutes: number;
  requiredBy: string | null;
  createdAt: string;
  /** Current assignee — kept if they can still meet the deadline, else replaced. */
  currentAssignee: string | null;
}

export interface AssignResult {
  id: string;
  assigneeId: string;
  start: Date;
  end: Date;
  /** True when the slot ends after the order's required_by date. */
  late: boolean;
}

/** Earliest free, in-hours, working-day slot for one person that ends on or
 *  before `deadlineMs`. Returns null if no such slot exists before the deadline. */
function earliestSlot(
  busy: BusyInterval[],
  workDays: Set<number> | undefined,
  durMs: number,
  fromMs: number,
  deadlineMs: number,
  startHour: number,
  endHour: number,
): { start: number; end: number } | null {
  const hasWork = !!workDays && workDays.size > 0;
  let cursor = fromMs;
  for (let guard = 0; guard < 100_000; guard++) {
    if (cursor > deadlineMs) return null;
    if (hasWork && !workDays!.has(new Date(cursor).getDay())) {
      cursor = nextDayOpen(cursor, startHour);
      continue;
    }
    const win = workWindow(cursor, startHour, endHour);
    if (cursor < win.open) cursor = win.open;
    if (cursor + durMs > win.close) {
      cursor = nextDayOpen(cursor, startHour);
      continue;
    }
    const slotStart = cursor;
    const slotEnd = cursor + durMs;
    if (slotEnd > deadlineMs) return null;
    const clash = busy.find(b => slotStart < b.end && slotEnd > b.start);
    if (clash) { cursor = Math.max(cursor, clash.end); continue; }
    return { start: slotStart, end: slotEnd };
  }
  return null;
}

/**
 * Assign + schedule each order to a candidate person who works that day and can
 * finish by the order's required-by date. Keeps the current assignee when they
 * can still meet the deadline; otherwise reassigns to whoever can. If no one can
 * meet it, schedules the earliest possible slot and flags it `late`.
 */
export function planWithAssignment(
  orders: AssignableOrder[],
  candidateIds: string[],
  busyByResource: Map<string, BusyInterval[]>,
  workingDays: Map<string, Set<number>>,
  opts: ScheduleOptions,
): AssignResult[] {
  const startHour = opts.workStartHour ?? 7;
  const endHour = opts.workEndHour ?? 18;
  const slotMs = (opts.slotMinutes ?? 15) * MIN_MS;
  const fromMs = roundUpMs(opts.from.getTime(), slotMs);

  // Mutable busy copy per person (grows as we place orders this run).
  const busy = new Map<string, BusyInterval[]>();
  for (const [k, v] of busyByResource) busy.set(k, [...v].sort((a, b) => a.start - b.start));
  const busyOf = (id: string): BusyInterval[] => {
    let a = busy.get(id);
    if (!a) { a = []; busy.set(id, a); }
    return a;
  };

  // Earliest-deadline first (no-deadline last), then oldest created.
  const sorted = [...orders].sort((a, b) => {
    const ra = a.requiredBy, rb = b.requiredBy;
    if (ra !== rb) { if (ra == null) return 1; if (rb == null) return -1; return ra < rb ? -1 : 1; }
    return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
  });

  const out: AssignResult[] = [];

  for (const o of sorted) {
    const durMs = Math.max(o.durationMinutes, 1) * MIN_MS;
    const deadlineMs = requiredByEndMs(o.requiredBy) ?? Number.POSITIVE_INFINITY;

    // Eligible people: the candidate pool plus the current assignee (always).
    const pool = new Set(candidateIds);
    if (o.currentAssignee) pool.add(o.currentAssignee);

    let best: { personId: string; start: number; end: number } | null = null;

    // 1) Keep the current assignee if they can meet the deadline.
    if (o.currentAssignee) {
      const s = earliestSlot(busyOf(o.currentAssignee), workingDays.get(o.currentAssignee), durMs, fromMs, deadlineMs, startHour, endHour);
      if (s) best = { personId: o.currentAssignee, ...s };
    }
    // 2) Otherwise whoever can finish earliest before the deadline.
    if (!best) {
      for (const pid of pool) {
        const s = earliestSlot(busyOf(pid), workingDays.get(pid), durMs, fromMs, deadlineMs, startHour, endHour);
        if (s && (!best || s.end < best.end)) best = { personId: pid, ...s };
      }
    }
    let late = false;
    // 3) No one can meet it → earliest possible slot overall, flagged late.
    if (!best) {
      for (const pid of pool) {
        const s = earliestSlot(busyOf(pid), workingDays.get(pid), durMs, fromMs, Number.POSITIVE_INFINITY, startHour, endHour);
        if (s && (!best || s.end < best.end)) best = { personId: pid, ...s };
      }
      late = true;
    }

    if (best) {
      const arr = busyOf(best.personId);
      arr.push({ start: best.start, end: best.end });
      arr.sort((a, b) => a.start - b.start);
      out.push({ id: o.id, assigneeId: best.personId, start: new Date(best.start), end: new Date(best.end), late });
    }
  }

  return out;
}
