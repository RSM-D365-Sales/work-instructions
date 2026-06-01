import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { QCResult } from '../types';
import { cn } from '../lib/utils';
import { formatSpec, formatResultValue } from '../lib/qc';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts';
import { TrendingUp, FlaskConical } from 'lucide-react';

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

export default function QualityTrendsPage() {
  const [itemId, setItemId] = useState<string>('');
  const [selectedLots, setSelectedLots] = useState<Set<string>>(new Set());

  const { data: items = [] } = useQuery<TrendItem[]>({
    queryKey: ['trend-items'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reagent_items')
        .select('id, item_number, product_name')
        .eq('is_active', true)
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
        .select('*')
        .in('production_order_id', orderIds);
      if (e3) throw e3;
      return { orders: orders as TrendOrder[], results: (results ?? []) as QCResult[] };
    },
  });

  const orders = data?.orders ?? [];
  const results = data?.results ?? [];

  // lots that actually have QC results, sorted oldest → newest
  const lots = useMemo(() => {
    const withResults = orders.filter(o => results.some(r => r.production_order_id === o.id));
    return withResults.sort((a, b) => new Date(lotDate(a)).getTime() - new Date(lotDate(b)).getTime());
  }, [orders, results]);

  // default selection: most recent 8 lots — reset when the lot set changes
  const lotsKey = lots.map(l => l.id).join(',');
  useEffect(() => {
    setSelectedLots(new Set(lots.slice(-8).map(l => l.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lotsKey]);

  const selectedLotList = lots.filter(l => selectedLots.has(l.id));

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

  function toggleLot(id: string) {
    setSelectedLots(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <TrendingUp size={22} className="text-blue-600" /> Quality Trends
        </h1>
        <p className="text-sm text-gray-500 mt-1">Compare QC test results across production lots of the same item over time.</p>
      </div>

      {/* Item picker */}
      <div className="flex items-center gap-3">
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
        {isFetching && <span className="text-sm text-gray-400">Loading…</span>}
      </div>

      {!itemId ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-200 text-gray-400">
          <FlaskConical size={36} className="mx-auto text-gray-300 mb-3" />
          Select a product to view its lot history.
        </div>
      ) : lots.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-200 text-gray-400">
          No production lots with QC results found for this item yet.
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
                    return {
                      lot: l.lot_number,
                      value: r?.result_numeric ?? null,
                      date: new Date(lotDate(l)).toLocaleDateString(),
                    };
                  });
                  return (
                    <div key={t.name} className="bg-white rounded-xl border border-gray-200 p-4">
                      <div className="flex items-baseline justify-between mb-3">
                        <h3 className="font-semibold text-gray-900 text-sm">{t.name}{spec.unit ? ` (${spec.unit})` : ''}</h3>
                        <span className="text-xs text-gray-400">Spec: {formatSpec(spec)}</span>
                      </div>
                      <ResponsiveContainer width="100%" height={220}>
                        <LineChart data={chartData} margin={{ top: 5, right: 12, bottom: 5, left: -10 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                          <XAxis dataKey="lot" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                          <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" domain={['auto', 'auto']} />
                          <Tooltip
                            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                            formatter={(v) => [`${v}${spec.unit ? ` ${spec.unit}` : ''}`, t.name] as [string, string]}
                          />
                          {spec.lower_limit != null && (
                            <ReferenceLine y={spec.lower_limit} stroke="#ef4444" strokeDasharray="4 4" label={{ value: 'LSL', fontSize: 10, fill: '#ef4444', position: 'insideTopLeft' }} />
                          )}
                          {spec.upper_limit != null && (
                            <ReferenceLine y={spec.upper_limit} stroke="#ef4444" strokeDasharray="4 4" label={{ value: 'USL', fontSize: 10, fill: '#ef4444', position: 'insideBottomLeft' }} />
                          )}
                          {spec.target != null && (
                            <ReferenceLine y={spec.target} stroke="#22c55e" strokeDasharray="2 2" />
                          )}
                          <Line type="monotone" dataKey="value" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  );
                })}
              </div>

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
                          return (
                            <td key={l.id} className="px-4 py-2.5 whitespace-nowrap">
                              {r ? (
                                <span className={cn(
                                  'font-medium',
                                  r.passed === false ? 'text-red-600' : r.passed === true ? 'text-green-700' : 'text-gray-700'
                                )}>
                                  {formatResultValue(r.result_type, r.result_numeric, r.result_text, r.unit)}
                                </span>
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
    </div>
  );
}
