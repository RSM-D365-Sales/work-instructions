import { useMemo, useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Calendar, CalendarPlus, GripHorizontal } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { cn } from '../lib/utils';
import {
  useGanttOrders, useStepProgress, deriveSpan, startOfDay, addDays,
  loadWindowDays, saveWindowDays,
  STATUS_DOT_CLASS, STATUS_LABEL, STATUS_LETTER,
  type GanttOrderRow,
} from '../lib/ganttData';

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

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

const QUARTER_MS = 15 * 60 * 1000;

/** Snap a timestamp (ms) to the nearest 15 minutes. */
function snap15(ms: number): number {
  return Math.round(ms / QUARTER_MS) * QUARTER_MS;
}

function fmtDay(d: Date): string {
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** Compact hour label for the 1-day view, e.g. "7a", "12p", "5p". */
function fmtHour(d: Date): string {
  let h = d.getHours();
  const ap = h < 12 ? 'a' : 'p';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}${ap}`;
}

/** Visible hours in the 1-day view — the working window, so bars get room. */
const DAY_VIEW_START_HOUR = 5;   // 5:00 AM
const DAY_VIEW_END_HOUR   = 17;  // 5:00 PM

/** "Wed, Jul 22 · 7:00 AM – 9:15 AM" (two full datetimes when days differ). */
function fmtRange(start: Date, end: Date): string {
  const day  = (x: Date) => x.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const time = (x: Date) => x.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (start.toDateString() === end.toDateString()) {
    return `${day(start)} · ${time(start)} – ${time(end)}`;
  }
  return `${day(start)} ${time(start)} → ${day(end)} ${time(end)}`;
}

const STATUS_BAR_CLASS: Record<GanttOrderRow['status'], string> = {
  pending:     'bg-blue-500   hover:bg-blue-600   ring-blue-300',
  in_progress: 'bg-amber-500  hover:bg-amber-600  ring-amber-300',
  awaiting_qc: 'bg-violet-500 hover:bg-violet-600 ring-violet-300',
  completed:   'bg-emerald-500 hover:bg-emerald-600 ring-emerald-300',
  failed:      'bg-rose-500   hover:bg-rose-600   ring-rose-300',
  cancelled:   'bg-gray-400   hover:bg-gray-500   ring-gray-300',
};

/* -------------------------------------------------------------------------- */
/*  Component                                                                 */
/* -------------------------------------------------------------------------- */

// A person with no saved pattern is treated as working every day.
const DEFAULT_SCHED: string[] = ['work', 'work', 'work', 'work', 'work', 'work', 'work'];

const WINDOW_OPTIONS = [
  { label: '1 day',   days: 1  },
  { label: '3 days',  days: 3  },
  { label: '7 days',  days: 7  },
  { label: '14 days', days: 14 },
  { label: '30 days', days: 30 },
];

export interface ProductionGanttProps {
  /** Controlled range — the Production Schedule page drives these four so its
   *  day-by-day breakdown follows the same window. Omit all of them for the
   *  self-contained dashboard card. */
  windowDays?: number;
  anchor?: Date;
  onWindowDaysChange?: (days: number) => void;
  onAnchorChange?: (anchor: Date) => void;
}

export default function ProductionGantt(props: ProductionGanttProps = {}) {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  // Window anchor — start date of the visible range. Defaults to 1 day before
  // today (or today for the 1-day view). Either value may be controlled by a
  // parent page via props. The window size is remembered across sessions.
  const [ownWindowDays, setOwnWindowDays] = useState<number>(() => loadWindowDays());
  const [ownAnchor, setOwnAnchor] = useState<Date>(() =>
    ownWindowDays === 1 ? startOfDay(new Date()) : addDays(startOfDay(new Date()), -1));
  const windowDays = props.windowDays ?? ownWindowDays;
  const anchor = props.anchor ?? ownAnchor;
  const setWindowDays = (d: number) => {
    saveWindowDays(d);   // remember the last-used preset (dashboard + schedule page)
    if (props.onWindowDaysChange) props.onWindowDaysChange(d);
    else setOwnWindowDays(d);
  };
  const setAnchor = (a: Date) =>
    props.onAnchorChange ? props.onAnchorChange(a) : setOwnAnchor(a);
  // Live drag preview while an admin drags a bar: horizontal offset (dx) for the
  // reschedule preview + the bar's own owner, so we can tell when it's dragged
  // onto a *different* person's lane.
  const [dragPreview, setDragPreview] = useState<{ orderId: string; dx: number; sourceOwner: string } | null>(null);
  // The person's lane the pointer is currently over (drop-to-reassign target).
  const [dropTargetOwner, setDropTargetOwner] = useState<string | null>(null);
  const dropTargetOwnerRef = useRef<string | null>(null);   // authoritative value read on pointer-up
  // Hover card state — the bar under the pointer plus the cursor position.
  const [hover, setHover] = useState<{ bar: GanttBar; x: number; y: number } | null>(null);
  const suppressClick = useRef(false);

  const rangeStart = useMemo(() => startOfDay(anchor), [anchor]);
  const rangeEnd   = useMemo(() => addDays(rangeStart, windowDays), [rangeStart, windowDays]);

  // The 1-day view shows only the working window (5:00 AM – 5:00 PM) so the
  // intra-day schedule gets more room; multi-day views span whole days.
  const isDayView = windowDays === 1;
  const viewStart = useMemo(
    () => (isDayView ? new Date(rangeStart.getTime() + DAY_VIEW_START_HOUR * 3_600_000) : rangeStart),
    [isDayView, rangeStart]
  );
  const viewEnd = useMemo(
    () => (isDayView ? new Date(rangeStart.getTime() + DAY_VIEW_END_HOUR * 3_600_000) : rangeEnd),
    [isDayView, rangeStart, rangeEnd]
  );

  /* ----- Data fetch ----- */
  const { data: orders, isLoading } = useGanttOrders(rangeStart, rangeEnd, windowDays);
  // Steps completed vs. total, for the hover card on in-progress orders.
  const { data: stepProgress } = useStepProgress(orders);

  /* ----- Per-person working pattern (grey out off / PTO days) ----- */
  const { data: schedRows = [] } = useQuery({
    queryKey: ['gantt-work-schedules'],
    enabled: !!profile,
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('id, work_schedule');
      if (error) throw error;
      return (data ?? []) as { id: string; work_schedule: string[] | null }[];
    },
  });
  const schedMap = useMemo(() => {
    const m: Record<string, string[] | null> = {};
    for (const r of schedRows) m[r.id] = r.work_schedule;
    return m;
  }, [schedRows]);
  const schedFor = (ownerId: string): string[] => {
    const s = schedMap[ownerId];
    return Array.isArray(s) && s.length === 7 ? s : DEFAULT_SCHED;
  };

  /* ----- Filter to window + group by owner ----- */
  const rows: GanttRow[] = useMemo(() => {
    if (!orders) return [];
    const grouped = new Map<string, GanttRow>();

    for (const o of orders) {
      const span = deriveSpan(o);
      if (!span) continue;   // unscheduled — lives in the Unscheduled Orders queue
      // Skip bars completely outside the visible window
      if (span.end < viewStart || span.start > viewEnd) continue;

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
  }, [orders, viewStart, viewEnd]);

  /* ----- Axis cells ----- */
  // The 1-day view swaps the day columns for an hourly axis over the working
  // window (5a–5p); bars position by fraction of the visible range.
  const dayCells = useMemo(() => {
    const cells: Date[] = [];
    for (let i = 0; i < windowDays; i++) cells.push(addDays(rangeStart, i));
    return cells;
  }, [rangeStart, windowDays]);

  const hourCells = useMemo(() => {
    const cells: Date[] = [];
    for (let h = DAY_VIEW_START_HOUR; h < DAY_VIEW_END_HOUR; h++) {
      cells.push(new Date(rangeStart.getTime() + h * 3_600_000));
    }
    return cells;
  }, [rangeStart]);

  const axisCells   = isDayView ? hourCells : dayCells;
  const columnCount = isDayView ? DAY_VIEW_END_HOUR - DAY_VIEW_START_HOUR : windowDays;

  const totalSpanMs = viewEnd.getTime() - viewStart.getTime();
  const todayOffsetPct = (() => {
    const now = new Date();
    if (now < viewStart || now > viewEnd) return null;
    return ((now.getTime() - viewStart.getTime()) / totalSpanMs) * 100;
  })();

  const isAdmin = profile?.role === 'admin';

  /* ----- Editing: reschedule + reassign (drag) + auto-schedule ----- */
  // A horizontal drag reschedules (scheduled_start/end); a vertical drag onto a
  // different person's lane reassigns (assigned_to). A diagonal drag does both.
  // `assignedTo` undefined means "leave the owner unchanged"; null unassigns.
  const rescheduleMutation = useMutation({
    mutationFn: async (a: { id: string; startIso: string; endIso: string; assignedTo?: string | null }) => {
      const update: { scheduled_start: string; scheduled_end: string; assigned_to?: string | null } = {
        scheduled_start: a.startIso,
        scheduled_end: a.endIso,
      };
      if (a.assignedTo !== undefined) update.assigned_to = a.assignedTo;
      const { error } = await supabase
        .from('production_orders')
        .update(update)
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

  // Pointer-drag a bar to reschedule (horizontal) and/or reassign (drop onto a
  // different person's lane). Admins only.
  function onBarPointerDown(e: React.PointerEvent<HTMLDivElement>, bar: GanttBar) {
    if (!canEditBar(bar.order)) return;
    e.preventDefault();
    setHover(null);   // no hover card while dragging
    const lane = (e.currentTarget.offsetParent as HTMLElement | null);
    const laneWidth = lane?.getBoundingClientRect().width ?? 1;
    const startX = e.clientX;
    const startY = e.clientY;
    const originStart = bar.start.getTime();
    const originEnd = bar.end.getTime();
    const sourceOwner = (bar.order.assignee ?? bar.order.creator)?.id ?? 'unassigned';
    let moved = false;

    // Which person's lane is under the pointer right now (or null).
    const laneOwnerAt = (x: number, y: number): string | null => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      return el?.closest<HTMLElement>('[data-owner-id]')?.getAttribute('data-owner-id') ?? null;
    };

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
      setDragPreview({ orderId: bar.order.id, dx, sourceOwner });
      const target = laneOwnerAt(ev.clientX, ev.clientY);
      dropTargetOwnerRef.current = target;
      setDropTargetOwner(target);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const target = dropTargetOwnerRef.current;
      setDragPreview(null);
      setDropTargetOwner(null);
      dropTargetOwnerRef.current = null;
      if (!moved) return;
      suppressClick.current = true;            // swallow the click that follows a drag
      const dx = ev.clientX - startX;
      const deltaMs = (dx / laneWidth) * totalSpanMs;
      const newStart = snap15(originStart + deltaMs);
      const duration = originEnd - originStart;
      // Reassign only when dropped onto a *different* person's lane.
      const reassign = !!target && target !== sourceOwner;
      rescheduleMutation.mutate({
        id: bar.order.id,
        startIso: new Date(newStart).toISOString(),
        endIso: new Date(newStart + duration).toISOString(),
        assignedTo: reassign ? (target === 'unassigned' ? null : target) : undefined,
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
              onClick={() => setAnchor(addDays(anchor, -windowDays))}
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
              onClick={() => setAnchor(addDays(anchor, windowDays))}
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
                onClick={() => {
                  setWindowDays(opt.days);
                  // The 1-day view centres on today (the default anchor is
                  // today-1, which would otherwise show yesterday).
                  if (opt.days === 1) setAnchor(startOfDay(new Date()));
                }}
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

      {/* Legend — every status carries a letter (on the swatch AND on the bars)
          so colour-blind users can match by letter instead of hue. */}
      <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center gap-x-5 gap-y-2 text-[15px] text-gray-600">
        {(['pending', 'in_progress', 'awaiting_qc', 'completed', 'failed', 'cancelled'] as const).map(s => (
          <LegendKey key={s} status={s} />
        ))}
        <span className="inline-flex items-center gap-1.5 text-sm">
          <span className="w-5 h-5 rounded-sm bg-gray-200 border border-gray-300" /> Off
        </span>
        <span className="inline-flex items-center gap-1.5 text-sm">
          <span className="w-5 h-5 rounded-sm bg-emerald-100 border border-emerald-300" /> Time off
        </span>
        {isAdmin && (
          <span className="inline-flex items-center gap-1 text-xs text-gray-400">
            <GripHorizontal size={13} /> Drag a bar sideways to reschedule · up/down to reassign
          </span>
        )}
        <span className="ml-auto text-xs text-gray-500">
          {isDayView
            ? `${rangeStart.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })} · 5:00 AM – 5:00 PM`
            : `${fmtDay(rangeStart)} – ${fmtDay(addDays(rangeEnd, -1))}`}
        </span>
      </div>

      {/* Body */}
      <div className="overflow-x-auto">
        <div className={isDayView ? 'min-w-[1100px]' : 'min-w-[760px]'}>
          {/* Day / hour header */}
          <div className="grid border-b border-gray-100 bg-gray-50/60"
               style={{ gridTemplateColumns: `220px repeat(${columnCount}, minmax(0,1fr))` }}>
            <div className="px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wide">
              {isAdmin ? 'Technician' : 'Owner'}
            </div>
            {axisCells.map((c, i) => {
              const now = new Date();
              const isCurrent = isDayView
                ? startOfDay(now).getTime() === rangeStart.getTime() && now.getHours() === c.getHours()
                : startOfDay(now).getTime() === c.getTime();
              // 12 working-hour columns leave room to label every hour.
              const label = isDayView ? fmtHour(c) : fmtDay(c);
              return (
                <div
                  key={i}
                  className={cn(
                    'px-1 py-2 text-[11px] font-medium text-center border-l border-gray-100',
                    isCurrent ? 'text-blue-700 bg-blue-50/60' : 'text-gray-500'
                  )}
                >
                  {label}
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
          {rows.map(row => {
            // Highlight this lane when a bar from a *different* owner is being
            // dragged over it — the drop-to-reassign target.
            const isDropTarget = !!dragPreview && dropTargetOwner === row.ownerId && dragPreview.sourceOwner !== row.ownerId;
            return (
            <div
              key={row.ownerId}
              data-owner-id={row.ownerId}
              className={cn(
                'grid border-b border-gray-50 last:border-b-0 transition-colors',
                isDropTarget && 'bg-indigo-50 ring-1 ring-inset ring-indigo-300'
              )}
              style={{ gridTemplateColumns: `220px repeat(${columnCount}, minmax(0,1fr))` }}
            >
              {/* Owner label */}
              <div className="px-3 py-3 flex items-center gap-2 border-r border-gray-100">
                <div className={cn(
                  'w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white text-xs font-semibold flex items-center justify-center shrink-0',
                  isDropTarget && 'ring-2 ring-indigo-400 ring-offset-1'
                )}>
                  {initials(row.ownerName)}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{row.ownerName}</p>
                  {isDropTarget
                    ? <p className="text-[11px] font-medium text-indigo-600">Drop to reassign</p>
                    : <p className="text-[11px] text-gray-500 capitalize">{row.ownerRole}</p>}
                </div>
              </div>

              {/* Lane (spans all axis columns) */}
              <div
                className="relative h-14"
                style={{ gridColumn: `2 / span ${columnCount}` }}
              >
                {/* Off / time-off day shading for this person */}
                {!isDayView ? (
                  <div
                    className="absolute inset-0 grid pointer-events-none"
                    style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0,1fr))` }}
                  >
                    {dayCells.map((c, i) => {
                      const st = schedFor(row.ownerId)[c.getDay()];
                      return <div key={i} className={st === 'off' ? 'bg-gray-100/80' : st === 'pto' ? 'bg-emerald-50' : ''} />;
                    })}
                  </div>
                ) : schedFor(row.ownerId)[rangeStart.getDay()] !== 'work' ? (
                  <div className={cn(
                    'absolute inset-0 pointer-events-none',
                    schedFor(row.ownerId)[rangeStart.getDay()] === 'pto' ? 'bg-emerald-50' : 'bg-gray-100/80'
                  )} />
                ) : null}

                {/* Grid lines */}
                <div
                  className="absolute inset-0 grid pointer-events-none"
                  style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0,1fr))` }}
                >
                  {axisCells.map((_, i) => (
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
                  const clippedStart = bar.start < viewStart ? viewStart : bar.start;
                  const clippedEnd   = bar.end   > viewEnd   ? viewEnd   : bar.end;
                  const leftPct  = ((clippedStart.getTime() - viewStart.getTime()) / totalSpanMs) * 100;
                  const widthPct = Math.max(
                    1.5,
                    ((clippedEnd.getTime() - clippedStart.getTime()) / totalSpanMs) * 100
                  );
                  const o = bar.order;
                  const editable = canEditBar(o);
                  const isDragging = dragPreview?.orderId === o.id;
                  const barClass = cn(
                    'absolute top-2 bottom-2 rounded-md px-1.5 flex items-center text-[11px] font-medium text-white shadow-sm ring-1 ring-inset overflow-hidden',
                    STATUS_BAR_CLASS[o.status],
                    editable ? 'cursor-grab active:cursor-grabbing touch-none' : 'cursor-pointer',
                    isDragging ? 'z-10 opacity-95 shadow-lg ring-2 ring-white' : 'transition-all'
                  );
                  const barStyle: React.CSSProperties = {
                    left: `${leftPct}%`,
                    width: `${widthPct}%`,
                    transform: isDragging ? `translateX(${dragPreview!.dx}px)` : undefined,
                  };
                  const hoverHandlers = {
                    onMouseEnter: (e: React.MouseEvent) => setHover({ bar, x: e.clientX, y: e.clientY }),
                    onMouseMove:  (e: React.MouseEvent) => setHover({ bar, x: e.clientX, y: e.clientY }),
                    onMouseLeave: () => setHover(null),
                  };
                  const label = (
                    <>
                      {/* Status letter — the colour-blind-safe identifier, matching the legend */}
                      <span
                        aria-hidden
                        className="mr-1.5 w-4 h-4 rounded-sm bg-white/25 ring-1 ring-white/50 text-[10px] font-extrabold flex items-center justify-center shrink-0"
                      >
                        {STATUS_LETTER[o.status]}
                      </span>
                      <span className="truncate">
                        {o.lot_number}
                        {o.work_instruction?.product_name ? ` · ${o.work_instruction.product_name}` : ''}
                      </span>
                    </>
                  );

                  if (editable) {
                    return (
                      <div
                        key={o.id + idx}
                        {...hoverHandlers}
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
                      {...hoverHandlers}
                      to={`/production-orders/${o.id}`}
                      className={barClass}
                      style={barStyle}
                    >
                      {label}
                    </Link>
                  );
                })}
              </div>
            </div>
            );
          })}
        </div>
      </div>

      {/* Hover card — richer than a native tooltip; hidden while dragging */}
      {hover && !dragPreview && (() => {
        const o = hover.bar.order;
        const prog = o.status === 'in_progress' ? stepProgress?.get(o.id) : undefined;
        const pct = prog && prog.total > 0 ? Math.round((prog.completed / prog.total) * 100) : null;
        const mins = o.work_instruction?.scheduled_minutes;
        return (
          <div
            className="fixed z-50 pointer-events-none"
            style={{
              left: Math.min(hover.x + 14, window.innerWidth - 310),
              top:  Math.min(hover.y + 14, window.innerHeight - 240),
            }}
          >
            <div className="w-72 rounded-xl border border-gray-200 bg-white shadow-xl p-3.5 space-y-2.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-gray-900">{o.lot_number}</span>
                <span className={cn(
                  'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold text-white',
                  STATUS_DOT_CLASS[o.status]
                )}>
                  <span className="font-extrabold">{STATUS_LETTER[o.status]}</span>
                  {STATUS_LABEL[o.status]}
                </span>
              </div>
              <div>
                <p className="font-medium text-gray-800">{o.work_instruction?.product_name ?? '—'}</p>
                {o.work_instruction?.title && (
                  <p className="text-gray-500">{o.work_instruction.title}</p>
                )}
              </div>
              <div className="space-y-1 border-t border-gray-100 pt-2">
                <p className="flex justify-between gap-3">
                  <span className="text-gray-400 shrink-0">When</span>
                  <span className="text-gray-800 text-right">{fmtRange(hover.bar.start, hover.bar.end)}</span>
                </p>
                <p className="flex justify-between gap-3">
                  <span className="text-gray-400">Assigned to</span>
                  <span className={o.assignee ? 'text-gray-800' : 'text-gray-400 italic'}>
                    {o.assignee?.full_name ?? 'Unassigned'}
                  </span>
                </p>
                {o.batch_size != null && (
                  <p className="flex justify-between gap-3">
                    <span className="text-gray-400">Batch</span>
                    <span className="text-gray-800">{o.batch_size} {o.batch_size_unit ?? ''}</span>
                  </p>
                )}
                {mins != null && (
                  <p className="flex justify-between gap-3">
                    <span className="text-gray-400">Duration</span>
                    <span className="text-gray-800">{mins} min</span>
                  </p>
                )}
              </div>
              {prog && prog.total > 0 && (
                <div className="border-t border-gray-100 pt-2">
                  <p className="flex justify-between gap-3 mb-1">
                    <span className="text-gray-400">Steps</span>
                    <span className="font-semibold text-gray-800">
                      {prog.completed}/{prog.total} complete · {pct}%
                    </span>
                  </p>
                  <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                    <div className="h-full rounded-full bg-amber-500" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )}
              <p className="text-[10px] text-gray-400 border-t border-gray-100 pt-1.5">
                {canEditBar(o) ? 'Click to open · drag to reschedule' : 'Click to open'}
              </p>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/** Legend entry: a lettered swatch plus the label with the matching letter
 *  bolded — colour-blind users match bars to letters, not hues. */
function LegendKey({ status }: { status: GanttOrderRow['status'] }) {
  const letter = STATUS_LETTER[status];
  const label = STATUS_LABEL[status];
  const idx = label.indexOf(letter);
  return (
    <span className="inline-flex items-center gap-2">
      <span className={cn(
        'w-6 h-6 rounded-md text-white text-[13px] font-extrabold flex items-center justify-center shadow-sm',
        STATUS_DOT_CLASS[status]
      )}>
        {letter}
      </span>
      <span>
        {idx === -1 ? label : (
          <>
            {label.slice(0, idx)}
            <span className="font-extrabold text-gray-900">{label[idx]}</span>
            {label.slice(idx + 1)}
          </>
        )}
      </span>
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
