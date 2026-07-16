import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CalendarDays, ArrowLeft, CalendarClock, Clock, UserMinus, UserX, CheckCircle, AlertTriangle,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { cn } from '../lib/utils';
import { planWithAssignment, UNASSIGNED_KEY, type BusyInterval, type AssignableOrder } from '../lib/autoSchedule';
import ProductionGantt from '../components/ProductionGantt';
import {
  useGanttOrders, deriveSpan, startOfDay, addDays, loadWindowDays,
  STATUS_DOT_CLASS, STATUS_LABEL, STATUS_LETTER,
  type GanttOrderRow,
} from '../lib/ganttData';

/* -------------------------------------------------------------------------- */

interface DayItem {
  order: GanttOrderRow;
  start: Date;
  end: Date;
}

interface PersonDay {
  personId: string;
  personName: string;
  personRole: string;
  items: DayItem[];
}

interface ReassignOutcome {
  mode: 'reassign' | 'unassign';
  person: string;
  moved: number;
  late: number;
  recipients: Record<string, number>;
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('');
}

/** Local YYYY-MM-DD (no UTC shift). */
function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* -------------------------------------------------------------------------- */

export default function ProductionSchedulePage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const isAdmin = profile?.role === 'admin';

  // Shared range state: the gantt toolbar (presets, Today, prev/next) drives
  // this, and the day-by-day breakdown below follows the same window. The
  // window size is remembered across sessions (last-used preset).
  const [windowDays, setWindowDays] = useState(() => loadWindowDays());
  const [anchor, setAnchor] = useState<Date>(() =>
    loadWindowDays() === 1 ? startOfDay(new Date()) : addDays(startOfDay(new Date()), -1));

  const rangeStart = useMemo(() => startOfDay(anchor), [anchor]);
  const rangeEnd   = useMemo(() => addDays(rangeStart, windowDays), [rangeStart, windowDays]);

  // Same query key as the gantt above → one fetch feeds both views.
  const { data: orders = [] } = useGanttOrders(rangeStart, rangeEnd, windowDays);

  /* ── Cover-an-absence state ────────────────────────────────────────────── */
  const [panelOpen, setPanelOpen] = useState(false);
  const [absentId, setAbsentId] = useState('');
  const [absFrom, setAbsFrom] = useState(() => ymd(new Date()));
  const [absTo, setAbsTo] = useState(() => ymd(new Date()));
  const [outcome, setOutcome] = useState<ReassignOutcome | null>(null);

  /* Busy intervals + working patterns — the same inputs the Unscheduled
   * Orders auto-scheduler uses (shared query keys → shared cache). */
  const { data: busyRows = [] } = useQuery({
    queryKey: ['scheduled-busy'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('production_orders')
        .select('id, assigned_to, scheduled_start, scheduled_end')
        .not('scheduled_start', 'is', null)
        .neq('status', 'cancelled');
      if (error) throw error;
      return (data ?? []) as { id: string; assigned_to: string | null; scheduled_start: string; scheduled_end: string | null }[];
    },
  });
  const busyByResource = useMemo(() => {
    const m = new Map<string, BusyInterval[]>();
    for (const r of busyRows) {
      if (!r.scheduled_start) continue;
      const start = new Date(r.scheduled_start).getTime();
      const end = r.scheduled_end ? new Date(r.scheduled_end).getTime() : start + 60 * 60_000;
      const key = r.assigned_to ?? UNASSIGNED_KEY;
      const arr = m.get(key);
      if (arr) arr.push({ start, end });
      else m.set(key, [{ start, end }]);
    }
    return m;
  }, [busyRows]);

  const { data: schedRows = [] } = useQuery({
    queryKey: ['user-work-schedules'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('id, full_name, role, work_schedule');
      if (error) throw error;
      return (data ?? []) as { id: string; full_name: string; role: string; work_schedule: string[] | null }[];
    },
  });
  const workingDays = useMemo(() => {
    const m = new Map<string, Set<number>>();
    for (const r of schedRows) {
      if (Array.isArray(r.work_schedule) && r.work_schedule.length === 7) {
        const set = new Set<number>();
        r.work_schedule.forEach((st, dow) => { if (st === 'work') set.add(dow); });
        m.set(r.id, set);
      }
    }
    return m;
  }, [schedRows]);
  const candidateIds = useMemo(
    () => schedRows
      .filter(r => r.role === 'operator' || (Array.isArray(r.work_schedule) && r.work_schedule.length === 7))
      .map(r => r.id),
    [schedRows]
  );
  const nameById = useMemo(
    () => new Map(schedRows.map(r => [r.id, r.full_name])),
    [schedRows]
  );
  const peopleOptions = useMemo(
    () => schedRows.filter(r => r.role !== 'lab').sort((a, b) => a.full_name.localeCompare(b.full_name)),
    [schedRows]
  );

  /* Preview: how many pending orders the absent person has in the range. */
  const { data: previewCount = 0 } = useQuery({
    queryKey: ['absence-preview', absentId, absFrom, absTo],
    enabled: panelOpen && !!absentId && !!absFrom && !!absTo,
    queryFn: async () => {
      const { count, error } = await supabase
        .from('production_orders')
        .select('id', { count: 'exact', head: true })
        .eq('assigned_to', absentId)
        .eq('status', 'pending')
        .gte('scheduled_start', new Date(absFrom + 'T00:00:00').toISOString())
        .lt('scheduled_start', addDays(new Date(absTo + 'T00:00:00'), 1).toISOString());
      if (error) throw error;
      return count ?? 0;
    },
  });

  /* Move every pending order the person is scheduled for in [from, to] to
   * other available people — never back to them — each into the earliest
   * slot whose owner can finish by the order's required date. */
  const reassignMutation = useMutation({
    mutationFn: async (args: { personId: string; from: string; to: string }): Promise<ReassignOutcome> => {
      const personName = nameById.get(args.personId) ?? 'this person';
      const { data: targets, error } = await supabase
        .from('production_orders')
        .select('id, required_by, created_at, work_instruction:work_instructions(scheduled_minutes)')
        .eq('assigned_to', args.personId)
        .eq('status', 'pending')
        .gte('scheduled_start', new Date(args.from + 'T00:00:00').toISOString())
        .lt('scheduled_start', addDays(new Date(args.to + 'T00:00:00'), 1).toISOString());
      if (error) throw error;

      const rows = (targets ?? []) as unknown as {
        id: string; required_by: string | null; created_at: string;
        work_instruction: { scheduled_minutes: number | null } | null;
      }[];
      if (rows.length === 0) return { mode: 'reassign' as const, person: personName, moved: 0, late: 0, recipients: {} };

      const pool = candidateIds.filter(id => id !== args.personId);
      if (pool.length === 0) throw new Error('No other available people to reassign to.');

      const assignable: AssignableOrder[] = rows.map(t => ({
        id: t.id,
        durationMinutes: t.work_instruction?.scheduled_minutes ?? 60,
        requiredBy: t.required_by,
        createdAt: t.created_at,
        currentAssignee: null,   // force a new person — the current one is out
      }));
      const fromMs = Math.max(Date.now(), new Date(args.from + 'T00:00:00').getTime());
      const results = planWithAssignment(assignable, pool, busyByResource, workingDays, { from: new Date(fromMs) });

      await Promise.all(results.map(async a => {
        const { error: updErr } = await supabase
          .from('production_orders')
          .update({
            assigned_to: a.assigneeId,
            scheduled_start: a.start.toISOString(),
            scheduled_end: a.end.toISOString(),
          })
          .eq('id', a.id);
        if (updErr) throw updErr;
      }));

      const recipients: Record<string, number> = {};
      for (const r of results) {
        const nm = nameById.get(r.assigneeId) ?? 'Unknown';
        recipients[nm] = (recipients[nm] ?? 0) + 1;
      }
      return { mode: 'reassign' as const, person: personName, moved: results.length, late: results.filter(r => r.late).length, recipients };
    },
    onSuccess: res => {
      qc.invalidateQueries({ queryKey: ['gantt-orders'] });
      qc.invalidateQueries({ queryKey: ['scheduled-busy'] });
      qc.invalidateQueries({ queryKey: ['production-orders'] });
      qc.invalidateQueries({ queryKey: ['unscheduled-orders'] });
      qc.invalidateQueries({ queryKey: ['absence-preview'] });
      setOutcome(res);
    },
  });

  /* Take the person off every pending order they're scheduled for in
   * [from, to]: clear assignee AND scheduled time, so the orders return to
   * the Unscheduled Orders queue for rescheduling later. */
  const unassignMutation = useMutation({
    mutationFn: async (args: { personId: string; from: string; to: string }): Promise<ReassignOutcome> => {
      const personName = nameById.get(args.personId) ?? 'this person';
      const { data, error } = await supabase
        .from('production_orders')
        .update({ assigned_to: null, scheduled_start: null, scheduled_end: null })
        .eq('assigned_to', args.personId)
        .eq('status', 'pending')
        .gte('scheduled_start', new Date(args.from + 'T00:00:00').toISOString())
        .lt('scheduled_start', addDays(new Date(args.to + 'T00:00:00'), 1).toISOString())
        .select('id');
      if (error) throw error;
      return { mode: 'unassign' as const, person: personName, moved: (data ?? []).length, late: 0, recipients: {} };
    },
    onSuccess: res => {
      qc.invalidateQueries({ queryKey: ['gantt-orders'] });
      qc.invalidateQueries({ queryKey: ['scheduled-busy'] });
      qc.invalidateQueries({ queryKey: ['production-orders'] });
      qc.invalidateQueries({ queryKey: ['unscheduled-orders'] });
      qc.invalidateQueries({ queryKey: ['absence-preview'] });
      setOutcome(res);
    },
  });

  const actionPending = reassignMutation.isPending || unassignMutation.isPending;

  function handleCoverAbsence() {
    if (!absentId || actionPending) return;
    const name = nameById.get(absentId) ?? 'this person';
    const ok = window.confirm(
      `Move all of ${name}'s pending orders scheduled ${absFrom === absTo ? `on ${absFrom}` : `from ${absFrom} to ${absTo}`} ` +
      `to other available people? ${name} will not receive any of them.`
    );
    if (!ok) return;
    setOutcome(null);
    reassignMutation.mutate({ personId: absentId, from: absFrom, to: absTo });
  }

  function handleUnassignAbsence() {
    if (!absentId || actionPending) return;
    const name = nameById.get(absentId) ?? 'this person';
    const ok = window.confirm(
      `Take ${name} off all pending orders scheduled ${absFrom === absTo ? `on ${absFrom}` : `from ${absFrom} to ${absTo}`}? ` +
      `The orders lose their assignee and scheduled time and return to the Unscheduled Orders queue.`
    );
    if (!ok) return;
    setOutcome(null);
    unassignMutation.mutate({ personId: absentId, from: absFrom, to: absTo });
  }

  function handleReassignDay(p: PersonDay, day: Date, pendingCount: number) {
    if (actionPending) return;
    const dayLabel = day.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
    const ok = window.confirm(
      `Move ${p.personName}'s ${pendingCount} pending order${pendingCount === 1 ? '' : 's'} on ${dayLabel} ` +
      `to other available people? ${p.personName} will not receive any of them.`
    );
    if (!ok) return;
    setOutcome(null);
    reassignMutation.mutate({ personId: p.personId, from: ymd(day), to: ymd(day) });
  }

  function handleUnassignDay(p: PersonDay, day: Date, pendingCount: number) {
    if (actionPending) return;
    const dayLabel = day.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
    const ok = window.confirm(
      `Take ${p.personName} off ${pendingCount === 1 ? 'the' : `all ${pendingCount}`} pending order${pendingCount === 1 ? '' : 's'} on ${dayLabel}? ` +
      `The orders lose their assignee and scheduled time and return to the Unscheduled Orders queue.`
    );
    if (!ok) return;
    setOutcome(null);
    unassignMutation.mutate({ personId: p.personId, from: ymd(day), to: ymd(day) });
  }

  /* Break the window down day by day: for each day, who is working on what,
   * in start-time order. Only orders with a real schedule (or an actual run)
   * appear — unscheduled orders live in the Unscheduled Orders queue. */
  const days = useMemo(() => {
    const out: { day: Date; people: PersonDay[]; total: number }[] = [];
    for (let i = 0; i < windowDays; i++) {
      const day = addDays(rangeStart, i);
      const dayEnd = addDays(day, 1);
      const byPerson = new Map<string, PersonDay>();

      for (const o of orders) {
        const span = deriveSpan(o);
        if (!span) continue;
        if (span.end <= day || span.start >= dayEnd) continue;

        const owner = o.assignee ?? o.creator;
        const key = owner?.id ?? 'unassigned';
        let entry = byPerson.get(key);
        if (!entry) {
          entry = {
            personId: key,
            personName: owner?.full_name ?? 'Unassigned',
            personRole: owner?.role ?? '',
            items: [],
          };
          byPerson.set(key, entry);
        }
        entry.items.push({ order: o, start: span.start, end: span.end });
      }

      const people = [...byPerson.values()].sort((a, b) => a.personName.localeCompare(b.personName));
      people.forEach(p => p.items.sort((a, b) => a.start.getTime() - b.start.getTime()));
      out.push({ day, people, total: people.reduce((n, p) => n + p.items.length, 0) });
    }
    return out;
  }, [orders, rangeStart, windowDays]);

  const today = startOfDay(new Date()).getTime();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to="/" className="text-gray-400 hover:text-gray-700">
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <CalendarDays size={22} className="text-blue-600" />
            Production Schedule
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {isAdmin ? 'Every technician’s scheduled work' : 'Your scheduled work'} — by day and by hour.
            Unscheduled orders are in{' '}
            <Link to="/unscheduled-orders" className="text-blue-600 hover:underline">Unscheduled Orders</Link>.
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={() => { setPanelOpen(v => !v); setOutcome(null); }}
            className={cn(
              'ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium border transition-colors',
              panelOpen
                ? 'bg-amber-600 text-white border-amber-600'
                : 'bg-white text-amber-700 border-amber-300 hover:bg-amber-50'
            )}
          >
            <UserMinus size={15} />
            Cover an absence
          </button>
        )}
      </div>

      {/* Cover-an-absence panel */}
      {isAdmin && panelOpen && (
        <div className="bg-white rounded-xl border border-amber-200 p-4">
          <p className="text-sm text-gray-600 mb-3">
            Someone called in sick? Pick who and when, then either <b>Reassign</b> — every <b>pending</b> order
            they&apos;re scheduled for moves to other available people (respecting work schedules and required-by
            dates) — or <b>Unassign</b> — the orders lose their assignee and time and return to Unscheduled
            Orders to plan later. In-progress runs are never touched.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Who&apos;s out</span>
              <select
                value={absentId}
                onChange={e => setAbsentId(e.target.value)}
                className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 min-w-[12rem]"
              >
                <option value="">Select a person…</option>
                {peopleOptions.map(p => (
                  <option key={p.id} value={p.id}>{p.full_name} ({p.role})</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Out from</span>
              <input
                type="date"
                value={absFrom}
                onChange={e => { setAbsFrom(e.target.value); if (e.target.value > absTo) setAbsTo(e.target.value); }}
                className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Through</span>
              <input
                type="date"
                value={absTo}
                min={absFrom}
                onChange={e => setAbsTo(e.target.value)}
                className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </label>
            <span className="text-sm text-gray-500 pb-2">
              {absentId
                ? `${previewCount} pending order${previewCount === 1 ? '' : 's'} scheduled`
                : 'Pick a person to see their workload'}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={handleUnassignAbsence}
                disabled={!absentId || previewCount === 0 || actionPending}
                title="Clear the assignee and scheduled time — the orders return to Unscheduled Orders for rescheduling"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border border-amber-300 text-amber-700 bg-white hover:bg-amber-50 disabled:opacity-40 transition-colors"
              >
                <UserX size={15} />
                {unassignMutation.isPending ? 'Unassigning…' : `Unassign ${previewCount || ''} order${previewCount === 1 ? '' : 's'}`}
              </button>
              <button
                onClick={handleCoverAbsence}
                disabled={!absentId || previewCount === 0 || actionPending}
                title="Move each order to another available person who can finish by its required date"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-40 transition-colors"
              >
                <UserMinus size={15} />
                {reassignMutation.isPending ? 'Reassigning…' : `Reassign ${previewCount || ''} order${previewCount === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reassignment result */}
      {outcome && (
        <div className={cn(
          'flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm',
          outcome.moved === 0 ? 'bg-gray-50 border-gray-200 text-gray-600'
            : outcome.late > 0 ? 'bg-amber-50 border-amber-200 text-amber-800'
            : 'bg-emerald-50 border-emerald-200 text-emerald-800'
        )}>
          {outcome.moved > 0 && outcome.late === 0 ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
          <span>
            {outcome.moved === 0
              ? `${outcome.person} has no pending scheduled orders in that range.`
              : outcome.mode === 'unassign'
                ? <>Unassigned {outcome.moved} order{outcome.moved === 1 ? '' : 's'} from {outcome.person} — waiting in{' '}
                    <Link to="/unscheduled-orders" className="underline font-medium">Unscheduled Orders</Link> for rescheduling.</>
                : `Moved ${outcome.moved} order${outcome.moved === 1 ? '' : 's'} off ${outcome.person}: ` +
                  Object.entries(outcome.recipients).map(([nm, n]) => `${nm} ×${n}`).join(', ') + '.'}
            {outcome.late > 0 && ` ${outcome.late} finish after their required date — review these.`}
          </span>
          <button onClick={() => setOutcome(null)} className="ml-auto text-xs underline opacity-70 hover:opacity-100">
            Dismiss
          </button>
        </div>
      )}

      {/* Timeline — its toolbar (1/3/7/14/30-day presets, Today, prev/next)
          drives the breakdown below too. */}
      <ProductionGantt
        windowDays={windowDays}
        anchor={anchor}
        onWindowDaysChange={d => {
          setWindowDays(d);
          if (d === 1) setAnchor(startOfDay(new Date()));
        }}
        onAnchorChange={setAnchor}
      />

      {/* Day-by-day assignments */}
      <div className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
          Assignments by day
        </h2>

        {days.map(({ day, people, total }) => {
          const isToday = day.getTime() === today;
          return (
            <div key={day.toISOString()} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className={cn(
                'px-4 py-2.5 border-b border-gray-100 flex items-center justify-between',
                isToday ? 'bg-blue-50' : 'bg-gray-50'
              )}>
                <p className={cn(
                  'text-sm font-semibold',
                  isToday ? 'text-blue-800' : 'text-gray-700'
                )}>
                  {day.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
                  {isToday && <span className="ml-2 text-xs font-medium text-blue-600">today</span>}
                </p>
                <span className="text-xs text-gray-400">
                  {total === 0 ? 'No scheduled work' : `${total} order${total === 1 ? '' : 's'} · ${people.length} ${people.length === 1 ? 'person' : 'people'}`}
                </span>
              </div>

              {people.length > 0 && (
                <div className="divide-y divide-gray-50">
                  {people.map(p => {
                    const pendingCount = p.items.filter(i => i.order.status === 'pending').length;
                    return (
                      <div key={p.personId} className="px-4 py-3 flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4">
                        <div className="flex items-center gap-2 sm:w-48 shrink-0">
                          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white text-xs font-semibold flex items-center justify-center shrink-0">
                            {initials(p.personName)}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">{p.personName}</p>
                            <p className="text-[11px] text-gray-500 capitalize">{p.personRole}</p>
                          </div>
                        </div>
                        <div className="flex-1 flex flex-wrap gap-1.5">
                          {p.items.map(({ order: o, start, end }) => (
                            <Link
                              key={o.id + start.toISOString()}
                              to={`/production-orders/${o.id}`}
                              title={`${o.lot_number} · ${o.work_instruction?.product_name ?? ''}\n${o.status.replace('_', ' ')}\n${start.toLocaleString()} → ${end.toLocaleString()}`}
                              className="inline-flex items-center gap-1.5 pl-2 pr-2.5 py-1 rounded-lg border border-gray-200 bg-gray-50/60 hover:bg-blue-50 hover:border-blue-200 transition-colors text-xs"
                            >
                              <span
                                aria-label={STATUS_LABEL[o.status]}
                                className={cn(
                                  'w-4 h-4 rounded-sm text-white text-[9px] font-extrabold flex items-center justify-center shrink-0',
                                  STATUS_DOT_CLASS[o.status]
                                )}
                              >
                                {STATUS_LETTER[o.status]}
                              </span>
                              <span className="inline-flex items-center gap-1 text-gray-500 whitespace-nowrap">
                                <Clock size={11} />
                                {fmtTime(start)}–{fmtTime(end)}
                              </span>
                              <span className="font-medium text-gray-800 whitespace-nowrap">{o.lot_number}</span>
                              <span className="text-gray-500 truncate max-w-[14rem]">
                                {o.work_instruction?.product_name ?? ''}
                              </span>
                            </Link>
                          ))}
                        </div>
                        {isAdmin && p.personId !== 'unassigned' && pendingCount > 0 && (
                          <div className="shrink-0 self-start flex items-center gap-1">
                            <button
                              onClick={() => handleReassignDay(p, day, pendingCount)}
                              disabled={actionPending}
                              title={`Move ${p.personName}'s ${pendingCount} pending order${pendingCount === 1 ? '' : 's'} this day to other available people`}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-amber-700 border border-amber-200 hover:bg-amber-50 disabled:opacity-40 transition-colors"
                            >
                              <UserMinus size={12} />
                              Reassign ({pendingCount})
                            </button>
                            <button
                              onClick={() => handleUnassignDay(p, day, pendingCount)}
                              disabled={actionPending}
                              title={`Take ${p.personName} off the ${pendingCount} pending order${pendingCount === 1 ? '' : 's'} this day — back to Unscheduled Orders`}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-gray-500 border border-gray-200 hover:bg-gray-50 hover:text-gray-700 disabled:opacity-40 transition-colors"
                            >
                              <UserX size={12} />
                              Unassign
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {days.every(d => d.total === 0) && (
          <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
            <CalendarClock size={28} className="text-gray-300 mx-auto mb-3" />
            <p className="text-sm font-medium text-gray-900">Nothing scheduled in this range</p>
            <p className="text-xs text-gray-500 mt-1">
              Schedule orders from the{' '}
              <Link to="/unscheduled-orders" className="text-blue-600 hover:underline">Unscheduled Orders</Link> queue,
              or firm &amp; schedule from{' '}
              <Link to="/planned-orders" className="text-blue-600 hover:underline">Planned Production Orders</Link>.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
