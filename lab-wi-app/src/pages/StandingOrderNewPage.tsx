import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { ReagentItem, Lab, Profile, StandingOrderFrequency, StandingOrderEndMode } from '../types';
import {
  expandRecurrence, describePattern, MAX_OCCURRENCES, WEEKDAY_LABELS,
  todayISO, isoMonthsFromToday, parseISODate,
} from '../lib/recurrence';
import { formatDate, cn } from '../lib/utils';
import {
  ArrowLeft, Save, AlertTriangle, Plus, Trash2, Repeat, CalendarDays, Loader2, CheckCircle,
} from 'lucide-react';

interface LineDraft {
  key: string;            // local UI key only
  reagentItemId: string;
  quantity: string;
}

function newLine(): LineDraft {
  return { key: Math.random().toString(36).slice(2), reagentItemId: '', quantity: '' };
}

/** Supabase rejects very large single inserts; keep batches modest. */
const ORDER_CHUNK = 100;
const ITEM_CHUNK = 500;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export default function StandingOrderNewPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { profile } = useAuth();

  const [lines, setLines] = useState<LineDraft[]>([newLine()]);
  // null means "the user hasn't picked yet", so the profile default applies.
  // Deriving this rather than syncing it in an effect avoids a cascading render
  // and keeps a deliberately cleared select cleared.
  const [labChoice, setLabChoice] = useState<string | null>(null);
  const [requesterChoice, setRequesterChoice] = useState<string | null>(null);
  const labId = labChoice ?? profile?.default_lab_id ?? '';
  const requesterId = requesterChoice ?? profile?.id ?? '';
  const [notes, setNotes] = useState('');
  const [highPriority, setHighPriority] = useState(false);

  // Recurrence pattern — defaults to "every Monday for the next 5 months",
  // the most common standing-order shape.
  const [frequency, setFrequency] = useState<StandingOrderFrequency>('weekly');
  const [intervalCount, setIntervalCount] = useState(1);
  const [weekdays, setWeekdays] = useState<number[]>([1]);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [startDate, setStartDate] = useState(todayISO());
  const [endMode, setEndMode] = useState<StandingOrderEndMode>('date');
  const [endDate, setEndDate] = useState(isoMonthsFromToday(5));
  const [occurrenceCount, setOccurrenceCount] = useState(12);

  const [error, setError] = useState('');
  const [progress, setProgress] = useState<null | { done: number; total: number }>(null);
  const [result, setResult] = useState<null | {
    id: string;
    number: string;
    orderCount: number;
    firstDate: string;
    lastDate: string;
  }>(null);

  const { data: reagents = [] } = useQuery<ReagentItem[]>({
    queryKey: ['reagent-items-active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reagent_items')
        .select('*')
        .eq('is_active', true)
        .order('product_name');
      if (error) throw error;
      return data as ReagentItem[];
    },
  });

  const { data: labs = [] } = useQuery<Lab[]>({
    queryKey: ['labs-active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('labs')
        .select('*')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data as Lab[];
    },
  });

  const { data: users = [] } = useQuery<Profile[]>({
    queryKey: ['profiles-all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email, role, created_at')
        .order('full_name');
      if (error) throw error;
      return data as Profile[];
    },
  });

  const reagentsById = useMemo(() => {
    const m = new Map<string, ReagentItem>();
    for (const r of reagents) m.set(r.id, r);
    return m;
  }, [reagents]);

  // Reagent orders are nearly always for Finished Goods, so list FG items first
  // (mirrors the one-off order form).
  const fgReagents = useMemo(() => reagents.filter(r => r.item_type === 'FG'), [reagents]);
  const otherReagents = useMemo(() => reagents.filter(r => r.item_type !== 'FG'), [reagents]);

  // Live expansion of the pattern — this is the exact set of dates that will be
  // written, so the preview can never disagree with what gets created.
  const schedule = useMemo(() => expandRecurrence({
    frequency,
    intervalCount,
    weekdays,
    dayOfMonth,
    startDate,
    end: endMode === 'date'
      ? { mode: 'date', date: endDate }
      : { mode: 'count', count: occurrenceCount },
  }), [frequency, intervalCount, weekdays, dayOfMonth, startDate, endMode, endDate, occurrenceCount]);

  const patternSummary = describePattern({ frequency, intervalCount, weekdays, dayOfMonth });
  const validLines = lines.filter(l => l.reagentItemId && parseFloat(l.quantity) > 0);
  const totalOrders = schedule.dates.length;
  const totalLines = totalOrders * validLines.length;

  function updateLine(key: string, patch: Partial<LineDraft>) {
    setLines(prev => prev.map(l => (l.key === key ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines(prev => [...prev, newLine()]);
  }
  function removeLine(key: string) {
    setLines(prev => (prev.length === 1 ? prev : prev.filter(l => l.key !== key)));
  }
  function toggleWeekday(d: number) {
    setWeekdays(prev => (prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort((a, b) => a - b)));
  }

  /** Roll back a partially-created series. reagent_order_items cascade from
   *  reagent_orders, and standing_order_items cascade from standing_orders,
   *  but the orders themselves only get their FK nulled — so delete them first. */
  async function rollback(standingOrderId: string) {
    await supabase.from('reagent_orders').delete().eq('standing_order_id', standingOrderId);
    await supabase.from('standing_orders').delete().eq('id', standingOrderId);
  }

  async function handleSubmit() {
    setError('');

    // ── Validate ────────────────────────────────────────────────────────────
    if (!labId) return setError('Please select a lab');
    if (!requesterId) return setError('Requester is required');
    if (!startDate) return setError('Please choose a start date');
    if (frequency === 'weekly' && weekdays.length === 0) {
      return setError('Select at least one weekday');
    }
    if (endMode === 'date' && !endDate) return setError('Please choose an end date');
    if (endMode === 'date' && parseISODate(endDate) < parseISODate(startDate)) {
      return setError('The end date must be on or after the start date');
    }
    if (endMode === 'count' && !(occurrenceCount > 0)) {
      return setError('Number of deliveries must be greater than 0');
    }

    let cleaned: { line_number: number; reagent_item_id: string; quantity: number; unit: string }[];
    try {
      cleaned = lines.map((l, idx) => {
        if (!l.reagentItemId) throw new Error(`Line ${idx + 1}: select a reagent product`);
        const qty = parseFloat(l.quantity);
        if (!l.quantity || isNaN(qty) || qty <= 0) {
          throw new Error(`Line ${idx + 1}: quantity must be greater than 0`);
        }
        const reagent = reagentsById.get(l.reagentItemId);
        return {
          line_number: idx + 1,
          reagent_item_id: l.reagentItemId,
          quantity: qty,
          unit: reagent?.unit_of_measure ?? 'ea',
        };
      });
    } catch (e) {
      return setError(e instanceof Error ? e.message : 'Invalid line items');
    }

    // One D365 line per item, same rule as the one-off order form.
    const seen = new Set<string>();
    for (const c of cleaned) {
      if (seen.has(c.reagent_item_id)) {
        return setError('Each reagent can only appear once. Combine the quantities.');
      }
      seen.add(c.reagent_item_id);
    }

    const dates = schedule.dates;
    if (dates.length === 0) {
      return setError('This pattern produces no delivery dates — check the start date and end rule.');
    }
    if (schedule.truncated) {
      return setError(
        `This pattern produces more than ${MAX_OCCURRENCES} deliveries. Shorten the date range or use a longer interval.`
      );
    }

    // ── Create ──────────────────────────────────────────────────────────────
    setProgress({ done: 0, total: dates.length });
    let standingOrderId = '';
    try {
      const { data: so, error: soErr } = await supabase
        .from('standing_orders')
        .insert({
          lab_id: labId,
          created_by: profile!.id,
          requested_by: requesterId,
          frequency,
          interval_count: intervalCount,
          weekdays: frequency === 'weekly' ? weekdays : null,
          day_of_month: frequency === 'monthly' ? dayOfMonth : null,
          start_date: startDate,
          end_mode: endMode,
          end_date: endMode === 'date' ? endDate : null,
          occurrence_count: endMode === 'count' ? occurrenceCount : null,
          notes: notes.trim() || null,
          high_priority: highPriority,
          status: 'active',
          generated_count: 0,
          first_order_date: dates[0],
          last_order_date: dates[dates.length - 1],
        })
        .select('id, standing_order_number')
        .single();
      if (soErr || !so) throw new Error(soErr?.message || 'Could not create the standing order');
      standingOrderId = so.id;

      // Template lines (what the series will reorder each time).
      const { error: tmplErr } = await supabase
        .from('standing_order_items')
        .insert(cleaned.map(c => ({ standing_order_id: so.id, ...c })));
      if (tmplErr) throw new Error(tmplErr.message || 'Could not save the template lines');

      // Every order in the series, created up front.
      const created: { id: string; seq: number }[] = [];
      for (const batch of chunk(dates.map((d, i) => ({ d, i })), ORDER_CHUNK)) {
        const { data: rows, error: ordErr } = await supabase
          .from('reagent_orders')
          .insert(batch.map(({ d, i }) => ({
            lab_id: labId,
            requested_for_date: d,
            notes: notes.trim() || null,
            high_priority: highPriority,
            insufficient_stock: false,
            created_by: profile!.id,
            requested_by: requesterId,
            status: 'pending',
            standing_order_id: so.id,
            standing_order_seq: i + 1,
          })))
          .select('id, standing_order_seq');
        if (ordErr || !rows) throw new Error(ordErr?.message || 'Could not create the reagent orders');
        created.push(...rows.map(r => ({ id: r.id as string, seq: r.standing_order_seq as number })));
        setProgress({ done: created.length, total: dates.length });
      }

      // Copy the template lines onto each generated order.
      const itemRows = created.flatMap(o =>
        cleaned.map(c => ({ order_id: o.id, ...c }))
      );
      for (const batch of chunk(itemRows, ITEM_CHUNK)) {
        const { error: itemsErr } = await supabase.from('reagent_order_items').insert(batch);
        if (itemsErr) throw new Error(itemsErr.message || 'Could not create the order line items');
      }

      await supabase
        .from('standing_orders')
        .update({ generated_count: created.length })
        .eq('id', so.id);

      qc.invalidateQueries({ queryKey: ['reagent-orders'] });
      qc.invalidateQueries({ queryKey: ['standing-orders'] });

      setResult({
        id: so.id,
        number: so.standing_order_number,
        orderCount: created.length,
        firstDate: dates[0],
        lastDate: dates[dates.length - 1],
      });
    } catch (e) {
      if (standingOrderId) await rollback(standingOrderId).catch(() => { /* best effort */ });
      setError(e instanceof Error ? e.message : 'Failed to create the standing order');
    } finally {
      setProgress(null);
    }
  }

  // ── Success view ──────────────────────────────────────────────────────────
  if (result) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg p-3">
            <CheckCircle size={16} />
            Standing order <span className="font-mono font-semibold">{result.number}</span> created.
          </div>
          <p className="text-sm text-gray-700">
            <span className="font-semibold">{result.orderCount}</span> reagent order
            {result.orderCount === 1 ? '' : 's'} {result.orderCount === 1 ? 'was' : 'were'} raised,
            running from <span className="font-medium">{formatDate(result.firstDate)}</span> to{' '}
            <span className="font-medium">{formatDate(result.lastDate)}</span>. They behave exactly like
            manually placed orders and appear on the Reagent Orders list.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => navigate(`/standing-orders/${result.id}`)}
              className="flex-1 bg-gray-900 text-white py-2 rounded-lg text-sm font-medium hover:bg-gray-800"
            >
              View Standing Order
            </button>
            <button
              onClick={() => navigate('/reagent-orders')}
              className="flex-1 border border-gray-300 text-gray-700 py-2 rounded-lg text-sm font-medium hover:bg-gray-50"
            >
              View All Orders
            </button>
          </div>
        </div>
      </div>
    );
  }

  const busy = progress !== null;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/standing-orders')} className="text-gray-400 hover:text-gray-700">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-xl font-bold text-gray-900">New Standing Order</h1>
          <p className="text-sm text-gray-500">Set up a repeating reagent request on a fixed schedule</p>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        {/* Line items */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-gray-700">Reagent Items *</label>
            <button
              type="button"
              onClick={addLine}
              className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
            >
              <Plus size={14} /> Add item
            </button>
          </div>
          <div className="space-y-2">
            {lines.map((line, idx) => {
              const r = reagentsById.get(line.reagentItemId);
              return (
                <div key={line.key} className="flex items-start gap-2">
                  <div className="flex-1">
                    <select
                      value={line.reagentItemId}
                      onChange={e => updateLine(line.key, { reagentItemId: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Select a reagent…</option>
                      {fgReagents.length > 0 && (
                        <optgroup label="Finished Goods">
                          {fgReagents.map(rg => (
                            <option key={rg.id} value={rg.id}>
                              {rg.item_number} — {rg.product_name} ({rg.unit_of_measure})
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {otherReagents.length > 0 && (
                        <optgroup label="Other items">
                          {otherReagents.map(rg => (
                            <option key={rg.id} value={rg.id}>
                              {rg.item_number} — {rg.product_name} ({rg.unit_of_measure})
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  </div>
                  <div className="w-40">
                    <div className="flex">
                      <input
                        type="number"
                        step="any"
                        min="0"
                        value={line.quantity}
                        onChange={e => updateLine(line.key, { quantity: e.target.value })}
                        className="flex-1 w-0 border border-gray-300 rounded-l-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Qty"
                      />
                      <span className="inline-flex items-center px-2 bg-gray-50 border border-l-0 border-gray-300 rounded-r-lg text-xs text-gray-600">
                        {r?.unit_of_measure ?? 'unit'}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeLine(line.key)}
                    disabled={lines.length === 1}
                    title={lines.length === 1 ? 'At least one line is required' : `Remove line ${idx + 1}`}
                    className="mt-1.5 text-gray-400 hover:text-red-600 disabled:opacity-30 disabled:hover:text-gray-400"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-gray-500 mt-2">
            These quantities are reordered in full on every delivery date.
          </p>
        </div>

        {/* Lab */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Ordering Lab *</label>
          <select
            value={labId}
            onChange={e => setLabChoice(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select a lab…</option>
            {labs.map(l => (
              <option key={l.id} value={l.id}>
                {l.name} ({l.warehouse_id})
              </option>
            ))}
          </select>
        </div>

        {/* Creator + Requester */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Created By</label>
            <input
              value={profile?.full_name ?? ''}
              disabled
              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-600"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Requester (on behalf of) *</label>
            <select
              value={requesterId}
              onChange={e => setRequesterChoice(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {users.map(u => (
                <option key={u.id} value={u.id}>
                  {u.full_name}{u.email ? ` — ${u.email}` : ''} ({u.role})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* ── Recurrence ─────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Repeat size={18} className="text-blue-600" />
          <h2 className="text-sm font-semibold text-gray-900">Repeats</h2>
        </div>

        {/* Frequency */}
        <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
          {(['weekly', 'monthly'] as const).map((f, i) => (
            <button
              key={f}
              type="button"
              onClick={() => setFrequency(f)}
              className={cn(
                'px-4 py-1.5 text-xs font-medium transition-colors',
                i > 0 && 'border-l border-gray-200',
                frequency === f ? 'bg-blue-50 text-blue-700' : 'bg-white text-gray-600 hover:bg-gray-50'
              )}
            >
              {f === 'weekly' ? 'Weekly' : 'Monthly'}
            </button>
          ))}
        </div>

        {/* Interval */}
        <div className="flex items-center gap-2 text-sm text-gray-700">
          <span>Every</span>
          <input
            type="number"
            min={1}
            max={12}
            value={intervalCount}
            onChange={e => setIntervalCount(Math.min(12, Math.max(1, parseInt(e.target.value) || 1)))}
            className="w-16 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span>{frequency === 'weekly' ? (intervalCount === 1 ? 'week' : 'weeks') : (intervalCount === 1 ? 'month' : 'months')}</span>
        </div>

        {/* Weekly: day picker */}
        {frequency === 'weekly' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">On these days *</label>
            <div className="flex gap-1.5 flex-wrap">
              {WEEKDAY_LABELS.map((label, d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleWeekday(d)}
                  className={cn(
                    'w-12 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                    weekdays.includes(d)
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-1.5">
              One order is raised per selected day, per cycle.
            </p>
          </div>
        )}

        {/* Monthly: day-of-month */}
        {frequency === 'monthly' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Day of the month *</label>
            <input
              type="number"
              min={1}
              max={31}
              value={dayOfMonth}
              onChange={e => setDayOfMonth(Math.min(31, Math.max(1, parseInt(e.target.value) || 1)))}
              className="w-24 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              Months without this day use their last day — e.g. 31 becomes 28 or 29 in February.
            </p>
          </div>
        )}

        {/* Start */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Starting *</label>
          <input
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* End rule */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Ends *</label>
          <div className="space-y-2">
            <label className={cn(
              'flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors',
              endMode === 'date' ? 'border-blue-300 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
            )}>
              <input
                type="radio"
                checked={endMode === 'date'}
                onChange={() => setEndMode('date')}
                className="h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700 shrink-0">On</span>
              <input
                type="date"
                value={endDate}
                min={startDate}
                onChange={e => { setEndDate(e.target.value); setEndMode('date'); }}
                className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>

            <label className={cn(
              'flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors',
              endMode === 'count' ? 'border-blue-300 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
            )}>
              <input
                type="radio"
                checked={endMode === 'count'}
                onChange={() => setEndMode('count')}
                className="h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700 shrink-0">After</span>
              <input
                type="number"
                min={1}
                max={MAX_OCCURRENCES}
                value={occurrenceCount}
                onChange={e => {
                  setOccurrenceCount(Math.max(1, parseInt(e.target.value) || 1));
                  setEndMode('count');
                }}
                className="w-24 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">deliveries</span>
            </label>
          </div>
          <p className="text-xs text-gray-500 mt-1.5">
            A standing order must have an end — every order in the series is raised as soon as you save.
          </p>
        </div>
      </div>

      {/* ── Preview ────────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-3">
        <div className="flex items-center gap-2">
          <CalendarDays size={18} className="text-emerald-600" />
          <h2 className="text-sm font-semibold text-gray-900">Schedule Preview</h2>
        </div>

        <p className="text-sm text-gray-700">
          <span className="font-medium">{patternSummary}</span>
          {totalOrders > 0 && (
            <> — <span className="font-semibold">{totalOrders}</span> order{totalOrders === 1 ? '' : 's'}
              {' '}from {formatDate(schedule.dates[0])} to {formatDate(schedule.dates[totalOrders - 1])}</>
          )}
        </p>

        {schedule.truncated && (
          <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            This pattern exceeds the {MAX_OCCURRENCES}-order limit. Shorten the range or increase the interval.
          </div>
        )}

        {totalOrders === 0 ? (
          <p className="text-sm text-gray-400">
            No delivery dates yet — choose a pattern and an end rule.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {schedule.dates.slice(0, 12).map(d => (
                <span key={d} className="px-2 py-1 rounded-md bg-gray-50 border border-gray-200 text-xs text-gray-700">
                  {formatDate(d)}
                </span>
              ))}
              {totalOrders > 12 && (
                <span className="px-2 py-1 text-xs text-gray-500">+{totalOrders - 12} more</span>
              )}
            </div>
            {validLines.length > 0 && (
              <p className="text-xs text-gray-500">
                Creates {totalOrders} reagent order{totalOrders === 1 ? '' : 's'} with{' '}
                {validLines.length} line{validLines.length === 1 ? '' : 's'} each ({totalLines} lines total).
              </p>
            )}
          </>
        )}
      </div>

      {/* ── Options + submit ───────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={2}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Copied onto every order in the series…"
          />
        </div>

        <label
          className={cn(
            'flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors',
            highPriority ? 'border-red-300 bg-red-50' : 'border-gray-200 hover:bg-gray-50'
          )}
        >
          <input
            type="checkbox"
            checked={highPriority}
            onChange={e => setHighPriority(e.target.checked)}
            className="mt-0.5 h-4 w-4 text-red-600 rounded border-gray-300 focus:ring-red-500"
          />
          <div className="flex-1">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
              <AlertTriangle size={14} className={highPriority ? 'text-red-600' : 'text-gray-400'} />
              Flag every order as High Priority
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              Tags each generated order so it stands out on the Reagent Orders list.
            </p>
          </div>
        </label>

        {busy && (
          <div className="flex items-center gap-2 text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-lg p-3">
            <Loader2 size={16} className="animate-spin" />
            Creating orders… {progress!.done} of {progress!.total}
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={busy || totalOrders === 0 || schedule.truncated}
          className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          <Save size={15} />
          {busy
            ? 'Creating…'
            : totalOrders > 0
              ? `Create Standing Order (${totalOrders} order${totalOrders === 1 ? '' : 's'})`
              : 'Create Standing Order'}
        </button>
      </div>
    </div>
  );
}
