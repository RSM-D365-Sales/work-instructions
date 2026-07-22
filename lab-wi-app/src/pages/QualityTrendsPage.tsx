import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { QCResult, Scale } from '../types';
import { cn } from '../lib/utils';
import { formatSpec, formatResultValue } from '../lib/qc';
import EquipmentHealthSummary from '../components/EquipmentHealthSummary';
import FlagCalibrationModal from '../components/FlagCalibrationModal';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer, Legend,
} from 'recharts';
import { TrendingUp, FlaskConical, Wrench } from 'lucide-react';

interface TrendItem { id: string; item_number: string; product_name: string }
interface TrendOrder {
  id: string;
  lot_number: string;
  production_order_number: string;
  completed_at: string | null;
  created_at: string;
  status: string;
}

const lotDate = (o: TrendOrder) => o.completed_at ?? o.created_at;

type PivotMode = 'lot' | 'user' | 'instrument';

const PIVOT_LABELS: Record<PivotMode, string> = {
  lot: 'Lots',
  user: 'By user',
  instrument: 'By instrument',
};

const WINDOW_OPTIONS = [
  { days: 0, label: 'All time' },
  { days: 10, label: '10 days' },
  { days: 30, label: '30 days' },
  { days: 60, label: '60 days' },
];

// Categorical series palette — CVD-safe in this fixed order (validated on a
// white surface); assign slots in order, never cycle past MAX_SERIES.
const SERIES_COLORS = ['#2a78d6', '#008300', '#e87ba4', '#eda100', '#1baf7a', '#eb6834'];
const MAX_SERIES = SERIES_COLORS.length;

interface PivotGroup {
  key: string;
  label: string;
  count: number;
  color?: string; // only the top MAX_SERIES groups are charted
}

const fmtNum = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

export default function QualityTrendsPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [itemId, setItemId] = useState<string>('');
  const [selectedLots, setSelectedLots] = useState<Set<string>>(new Set());
  const [pivot, setPivot] = useState<PivotMode>('lot');
  const [windowDays, setWindowDays] = useState(0);
  const [flagTarget, setFlagTarget] = useState<{ instrumentLabel: string; defaultScaleId: string } | null>(null);

  const { data: items = [] } = useQuery<TrendItem[]>({
    queryKey: ['trend-items'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reagent_items')
        .select('id, item_number, product_name')
        .eq('is_active', true)
        .eq('item_type', 'FG')   // finished goods only — raw materials and
                                 // packaging carry no release panel to trend
        .order('item_number');
      if (error) throw error;
      return data as TrendItem[];
    },
  });

  const { data, isFetching } = useQuery<{ orders: TrendOrder[]; results: QCResult[] }>({
    queryKey: ['trend-data', itemId],
    enabled: !!itemId,
    queryFn: async () => {
      const { data: wis, error: e1 } = await supabase
        .from('work_instructions')
        .select('id')
        .eq('reagent_item_id', itemId);
      if (e1) throw e1;
      const wiIds = (wis ?? []).map(w => w.id);
      if (wiIds.length === 0) return { orders: [], results: [] };

      const { data: orders, error: e2 } = await supabase
        .from('production_orders')
        .select('id, lot_number, production_order_number, completed_at, created_at, status')
        .in('work_instruction_id', wiIds);
      if (e2) throw e2;
      const orderIds = (orders ?? []).map(o => o.id);
      if (orderIds.length === 0) return { orders: orders as TrendOrder[], results: [] };

      const { data: results, error: e3 } = await supabase
        .from('qc_results')
        .select('*, tester:profiles!tested_by(id, full_name)')
        .in('production_order_id', orderIds);
      if (e3) throw e3;
      return { orders: orders as TrendOrder[], results: (results ?? []) as QCResult[] };
    },
  });

  // Equipment master — for matching free-text instruments and flagging.
  const { data: scales = [] } = useQuery<Scale[]>({
    queryKey: ['scales'],
    queryFn: async () => {
      const { data, error } = await supabase.from('scales').select('*').order('name');
      if (error) throw error;
      return data as Scale[];
    },
  });

  const orders = data?.orders ?? [];
  const results = data?.results ?? [];

  // lots that actually have QC results, inside the time window, oldest → newest
  const lots = useMemo(() => {
    const cutoff = windowDays > 0 ? Date.now() - windowDays * 86_400_000 : 0;
    const withResults = orders.filter(o =>
      results.some(r => r.production_order_id === o.id) &&
      (cutoff === 0 || new Date(lotDate(o)).getTime() >= cutoff)
    );
    return withResults.sort((a, b) => new Date(lotDate(a)).getTime() - new Date(lotDate(b)).getTime());
  }, [orders, results, windowDays]);

  // default selection: most recent 8 lots — reset when the lot set changes
  const lotsKey = lots.map(l => l.id).join(',');
  useEffect(() => {
    setSelectedLots(new Set(lots.slice(-8).map(l => l.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lotsKey]);

  const selectedLotList = lots.filter(l => selectedLots.has(l.id));
  const selectedIds = new Set(selectedLotList.map(l => l.id));

  // distinct tests across results, ordered by test_order
  const tests = useMemo(() => {
    const map = new Map<string, { name: string; order: number; sample: QCResult }>();
    for (const r of results) {
      const cur = map.get(r.name);
      if (!cur || new Date(r.created_at) > new Date(cur.sample.created_at)) {
        map.set(r.name, { name: r.name, order: r.test_order, sample: r });
      }
    }
    return [...map.values()].sort((a, b) => a.order - b.order);
  }, [results]);

  function resultFor(orderId: string, testName: string): QCResult | undefined {
    return results.find(r => r.production_order_id === orderId && r.name === testName);
  }

  /** Which pivot group a result belongs to (null = unattributed in this mode). */
  function groupOf(r: QCResult): { key: string; label: string } | null {
    if (pivot === 'user') {
      if (!r.tested_by) return null;
      return { key: r.tested_by, label: r.tester?.full_name ?? 'Unknown user' };
    }
    if (pivot === 'instrument') {
      const raw = (r.instrument ?? '').trim();
      if (!raw) return null;
      return { key: raw.toLowerCase(), label: raw };
    }
    return null;
  }

  // Pivot groups over the selected lots, largest first. The top MAX_SERIES
  // get a fixed color slot; the rest still appear in tables, just uncharted.
  const { groups, unattributed } = useMemo(() => {
    if (pivot === 'lot') return { groups: [] as PivotGroup[], unattributed: 0 };
    const map = new Map<string, PivotGroup>();
    let missing = 0;
    for (const r of results) {
      if (!selectedIds.has(r.production_order_id)) continue;
      const g = groupOf(r);
      if (!g) { missing++; continue; }
      const cur = map.get(g.key);
      if (cur) cur.count++;
      else map.set(g.key, { key: g.key, label: g.label, count: 1 });
    }
    const sorted = [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    sorted.forEach((g, i) => { if (i < MAX_SERIES) g.color = SERIES_COLORS[i]; });
    return { groups: sorted, unattributed: missing };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, pivot, lotsKey, selectedLots]);

  const chartedGroups = groups.filter(g => g.color);

  /** Per-group descriptive stats for one test, over the selected lots. */
  function statsFor(testName: string) {
    return groups.map(g => {
      const vals: number[] = [];
      let oos = 0;
      for (const l of selectedLotList) {
        const r = resultFor(l.id, testName);
        if (!r || r.result_numeric == null) continue;
        const grp = groupOf(r);
        if (!grp || grp.key !== g.key) continue;
        vals.push(r.result_numeric);
        if (r.passed === false) oos++;
      }
      if (vals.length === 0) return null;
      const n = vals.length;
      const mean = vals.reduce((s, v) => s + v, 0) / n;
      const sd = n > 1 ? Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)) : 0;
      return { group: g, n, mean, sd, min: Math.min(...vals), max: Math.max(...vals), oos };
    }).filter((s): s is NonNullable<typeof s> => s !== null);
  }

  /** Exact-match a free-text instrument label against the equipment master. */
  function matchScale(instrumentKey: string): Scale | undefined {
    return scales.find(s =>
      s.name.trim().toLowerCase() === instrumentKey ||
      (s.serial_number ?? '').trim().toLowerCase() === instrumentKey ||
      (s.barcode ?? '').trim().toLowerCase() === instrumentKey
    );
  }

  // Instrument-mode summary rows (all groups, with match + flag state).
  const instrumentRows = pivot === 'instrument'
    ? groups.map(g => {
        let oos = 0;
        for (const r of results) {
          if (!selectedIds.has(r.production_order_id)) continue;
          const grp = groupOf(r);
          if (grp?.key === g.key && r.passed === false) oos++;
        }
        return { group: g, oos, scale: matchScale(g.key) };
      })
    : [];

  function toggleLot(id: string) {
    setSelectedLots(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const selectedItem = items.find(it => it.id === itemId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <TrendingUp size={22} className="text-blue-600" /> Quality Trends
        </h1>
        <p className="text-sm text-gray-500 mt-1">Compare QC test results across production lots — overall, by user, or by instrument.</p>
      </div>

      {/* Item picker + window */}
      <div className="flex items-center gap-3 flex-wrap">
        <label className="text-sm font-medium text-gray-700">Item</label>
        <select
          value={itemId}
          onChange={e => setItemId(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white min-w-72"
        >
          <option value="">— select a product —</option>
          {items.map(it => (
            <option key={it.id} value={it.id}>{it.item_number} · {it.product_name}</option>
          ))}
        </select>
        <div className="flex items-center gap-1 ml-2">
          {WINDOW_OPTIONS.map(w => (
            <button
              key={w.days}
              onClick={() => setWindowDays(w.days)}
              className={cn(
                'px-2.5 py-1 rounded-full text-xs font-medium border transition-colors',
                windowDays === w.days
                  ? 'bg-blue-600 text-white border-transparent'
                  : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
              )}
            >
              {w.label}
            </button>
          ))}
        </div>
        {isFetching && <span className="text-sm text-gray-400">Loading…</span>}
      </div>

      {/* Pinned: which instrument should a supervisor worry about, across every
          product — visible whether or not a single item is selected below. */}
      <EquipmentHealthSummary />

      {!itemId ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-200 text-gray-400">
          <FlaskConical size={36} className="mx-auto text-gray-300 mb-3" />
          Select a product to view its lot history.
        </div>
      ) : lots.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-200 text-gray-400">
          No production lots with QC results found for this item{windowDays > 0 ? ' in this time window' : ''} yet.
        </div>
      ) : (
        <>
          {/* Lot selector */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-sm font-medium text-gray-700 mb-2">Lots ({selectedLotList.length} of {lots.length} selected)</p>
            <div className="flex flex-wrap gap-2">
              {lots.map(l => {
                const on = selectedLots.has(l.id);
                return (
                  <button
                    key={l.id}
                    onClick={() => toggleLot(l.id)}
                    className={cn(
                      'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                      on ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                    )}
                    title={new Date(lotDate(l)).toLocaleDateString()}
                  >
                    {l.lot_number}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Pivot switch */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-gray-700">Group by</span>
            {(Object.keys(PIVOT_LABELS) as PivotMode[]).map(m => (
              <button
                key={m}
                onClick={() => setPivot(m)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                  pivot === m ? 'bg-blue-600 text-white border-transparent' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                )}
              >
                {PIVOT_LABELS[m]}
              </button>
            ))}
            {pivot !== 'lot' && unattributed > 0 && (
              <span className="text-xs text-gray-400">
                {unattributed} result{unattributed === 1 ? '' : 's'} without {pivot === 'user' ? 'a recorded tester' : 'a recorded instrument'} not shown as a series.
              </span>
            )}
            {pivot !== 'lot' && groups.length > MAX_SERIES && (
              <span className="text-xs text-amber-600">
                Charting the top {MAX_SERIES} of {groups.length} {pivot === 'user' ? 'users' : 'instruments'} — the rest appear in the tables.
              </span>
            )}
          </div>

          {selectedLotList.length === 0 ? (
            <div className="text-center py-10 bg-white rounded-xl border border-gray-200 text-gray-400 text-sm">
              Select one or more lots to compare.
            </div>
          ) : (
            <>
              {/* Charts: one per numeric test */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {tests.filter(t => t.sample.result_type === 'numeric').map(t => {
                  const spec = t.sample;
                  const chartData = selectedLotList.map(l => {
                    const r = resultFor(l.id, t.name);
                    const row: Record<string, string | number | null> = {
                      lot: l.lot_number,
                      date: new Date(lotDate(l)).toLocaleDateString(),
                    };
                    if (pivot === 'lot') {
                      row.value = r?.result_numeric ?? null;
                    } else {
                      for (const g of chartedGroups) row[g.key] = null;
                      if (r?.result_numeric != null) {
                        const g = groupOf(r);
                        if (g && chartedGroups.some(cg => cg.key === g.key)) row[g.key] = r.result_numeric;
                      }
                    }
                    return row;
                  });
                  const stats = pivot !== 'lot' ? statsFor(t.name) : [];
                  return (
                    <div key={t.name} className="bg-white rounded-xl border border-gray-200 p-4">
                      <div className="flex items-baseline justify-between mb-3">
                        <h3 className="font-semibold text-gray-900 text-sm">{t.name}{spec.unit ? ` (${spec.unit})` : ''}</h3>
                        <span className="text-xs text-gray-400">Spec: {formatSpec(spec)}</span>
                      </div>
                      <ResponsiveContainer width="100%" height={pivot === 'lot' ? 220 : 250}>
                        <LineChart data={chartData} margin={{ top: 5, right: 12, bottom: 5, left: -10 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                          <XAxis dataKey="lot" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                          <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" domain={['auto', 'auto']} />
                          <Tooltip
                            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                            formatter={(v, name) => [`${v}${spec.unit ? ` ${spec.unit}` : ''}`, pivot === 'lot' ? t.name : String(name)] as [string, string]}
                          />
                          {pivot !== 'lot' && chartedGroups.length > 1 && (
                            <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} />
                          )}
                          {spec.lower_limit != null && (
                            <ReferenceLine y={spec.lower_limit} stroke="#ef4444" strokeDasharray="4 4" label={{ value: 'LSL', fontSize: 10, fill: '#ef4444', position: 'insideTopLeft' }} />
                          )}
                          {spec.upper_limit != null && (
                            <ReferenceLine y={spec.upper_limit} stroke="#ef4444" strokeDasharray="4 4" label={{ value: 'USL', fontSize: 10, fill: '#ef4444', position: 'insideBottomLeft' }} />
                          )}
                          {spec.target != null && (
                            <ReferenceLine y={spec.target} stroke="#22c55e" strokeDasharray="2 2" />
                          )}
                          {pivot === 'lot' ? (
                            <Line type="monotone" dataKey="value" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                          ) : (
                            chartedGroups.map(g => (
                              <Line
                                key={g.key}
                                type="monotone"
                                dataKey={g.key}
                                name={g.label}
                                stroke={g.color}
                                strokeWidth={2}
                                dot={{ r: 3, fill: g.color, strokeWidth: 0 }}
                                activeDot={{ r: 5 }}
                                connectNulls
                              />
                            ))
                          )}
                        </LineChart>
                      </ResponsiveContainer>

                      {/* Per-group stats for this test */}
                      {pivot !== 'lot' && stats.length > 0 && (
                        <table className="w-full text-xs mt-2">
                          <thead>
                            <tr className="text-gray-400">
                              <th className="text-left py-1 font-medium">{pivot === 'user' ? 'User' : 'Instrument'}</th>
                              <th className="text-right py-1 font-medium">n</th>
                              <th className="text-right py-1 font-medium">Mean</th>
                              <th className="text-right py-1 font-medium">SD</th>
                              <th className="text-right py-1 font-medium">Range</th>
                              <th className="text-right py-1 font-medium">Out of spec</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {stats.map(s => (
                              <tr key={s.group.key}>
                                <td className="py-1.5 text-gray-700">
                                  <span className="inline-flex items-center gap-1.5">
                                    <span
                                      className="h-2 w-2 rounded-full shrink-0"
                                      style={{ backgroundColor: s.group.color ?? '#d1d5db' }}
                                    />
                                    {s.group.label}
                                  </span>
                                </td>
                                <td className="py-1.5 text-right text-gray-500 tabular-nums">{s.n}</td>
                                <td className="py-1.5 text-right text-gray-700 tabular-nums">{fmtNum(s.mean)}</td>
                                <td className="py-1.5 text-right text-gray-500 tabular-nums">{s.n > 1 ? fmtNum(s.sd) : '—'}</td>
                                <td className="py-1.5 text-right text-gray-500 tabular-nums">{fmtNum(s.min)}–{fmtNum(s.max)}</td>
                                <td className={cn('py-1.5 text-right tabular-nums', s.oos > 0 ? 'text-red-600 font-semibold' : 'text-gray-400')}>
                                  {s.oos}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Instrument summary + flag-for-calibration (B4 → A4) */}
              {pivot === 'instrument' && instrumentRows.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="p-4 border-b border-gray-100 flex items-center gap-2">
                    <Wrench size={16} className="text-gray-500" />
                    <h2 className="font-semibold text-gray-900 text-sm">Instruments</h2>
                    <span className="text-xs text-gray-400 ml-auto">
                      Matched against the equipment master (Scales page) by name, serial, or barcode
                    </span>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-600">
                        <th className="text-left px-4 py-2.5 font-medium">Instrument</th>
                        <th className="text-right px-4 py-2.5 font-medium">Results</th>
                        <th className="text-right px-4 py-2.5 font-medium">Out of spec</th>
                        <th className="text-left px-4 py-2.5 font-medium">Equipment record</th>
                        <th className="text-left px-4 py-2.5 font-medium">Calibration</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {instrumentRows.map(({ group: g, oos, scale }) => (
                        <tr key={g.key}>
                          <td className="px-4 py-2.5 text-gray-900">
                            <span className="inline-flex items-center gap-1.5 font-medium">
                              <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: g.color ?? '#d1d5db' }} />
                              {g.label}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right text-gray-500 tabular-nums">{g.count}</td>
                          <td className={cn('px-4 py-2.5 text-right tabular-nums', oos > 0 ? 'text-red-600 font-semibold' : 'text-gray-400')}>{oos}</td>
                          <td className="px-4 py-2.5 text-gray-500">{scale ? scale.name : <span className="text-gray-300">no match</span>}</td>
                          <td className="px-4 py-2.5">
                            {scale?.calibration_flagged_at ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                                <Wrench size={12} /> Flagged {new Date(scale.calibration_flagged_at).toLocaleDateString()}
                              </span>
                            ) : isAdmin ? (
                              <button
                                onClick={() => setFlagTarget({ instrumentLabel: g.label, defaultScaleId: scale?.id ?? '' })}
                                className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 hover:text-amber-900 hover:underline"
                              >
                                <Wrench size={12} /> Flag for calibration
                              </button>
                            ) : (
                              <span className="text-xs text-gray-300">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Comparison table: tests × lots */}
              <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      <th className="text-left px-4 py-3 font-medium text-gray-600 sticky left-0 bg-gray-50">Test</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Specification</th>
                      {selectedLotList.map(l => (
                        <th key={l.id} className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">
                          <div>{l.lot_number}</div>
                          <div className="text-[10px] font-normal text-gray-400">{new Date(lotDate(l)).toLocaleDateString()}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {tests.map(t => (
                      <tr key={t.name}>
                        <td className="px-4 py-2.5 font-medium text-gray-900 sticky left-0 bg-white whitespace-nowrap">{t.name}</td>
                        <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">{formatSpec(t.sample)}</td>
                        {selectedLotList.map(l => {
                          const r = resultFor(l.id, t.name);
                          const attribution = r && pivot === 'user'
                            ? r.tester?.full_name
                            : r && pivot === 'instrument'
                              ? (r.instrument ?? '').trim() || null
                              : null;
                          return (
                            <td key={l.id} className="px-4 py-2.5 whitespace-nowrap">
                              {r ? (
                                <div>
                                  <span className={cn(
                                    'font-medium',
                                    r.passed === false ? 'text-red-600' : r.passed === true ? 'text-green-700' : 'text-gray-700'
                                  )}>
                                    {formatResultValue(r.result_type, r.result_numeric, r.result_text, r.unit)}
                                  </span>
                                  {pivot !== 'lot' && (
                                    <div className="text-[10px] text-gray-400">{attribution ?? 'not recorded'}</div>
                                  )}
                                </div>
                              ) : <span className="text-gray-300">—</span>}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {flagTarget && (
        <FlagCalibrationModal
          instrumentLabel={flagTarget.instrumentLabel}
          defaultScaleId={flagTarget.defaultScaleId}
          scales={scales}
          context={selectedItem
            ? `Quality Trends (${selectedItem.item_number} · ${selectedItem.product_name})`
            : 'Quality Trends'}
          onClose={() => setFlagTarget(null)}
        />
      )}
    </div>
  );
}
