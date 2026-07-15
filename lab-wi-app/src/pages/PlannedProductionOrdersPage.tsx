import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Factory, ArrowLeft, CheckCircle, AlertTriangle, Lock, ChevronDown,
  ChevronRight, Hammer, Wand2, ExternalLink,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { cn } from '../lib/utils';
import { planWithAssignment, UNASSIGNED_KEY, type BusyInterval, type AssignableOrder } from '../lib/autoSchedule';
import ListFilters, { toOptions, inDateRange } from '../components/ListFilters';
import type { PlannedProductionOrder } from '../types';

/* -------------------------------------------------------------------------- */

interface ApprovedWI {
  id: string;
  version: number;
  reagent_item_id: string | null;
  scheduled_minutes: number | null;
}

interface FirmOutcome {
  firmed: number;
  scheduled: number;
  late: number;
  errors: string[];
}

/** Format a YYYY-MM-DD date without timezone drift. */
function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

/* -------------------------------------------------------------------------- */

export default function PlannedProductionOrdersPage() {
  const qc = useQueryClient();
  const { profile } = useAuth();

  const [tab, setTab] = useState<'unprocessed' | 'firmed'>('unprocessed');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [outcome, setOutcome] = useState<FirmOutcome | null>(null);
  const [filterItem, setFilterItem] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  // Uncommitted date edits per "rowId:field" (reverted if the user cancels).
  const [dateDrafts, setDateDrafts] = useState<Record<string, string>>({});

  /* ── Data ──────────────────────────────────────────────────────────────── */

  const { data: orders = [], isLoading } = useQuery<PlannedProductionOrder[]>({
    queryKey: ['planned-orders'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('planned_production_orders')
        .select('*, item:reagent_items(id, item_number, product_name, unit_of_measure)')
        .order('requirement_date', { ascending: true })
        .order('number', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as PlannedProductionOrder[];
    },
  });

  /* Approved WI per item — the "default formula" a firmed order is created
   * against. Ordered by version so the map keeps the latest approved one. */
  const { data: wiRows = [] } = useQuery<ApprovedWI[]>({
    queryKey: ['approved-wis-by-item'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('work_instructions')
        .select('id, version, reagent_item_id, scheduled_minutes')
        .eq('status', 'approved')
        .not('reagent_item_id', 'is', null)
        .order('version', { ascending: true });
      if (error) throw error;
      return (data ?? []) as ApprovedWI[];
    },
  });
  const wiByItem = useMemo(() => {
    const m = new Map<string, ApprovedWI>();
    for (const w of wiRows) if (w.reagent_item_id) m.set(w.reagent_item_id, w);
    return m;
  }, [wiRows]);

  /* Busy intervals + working patterns for Firm & Schedule (same inputs the
   * Unscheduled Orders auto-scheduler uses). */
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

  /* ── Filtering / tabs ──────────────────────────────────────────────────── */

  const counts = useMemo(() => ({
    unprocessed: orders.filter(o => o.status === 'unprocessed').length,
    firmed: orders.filter(o => o.status === 'firmed').length,
  }), [orders]);

  const itemOptions = useMemo(
    () => toOptions(orders.map(o => o.item?.product_name)),
    [orders]
  );
  const filtersActive = !!(filterItem || dateFrom || dateTo);

  const visibleOrders = useMemo(
    () => orders.filter(o =>
      o.status === tab &&
      (!filterItem || (o.item?.product_name ?? '') === filterItem) &&
      inDateRange(o.requirement_date, dateFrom, dateTo)
    ),
    [orders, tab, filterItem, dateFrom, dateTo]
  );
  const selectedVisible = useMemo(
    () => visibleOrders.filter(o => selected.has(o.id) && o.status === 'unprocessed'),
    [visibleOrders, selected]
  );

  /* ── Edit dates (requirement date is never editable) ───────────────────── */

  const updateMutation = useMutation({
    mutationFn: async (args: { id: string; patch: Partial<PlannedProductionOrder> }) => {
      const { error } = await supabase
        .from('planned_production_orders')
        .update(args.patch)
        .eq('id', args.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['planned-orders'] }),
  });

  function draftKey(id: string, field: string) { return `${id}:${field}`; }

  /** Commit an order/delivery date edit; warn when it slips past the
   *  requirement date — that delays the demand this supply covers. */
  function commitDate(o: PlannedProductionOrder, field: 'order_date' | 'delivery_date', value: string) {
    const key = draftKey(o.id, field);
    if (!value || value === (o[field] ?? '')) {
      setDateDrafts(prev => { const n = { ...prev }; delete n[key]; return n; });
      return;
    }
    if (value > o.requirement_date) {
      const label = field === 'order_date' ? 'order date' : 'delivery date';
      const ok = window.confirm(
        `${o.number}: moving the ${label} to ${fmtDate(value)} puts it after the requirement date ` +
        `(${fmtDate(o.requirement_date)}). This would delay the requirement — are you sure you want to continue?`
      );
      if (!ok) {
        setDateDrafts(prev => { const n = { ...prev }; delete n[key]; return n; });
        return;
      }
    }
    updateMutation.mutate({ id: o.id, patch: { [field]: value } });
    setDateDrafts(prev => { const n = { ...prev }; delete n[key]; return n; });
  }

  /* ── Firm / Firm & Schedule ────────────────────────────────────────────── */

  const firmMutation = useMutation({
    mutationFn: async (args: { rows: PlannedProductionOrder[]; schedule: boolean }): Promise<FirmOutcome> => {
      const errors: string[] = [];
      const created: { poId: string; durationMinutes: number; requiredBy: string; createdAt: string }[] = [];

      await Promise.all(args.rows.map(async row => {
        const wi = wiByItem.get(row.reagent_item_id);
        if (!wi) {
          errors.push(`${row.number}: no approved work instruction (default formula) for ${row.item?.item_number ?? 'item'}.`);
          return;
        }
        try {
          const { data: po, error: insErr } = await supabase
            .from('production_orders')
            .insert({
              work_instruction_id: wi.id,
              wi_version: wi.version,
              lot_number: `L${row.requirement_date.slice(2).replace(/-/g, '')}-${row.number.slice(-4)}`,
              batch_size: row.quantity,
              batch_size_unit: row.unit,
              notes: `Firmed from planned order ${row.number}`,
              status: 'pending',
              created_by: profile!.id,
              assigned_to: null,
              scheduled_start: null,
              scheduled_end: null,
              required_by: row.requirement_date,
            })
            .select('id, created_at')
            .single();
          if (insErr) throw insErr;

          const { error: updErr } = await supabase
            .from('planned_production_orders')
            .update({
              status: 'firmed',
              firmed_production_order_id: po.id,
              firmed_by: profile!.id,
              firmed_at: new Date().toISOString(),
            })
            .eq('id', row.id);
          if (updErr) throw updErr;

          created.push({
            poId: po.id,
            durationMinutes: wi.scheduled_minutes ?? 60,
            requiredBy: row.requirement_date,
            createdAt: po.created_at,
          });
        } catch (e: unknown) {
          errors.push(`${row.number}: ${e instanceof Error ? e.message : 'firming failed'}`);
        }
      }));

      let scheduled = 0;
      let late = 0;
      if (args.schedule && created.length > 0) {
        const assignable: AssignableOrder[] = created.map(c => ({
          id: c.poId,
          durationMinutes: c.durationMinutes,
          requiredBy: c.requiredBy,
          createdAt: c.createdAt,
          currentAssignee: null,
        }));
        const results = planWithAssignment(assignable, candidateIds, busyByResource, workingDays, { from: new Date() });
        await Promise.all(results.map(async a => {
          const { error } = await supabase
            .from('production_orders')
            .update({
              scheduled_start: a.start.toISOString(),
              scheduled_end: a.end.toISOString(),
              assigned_to: a.assigneeId,
            })
            .eq('id', a.id);
          if (error) throw error;
        }));
        scheduled = results.length;
        late = results.filter(r => r.late).length;
      }

      return { firmed: created.length, scheduled, late, errors };
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['planned-orders'] });
      qc.invalidateQueries({ queryKey: ['production-orders'] });
      qc.invalidateQueries({ queryKey: ['unscheduled-orders'] });
      qc.invalidateQueries({ queryKey: ['scheduled-busy'] });
      qc.invalidateQueries({ queryKey: ['gantt-orders'] });
      setSelected(new Set());
      setOutcome(res);
    },
  });

  function handleFirm(rows: PlannedProductionOrder[], schedule: boolean) {
    if (rows.length === 0 || firmMutation.isPending) return;
    if (rows.length > 1) {
      const ok = window.confirm(
        schedule
          ? `Firm ${rows.length} planned orders into production orders and auto-schedule each to an available person who can finish by its requirement date?`
          : `Firm ${rows.length} planned orders into production orders? They will appear in Unscheduled Orders for scheduling.`
      );
      if (!ok) return;
    }
    setOutcome(null);
    firmMutation.mutate({ rows, schedule });
  }

  /* ── Selection / expansion ─────────────────────────────────────────────── */

  function toggleSelect(id: string) {
    setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function toggleSelectAll() {
    setSelected(prev => {
      const firmable = visibleOrders.filter(o => o.status === 'unprocessed');
      const allSel = firmable.length > 0 && firmable.every(o => prev.has(o.id));
      return allSel ? new Set<string>() : new Set(firmable.map(o => o.id));
    });
  }
  function toggleExpand(id: string) {
    setExpanded(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  /* ── Render ────────────────────────────────────────────────────────────── */

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to="/" className="text-gray-400 hover:text-gray-700">
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Factory size={22} className="text-blue-600" />
            Planned Production Orders
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Planned supply from Master Planning (D365 planned production &amp; batch orders).
            Firm to create a production order against the item&apos;s default formula.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-gray-500">
            {isLoading ? 'Loading…' : `${visibleOrders.length} order${visibleOrders.length === 1 ? '' : 's'}`}
          </span>
          {selectedVisible.length > 0 && (
            <>
              <button
                onClick={() => handleFirm(selectedVisible, false)}
                disabled={firmMutation.isPending}
                title="Create a production order for each selected planned order (schedule later)"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                <Hammer size={15} />
                {firmMutation.isPending ? 'Firming…' : `Firm selected (${selectedVisible.length})`}
              </button>
              <button
                onClick={() => handleFirm(selectedVisible, true)}
                disabled={firmMutation.isPending}
                title="Firm each selected planned order and auto-schedule it to an available person who can finish by its requirement date"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
              >
                <Wand2 size={15} />
                {firmMutation.isPending ? 'Working…' : `Firm & Schedule (${selectedVisible.length})`}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Status tabs */}
      <div className="flex items-center gap-2">
        {(['unprocessed', 'firmed'] as const).map(s => (
          <button
            key={s}
            onClick={() => { setTab(s); setSelected(new Set()); }}
            className={cn(
              'px-3 py-1.5 rounded-full text-sm font-medium border transition-colors capitalize',
              tab === s
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            )}
          >
            {s}
            <span className={cn(
              'ml-1.5 px-1.5 py-0.5 rounded-full text-xs',
              tab === s ? 'bg-blue-500 text-blue-50' : 'bg-gray-100 text-gray-500'
            )}>
              {counts[s]}
            </span>
          </button>
        ))}
      </div>

      {/* Filters */}
      <ListFilters
        itemOptions={itemOptions}
        item={filterItem}
        onItem={setFilterItem}
        dateLabel="Requirement"
        dateFrom={dateFrom}
        dateTo={dateTo}
        onDateFrom={setDateFrom}
        onDateTo={setDateTo}
        active={filtersActive}
        onClear={() => { setFilterItem(''); setDateFrom(''); setDateTo(''); }}
      />

      {/* Firm result banner */}
      {outcome && (
        <div className={cn(
          'rounded-lg border px-4 py-2.5 text-sm',
          outcome.errors.length > 0 ? 'bg-amber-50 border-amber-200 text-amber-800'
                                    : 'bg-emerald-50 border-emerald-200 text-emerald-800'
        )}>
          <div className="flex items-center gap-2">
            {outcome.errors.length > 0 ? <AlertTriangle size={16} /> : <CheckCircle size={16} />}
            <span>
              Firmed {outcome.firmed} planned order{outcome.firmed === 1 ? '' : 's'} into production orders.
              {outcome.scheduled > 0 && ` ${outcome.scheduled} scheduled and assigned.`}
              {outcome.late > 0 && ` ${outcome.late} finish after their requirement date — review these.`}
              {outcome.firmed > 0 && outcome.scheduled === 0 && ' They are waiting in Unscheduled Orders.'}
            </span>
            <button onClick={() => setOutcome(null)} className="ml-auto text-xs underline opacity-70 hover:opacity-100">
              Dismiss
            </button>
          </div>
          {outcome.errors.length > 0 && (
            <ul className="mt-1.5 ml-6 list-disc space-y-0.5 text-xs">
              {outcome.errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && visibleOrders.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
          <CheckCircle size={28} className="text-emerald-500 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-900">
            {tab === 'unprocessed' ? 'No unprocessed planned orders' : 'No firmed planned orders'}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {filtersActive
              ? 'Try clearing the item or date filters.'
              : tab === 'unprocessed'
                ? 'New planned orders arrive from the Master Planning run.'
                : 'Firm a planned order to see it here.'}
          </p>
        </div>
      )}

      {/* Table */}
      {visibleOrders.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-gray-500 uppercase bg-gray-50">
                <tr className="border-b border-gray-100">
                  <th className="px-3 py-2 w-8">
                    {tab === 'unprocessed' && (
                      <input
                        type="checkbox"
                        checked={visibleOrders.length > 0 && visibleOrders.every(o => selected.has(o.id))}
                        onChange={toggleSelectAll}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                    )}
                  </th>
                  <th className="px-3 py-2 font-medium">Number</th>
                  <th className="px-4 py-2 font-medium">Item</th>
                  <th className="px-4 py-2 font-medium text-right">Quantity</th>
                  <th className="px-4 py-2 font-medium">Order date</th>
                  <th className="px-4 py-2 font-medium">Delivery date</th>
                  <th className="px-4 py-2 font-medium">
                    <span className="inline-flex items-center gap-1">
                      Requirement date <Lock size={11} className="text-gray-400" />
                    </span>
                  </th>
                  <th className="px-4 py-2 font-medium">Pegging</th>
                  <th className="px-4 py-2 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {visibleOrders.map(o => {
                  const isOpen = expanded.has(o.id);
                  const firmable = o.status === 'unprocessed';
                  const delaysReq =
                    o.order_date > o.requirement_date ||
                    (o.delivery_date != null && o.delivery_date > o.requirement_date);
                  const pegSummary = [...new Set((o.pegging ?? []).map(p => p.reference))].join(', ') || '—';
                  return (
                    <PlannedOrderRow
                      key={o.id}
                      order={o}
                      isOpen={isOpen}
                      firmable={firmable}
                      delaysReq={delaysReq}
                      pegSummary={pegSummary}
                      selected={selected.has(o.id)}
                      onToggleSelect={() => toggleSelect(o.id)}
                      onToggleExpand={() => toggleExpand(o.id)}
                      orderDraft={dateDrafts[draftKey(o.id, 'order_date')]}
                      deliveryDraft={dateDrafts[draftKey(o.id, 'delivery_date')]}
                      onDraft={(field, v) => setDateDrafts(prev => ({ ...prev, [draftKey(o.id, field)]: v }))}
                      onCommit={(field, v) => commitDate(o, field, v)}
                      onFirm={() => handleFirm([o], false)}
                      onFirmSchedule={() => handleFirm([o], true)}
                      firming={firmMutation.isPending}
                      hasFormula={wiByItem.has(o.reagent_item_id)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Row + expandable D365-style detail ─────────────────────────────────── */

interface RowProps {
  order: PlannedProductionOrder;
  isOpen: boolean;
  firmable: boolean;
  delaysReq: boolean;
  pegSummary: string;
  selected: boolean;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
  orderDraft?: string;
  deliveryDraft?: string;
  onDraft: (field: 'order_date' | 'delivery_date', v: string) => void;
  onCommit: (field: 'order_date' | 'delivery_date', v: string) => void;
  onFirm: () => void;
  onFirmSchedule: () => void;
  firming: boolean;
  hasFormula: boolean;
}

function PlannedOrderRow({
  order: o, isOpen, firmable, delaysReq, pegSummary, selected,
  onToggleSelect, onToggleExpand, orderDraft, deliveryDraft,
  onDraft, onCommit, onFirm, onFirmSchedule, firming, hasFormula,
}: RowProps) {
  const DATE_CLS =
    'border border-gray-300 rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-gray-50 disabled:text-gray-400';

  return (
    <>
      <tr className={cn(
        'border-b border-gray-50 hover:bg-gray-50/50',
        selected && 'bg-blue-50/50',
        isOpen && 'bg-gray-50/70'
      )}>
        <td className="px-3 py-3">
          {firmable && (
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggleSelect}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
          )}
        </td>
        <td className="px-3 py-3">
          <button
            onClick={onToggleExpand}
            className="inline-flex items-center gap-1 text-blue-600 hover:underline font-medium font-mono text-xs"
          >
            {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            {o.number}
          </button>
        </td>
        <td className="px-4 py-3">
          <p className="text-gray-900 truncate max-w-[16rem]">{o.item?.product_name ?? '—'}</p>
          <p className="text-xs text-gray-500 font-mono">{o.item?.item_number ?? ''}</p>
        </td>
        <td className="px-4 py-3 text-right text-gray-700 whitespace-nowrap">
          {o.quantity} <span className="text-xs text-gray-500">{o.unit}</span>
        </td>
        <td className="px-4 py-3">
          <input
            type="date"
            value={orderDraft ?? o.order_date}
            disabled={!firmable}
            onChange={e => onDraft('order_date', e.target.value)}
            onBlur={e => onCommit('order_date', e.target.value)}
            className={DATE_CLS}
          />
        </td>
        <td className="px-4 py-3">
          <input
            type="date"
            value={deliveryDraft ?? o.delivery_date ?? ''}
            disabled={!firmable}
            onChange={e => onDraft('delivery_date', e.target.value)}
            onBlur={e => onCommit('delivery_date', e.target.value)}
            className={DATE_CLS}
          />
        </td>
        <td className="px-4 py-3 whitespace-nowrap">
          <span className="font-medium text-gray-900">{fmtDate(o.requirement_date)}</span>
          {delaysReq && (
            <span
              className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-amber-100 text-amber-800"
              title="The order or delivery date is after the requirement date — the requirement will be met late"
            >
              <AlertTriangle size={11} /> delayed
            </span>
          )}
        </td>
        <td className="px-4 py-3 text-xs text-gray-500">{pegSummary}</td>
        <td className="px-4 py-3 text-right whitespace-nowrap">
          {firmable ? (
            <div className="inline-flex items-center gap-1.5">
              <button
                onClick={onFirm}
                disabled={firming || !hasFormula}
                title={hasFormula
                  ? 'Create a production order against the default formula (schedule later)'
                  : 'No approved work instruction (default formula) for this item'}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium border border-blue-600 text-blue-700 hover:bg-blue-50 disabled:opacity-40 transition-colors"
              >
                <Hammer size={13} /> Firm
              </button>
              <button
                onClick={onFirmSchedule}
                disabled={firming || !hasFormula}
                title={hasFormula
                  ? 'Firm and auto-schedule to an available person who can finish by the requirement date'
                  : 'No approved work instruction (default formula) for this item'}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 transition-colors"
              >
                <Wand2 size={13} /> Firm &amp; Schedule
              </button>
            </div>
          ) : o.firmed_production_order_id ? (
            <Link
              to={`/production-orders/${o.firmed_production_order_id}`}
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
            >
              View production order <ExternalLink size={12} />
            </Link>
          ) : (
            <span className="text-xs text-gray-400">Firmed</span>
          )}
        </td>
      </tr>

      {isOpen && (
        <tr className="border-b border-gray-100 bg-gray-50/60">
          <td colSpan={9} className="px-6 py-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* General — mirrors the D365 planned order header */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">General</p>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                  <Detail label="Number" value={o.number} mono />
                  <Detail label="Reference" value={o.reference} />
                  <Detail label="Item number" value={o.item?.item_number ?? '—'} mono />
                  <Detail label="Product name" value={o.item?.product_name ?? '—'} />
                  <Detail label="Requirement date" value={fmtDate(o.requirement_date)} locked />
                  <Detail label="Order date" value={fmtDate(o.order_date)} />
                  <Detail label="Delivery date" value={fmtDate(o.delivery_date)} />
                  <Detail label="Quantity" value={`${o.quantity} ${o.unit}`} />
                  <Detail label="Planning priority" value={o.planning_priority.toFixed(2)} />
                  <Detail label="Site / Warehouse" value={`${o.site} / ${o.warehouse}`} />
                  <Detail label="Plan" value={o.plan_name} />
                  <Detail label="BOM number" value={o.bom_number ?? '—'} mono />
                  <Detail label="Status" value={o.status === 'unprocessed' ? 'Unprocessed' : 'Firmed'} />
                  {o.firmed_at && <Detail label="Firmed" value={new Date(o.firmed_at).toLocaleString()} />}
                </dl>
              </div>

              {/* Pegging — the demand this supply covers */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Pegging</p>
                {(o.pegging ?? []).length === 0 ? (
                  <p className="text-xs text-gray-400">No pegging information.</p>
                ) : (
                  <table className="w-full text-xs border border-gray-200 rounded-lg overflow-hidden">
                    <thead className="bg-white text-left text-gray-500 uppercase text-[10px]">
                      <tr>
                        <th className="px-3 py-1.5 font-medium">Reference</th>
                        <th className="px-3 py-1.5 font-medium">Number</th>
                        <th className="px-3 py-1.5 font-medium">Requirement date</th>
                        <th className="px-3 py-1.5 font-medium text-right">Quantity</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white">
                      {o.pegging.map((p, i) => (
                        <tr key={i} className="border-t border-gray-100">
                          <td className="px-3 py-1.5 text-gray-800">{p.reference}</td>
                          <td className="px-3 py-1.5 font-mono text-gray-600">{p.number ?? '—'}</td>
                          <td className="px-3 py-1.5 text-gray-600">{fmtDate(p.requirement_date)}</td>
                          <td className="px-3 py-1.5 text-right text-gray-800">{p.quantity ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Detail({ label, value, mono, locked }: { label: string; value: string; mono?: boolean; locked?: boolean }) {
  return (
    <>
      <dt className="text-gray-400 flex items-center gap-1">
        {label}{locked && <Lock size={10} className="text-gray-300" />}
      </dt>
      <dd className={cn('text-gray-800', mono && 'font-mono')}>{value}</dd>
    </>
  );
}
