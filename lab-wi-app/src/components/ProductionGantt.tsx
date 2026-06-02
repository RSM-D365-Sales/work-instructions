import { useMemo, useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Calendar, CalendarPlus, GripHorizontal } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { cn } from '../lib/utils';

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

interface GanttOrderRow {
  id: string;
  lot_number: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  batch_size: number | null;
  batch_size_unit: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  assigned_to: string | null;
  created_by: string;
  assignee: { id: string; full_name: string; role: string } | null;
  creator: { id: string; full_name: string; role: string } | null;
  work_instruction: { title: string; product_name: string; scheduled_minutes: number | null } | null;
}

interface GanttBar {
  order: GanttOrderRow;
  start: Date;
  end: Date;
}

interface GanttRow {
  ownerId: string;
  ownerName: string;
  ownerRole: string;
  bars: GanttBar[];
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

const DAY_MS = 24 * 60 * 60 * 1000;
const QUARTER_MS = 15 * 60 * 1000;

/** Snap a timestamp (ms) to the nearest 15 minutes. */
function snap15(ms: number): number {
  return Math.round(ms / QUARTER_MS) * QUARTER_MS;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function fmtDay(d: Date): string {
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function diffDays(a: Date, b: Date): number {
  return (a.getTime() - b.getTime()) / DAY_MS;
}

/** Pick start/end for a production order.
 *  Priority:
 *   1. scheduled_start / scheduled_end (the explicit "blocked time")
 *   2. started_at + WI.scheduled_minutes (or completed_at)
 *   3. created_at + 1 day fallback for pending orders
 */
function deriveSpan(order: GanttOrderRow): { start: Date; end: Date } {
  // 1) Explicit schedule wins.
  if (order.scheduled_start && order.scheduled_end) {
    return {
      start: new Date(order.scheduled_start),
      end:   new Date(order.scheduled_end),
    };
  }

  const rawStart = order.scheduled_start ?? order.started_at ?? order.created_at;
  const start = new Date(rawStart);
  let end: Date;
  if (order.completed_at) {
    end = new Date(order.completed_at);
  } else if (order.scheduled_end) {
    end = new Date(order.scheduled_end);
  } else if (order.work_instruction?.scheduled_minutes) {
    end = new Date(start.getTime() + order.work_instruction.scheduled_minutes * 60_000);
  } else if (order.status === 'in_progress') {
    // running bar — extend to "now" with a small forward buffer
    end = addDays(new Date(), 0.5);
  } else {
    // pending / future — show a default 1-day window
    end = addDays(start, 1);
  }
  // Guarantee a minimum visible width (4 hours)
  if (end.getTime() - start.getTime() < DAY_MS / 6) {
    end = new Date(start.getTime() + DAY_MS / 6);
  }
  return { start, end };
}

const STATUS_BAR_CLASS: Record<GanttOrderRow['status'], string> = {
  pending:     'bg-blue-500   hover:bg-blue-600   ring-blue-300',
  in_progress: 'bg-amber-500  hover:bg-amber-600  ring-amber-300',
  completed:   'bg-emerald-500 hover:bg-emerald-600 ring-emerald-300',
  failed:      'bg-rose-500   hover:bg-rose-600   ring-rose-300',
  cancelled:   'bg-gray-400   hover:bg-gray-500   ring-gray-300',
};

const STATUS_DOT_CLASS: Record<GanttOrderRow['status'], string> = {
  pending:     'bg-blue-500',
  in_progress: 'bg-amber-500',
  completed:   'bg-emerald-500',
  failed:      'bg-rose-500',
  cancelled:   'bg-gray-400',
};

/* -------------------------------------------------------------------------- */
/*  Component                                                                 */
/* -------------------------------------------------------------------------- */

const WINDOW_OPTIONS = [
  { label: '3 days',  days: 3  },
  { label: '7 days',  days: 7  },
  { label: '14 days', days: 14 },
  { label: '30 days', days: 30 },
];

export default function ProductionGantt() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  // Window anchor — start date of the visible range. Defaults to 1 day before today.
  const [windowDays, setWindowDays] = useState<number>(7);
  const [anchor, setAnchor] = useState<Date>(() => addDays(startOfDay(new Date()), -1));
  // Live drag preview ({orderId, dx px}) while an admin drags a bar.
  const [dragPreview, setDragPreview] = useState<{ orderId: string; dx: number } | null>(null);
  const suppressClick = useRef(false);

  const rangeStart = useMemo(() => startOfDay(anchor), [anchor]);
  const rangeEnd   = useMemo(() => addDays(rangeStart, windowDays), [rangeStart, windowDays]);

  /* ----- Data fetch ----- */
  const { data: orders, isLoading } = useQuery<GanttOrderRow[]>({
    queryKey: ['gantt-orders', profile?.id, profile?.role, rangeStart.toISOString(), rangeEnd.toISOString()],
    enabled: !!profile,
    queryFn: async () => {
      // Pull orders that could intersect the window. We over-fetch slightly
      // (created up to `windowDays` before the range) so long-running pending
      // orders still appear.
      const fetchFromIso = addDays(rangeStart, -Math.max(windowDays, 30)).toISOString();

      let q = supabase
        .from('production_orders')
        .select(
          'id, lot_number, status, batch_size, batch_size_unit, ' +
          'created_at, started_at, completed_at, scheduled_start, scheduled_end, ' +
          'assigned_to, created_by, ' +
          'assignee:profiles!production_orders_assigned_to_fkey(id, full_name, role), ' +
          'creator:profiles!production_orders_created_by_fkey(id, full_name, role), ' +
          'work_instruction:work_instructions(title, product_name, scheduled_minutes)'
        )
        .gte('created_at', fetchFromIso)
        .order('created_at', { ascending: false });

      // Non-admins: only their work (assigned to them OR created by them)
      if (profile && profile.role !== 'admin') {
        q = q.or(`assigned_to.eq.${profile.id},created_by.eq.${profile.id}`);
      }

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as GanttOrderRow[];
    },
  });

  /* ----- Filter to window + group by owner ----- */
  const rows: GanttRow[] = useMemo(() => {
    if (!orders) return [];
    const grouped = new Map<string, GanttRow>();

    for (const o of orders) {
      const span = deriveSpan(o);
      // Skip bars completely outside the window
      if (span.end < rangeStart || span.start > rangeEnd) continue;

      const owner = o.assignee ?? o.creator;
      const ownerId   = owner?.id        ?? 'unassigned';
      const ownerName = owner?.full_name ?? 'Unassigned';
      const ownerRole = owner?.role      ?? '';

      let row = grouped.get(ownerId);
      if (!row) {
        row = { ownerId, ownerName, ownerRole, bars: [] };
        grouped.set(ownerId, row);
      }
      row.bars.push({ order: o, start: span.start, end: span.end });
    }

    // Sort bars chronologically within each row, owners alphabetically
    const out = Array.from(grouped.values()).sort((a, b) =>
      a.ownerName.localeCompare(b.ownerName)
    );
    out.forEach(r => r.bars.sort((a, b) => a.start.getTime() - b.start.getTime()));
    return out;
  }, [orders, rangeStart, rangeEnd]);

  /* ----- Day cells ----- */
  const dayCells = useMemo(() => {
    const cells: Date[] = [];
    for (let i = 0; i < windowDays; i++) cells.push(addDays(rangeStart, i));
    return cells;
  }, [rangeStart, windowDays]);

  const totalSpanMs = rangeEnd.getTime() - rangeStart.getTime();
  const todayOffsetPct = (() => {
    const now = new Date();
    if (now < rangeStart || now > rangeEnd) return null;
    return ((now.getTime() - rangeStart.getTime()) / totalSpanMs) * 100;
  })();

  const isAdmin = profile?.role === 'admin';

  /* ----- Editing: reschedule (drag) + auto-schedule ----- */
  const rescheduleMutation = useMutation({
    mutationFn: async (a: { id: string; startIso: string; endIso: string }) => {
      const { error } = await supabase
        .from('production_orders')
        .update({ scheduled_start: a.startIso, scheduled_end: a.endIso })
        .eq('id', a.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gantt-orders'] });
      qc.invalidateQueries({ queryKey: ['production-orders'] });
      qc.invalidateQueries({ queryKey: ['unscheduled-orders'] });
    },
  });

  // Orders that have no explicit schedule yet (candidates for auto-schedule).
  const unscheduled = useMemo(
    () => (orders ?? []).filter(o => !o.scheduled_start && o.status !== 'completed' && o.status !== 'cancelled'),
    [orders]
  );

  const autoScheduleMutation = useMutation({
    mutationFn: async () => {
      // Start after the latest explicitly-scheduled end (or now), snapped to 15 min.
      let runningEnd = snap15(Date.now());
      for (const o of orders ?? []) {
        if (o.scheduled_end) runningEnd = Math.max(runningEnd, new Date(o.scheduled_end).getTime());
      }
      // Append each unscheduled order back-to-back, oldest first.
      const queue = [...unscheduled].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
      for (const o of queue) {
        const minutes = o.work_instruction?.scheduled_minutes ?? 60;
        const startMs = runningEnd;
        const endMs = startMs + minutes * 60_000;
        const { error } = await supabase
          .from('production_orders')
          .update({ scheduled_start: new Date(startMs).toISOString(), scheduled_end: new Date(endMs).toISOString() })
          .eq('id', o.id);
        if (error) throw error;
        runningEnd = endMs;
      }
      return queue.length;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gantt-orders'] });
      qc.invalidateQueries({ queryKey: ['production-orders'] });
      qc.invalidateQueries({ queryKey: ['unscheduled-orders'] });
    },
  });

  function canEditBar(o: GanttOrderRow): boolean {
    return isAdmin && (o.status === 'pending' || o.status === 'in_progress');
  }

  // Pointer-drag a bar horizontally to reschedule it (admins only).
  function onBarPointerDown(e: React.PointerEvent<HTMLDivElement>, bar: GanttBar) {
    if (!canEditBar(bar.order)) return;
    e.preventDefault();
    const lane = (e.currentTarget.offsetParent as HTMLElement | null);
    const laneWidth = lane?.getBoundingClientRect().width ?? 1;
    const startX = e.clientX;
    const originStart = bar.start.getTime();
    const originEnd = bar.end.getTime();
    let moved = false;

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (Math.abs(dx) > 3) moved = true;
      setDragPreview({ orderId: bar.order.id, dx });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDragPreview(null);
      if (!moved) return;
      suppressClick.current = true;            // swallow the click that follows a drag
      const dx = ev.clientX - startX;
      const deltaDays = (dx / laneWidth) * windowDays;
      const newStart = snap15(originStart + deltaDays * DAY_MS);
      const duration = originEnd - originStart;
      rescheduleMutation.mutate({
        id: bar.order.id,
        startIso: new Date(newStart).toISOString(),
        endIso: new Date(newStart + duration).toISOString(),
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function onBarClick(e: React.MouseEvent, orderId: string) {
    if (suppressClick.current) { suppressClick.current = false; e.preventDefault(); return; }
    navigate(`/production-orders/${orderId}`);
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      {/* Header / toolbar */}
      <div className="p-4 border-b border-gray-100 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Calendar size={18} className="text-blue-600" />
          <h2 className="font-semibold text-gray-900">
            Production Schedule
          </h2>
          <span className="text-xs text-gray-500">
            {isAdmin ? 'All technicians' : 'My work'}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* Auto-schedule (admin) */}
          {isAdmin && (
            <button
              onClick={() => autoScheduleMutation.mutate()}
              disabled={unscheduled.length === 0 || autoScheduleMutation.isPending}
              title="Schedule all unscheduled orders back-to-back, starting after the last scheduled order"
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                unscheduled.length === 0
                  ? 'bg-gray-50 text-gray-300 border border-gray-200 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              )}
            >
              <CalendarPlus size={14} />
              {autoScheduleMutation.isPending
                ? 'Scheduling…'
                : `Auto-schedule${unscheduled.length ? ` (${unscheduled.length})` : ''}`}
            </button>
          )}

          {/* Range nav */}
          <div className="flex items-center rounded-lg border border-gray-200 overflow-hidden">
            <button
              onClick={() => setAnchor(d => addDays(d, -windowDays))}
              className="px-2 py-1.5 text-gray-600 hover:bg-gray-50"
              aria-label="Previous range"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => setAnchor(addDays(startOfDay(new Date()), -1))}
              className="px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 border-x border-gray-200"
            >
              Today
            </button>
            <button
              onClick={() => setAnchor(d => addDays(d, windowDays))}
              className="px-2 py-1.5 text-gray-600 hover:bg-gray-50"
              aria-label="Next range"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          {/* Window size selector */}
          <div className="flex items-center rounded-lg border border-gray-200 overflow-hidden text-xs">
            {WINDOW_OPTIONS.map(opt => (
              <button
                key={opt.days}
                onClick={() => setWindowDays(opt.days)}
                className={cn(
                  'px-2.5 py-1.5 font-medium transition-colors',
                  windowDays === opt.days
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:bg-gray-50'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="px-4 py-2 border-b border-gray-100 flex flex-wrap items-center gap-3 text-xs text-gray-600">
        <LegendDot status="pending"     label="Pending" />
        <LegendDot status="in_progress" label="In progress" />
        <LegendDot status="completed"   label="Completed" />
        <LegendDot status="failed"      label="Failed" />
        <LegendDot status="cancelled"   label="Cancelled" />
        {isAdmin && (
          <span className="inline-flex items-center gap-1 text-gray-400">
            <GripHorizontal size={13} /> Drag a bar to reschedule
          </span>
        )}
        <span className="ml-auto text-gray-500">
          {fmtDay(rangeStart)} – {fmtDay(addDays(rangeEnd, -1))}
        </span>
      </div>

      {/* Body */}
      <div className="overflow-x-auto">
        <div className="min-w-[760px]">
          {/* Day header */}
          <div className="grid border-b border-gray-100 bg-gray-50/60"
               style={{ gridTemplateColumns: `220px repeat(${windowDays}, minmax(0,1fr))` }}>
            <div className="px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wide">
              {isAdmin ? 'Technician' : 'Owner'}
            </div>
            {dayCells.map((d, i) => {
              const isToday = startOfDay(new Date()).getTime() === d.getTime();
              return (
                <div
                  key={i}
                  className={cn(
                    'px-1 py-2 text-[11px] font-medium text-center border-l border-gray-100',
                    isToday ? 'text-blue-700 bg-blue-50/60' : 'text-gray-500'
                  )}
                >
                  {fmtDay(d)}
                </div>
              );
            })}
          </div>

          {/* Rows */}
          {isLoading && (
            <div className="px-4 py-8 text-sm text-gray-500 text-center">Loading schedule…</div>
          )}
          {!isLoading && rows.length === 0 && (
            <div className="px-4 py-10 text-sm text-gray-500 text-center">
              No production orders in this range.
            </div>
          )}
          {rows.map(row => (
            <div
              key={row.ownerId}
              className="grid border-b border-gray-50 last:border-b-0"
              style={{ gridTemplateColumns: `220px repeat(${windowDays}, minmax(0,1fr))` }}
            >
              {/* Owner label */}
              <div className="px-3 py-3 flex items-center gap-2 border-r border-gray-100">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white text-xs font-semibold flex items-center justify-center shrink-0">
                  {initials(row.ownerName)}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{row.ownerName}</p>
                  <p className="text-[11px] text-gray-500 capitalize">{row.ownerRole}</p>
                </div>
              </div>

              {/* Lane (spans all day columns) */}
              <div
                className="relative h-14"
                style={{ gridColumn: `2 / span ${windowDays}` }}
              >
                {/* Day grid lines */}
                <div
                  className="absolute inset-0 grid pointer-events-none"
                  style={{ gridTemplateColumns: `repeat(${windowDays}, minmax(0,1fr))` }}
                >
                  {dayCells.map((_, i) => (
                    <div key={i} className="border-l border-gray-100 first:border-l-0" />
                  ))}
                </div>

                {/* Today line */}
                {todayOffsetPct !== null && (
                  <div
                    className="absolute top-0 bottom-0 w-px bg-blue-500/60 pointer-events-none"
                    style={{ left: `${todayOffsetPct}%` }}
                  />
                )}

                {/* Bars */}
                {row.bars.map((bar, idx) => {
                  const clippedStart = bar.start < rangeStart ? rangeStart : bar.start;
                  const clippedEnd   = bar.end   > rangeEnd   ? rangeEnd   : bar.end;
                  const leftPct  = (diffDays(clippedStart, rangeStart) / windowDays) * 100;
                  const widthPct = Math.max(
                    1.5,
                    (diffDays(clippedEnd, clippedStart) / windowDays) * 100
                  );
                  const o = bar.order;
                  const editable = canEditBar(o);
                  const isDragging = dragPreview?.orderId === o.id;
                  const title =
                    `${o.lot_number} · ${o.work_instruction?.product_name ?? ''}\n` +
                    `${o.status.replace('_', ' ')}\n` +
                    `${bar.start.toLocaleString()} → ${bar.end.toLocaleString()}` +
                    (editable ? '\n(drag to reschedule)' : '');
                  const barClass = cn(
                    'absolute top-2 bottom-2 rounded-md px-2 flex items-center text-[11px] font-medium text-white shadow-sm ring-1 ring-inset overflow-hidden',
                    STATUS_BAR_CLASS[o.status],
                    editable ? 'cursor-grab active:cursor-grabbing touch-none' : 'cursor-pointer',
                    isDragging ? 'z-10 opacity-95 shadow-lg ring-2 ring-white' : 'transition-all'
                  );
                  const barStyle: React.CSSProperties = {
                    left: `${leftPct}%`,
                    width: `${widthPct}%`,
                    transform: isDragging ? `translateX(${dragPreview!.dx}px)` : undefined,
                  };
                  const label = (
                    <span className="truncate">
                      {o.lot_number}
                      {o.work_instruction?.product_name ? ` · ${o.work_instruction.product_name}` : ''}
                    </span>
                  );

                  if (editable) {
                    return (
                      <div
                        key={o.id + idx}
                        title={title}
                        onPointerDown={e => onBarPointerDown(e, bar)}
                        onClick={e => onBarClick(e, o.id)}
                        className={barClass}
                        style={barStyle}
                      >
                        {label}
                      </div>
                    );
                  }
                  return (
                    <Link
                      key={o.id + idx}
                      to={`/production-orders/${o.id}`}
                      title={title}
                      className={barClass}
                      style={barStyle}
                    >
                      {label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function LegendDot({ status, label }: { status: GanttOrderRow['status']; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('w-2.5 h-2.5 rounded-sm', STATUS_DOT_CLASS[status])} />
      {label}
    </span>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(p => p[0]?.toUpperCase() ?? '')
    .join('');
}
