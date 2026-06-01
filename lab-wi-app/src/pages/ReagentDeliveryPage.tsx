import { useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { ReagentOrder, ReagentOrderItem } from '../types';
import { cn } from '../lib/utils';
import {
  ArrowLeft, Truck, Building2, CheckCircle, Loader2, AlertTriangle, PackageCheck,
} from 'lucide-react';

const SOURCE_WAREHOUSE = 'REAGENT';

function genTransferNumber() {
  const y = new Date().getFullYear();
  const n = Math.floor(100000 + Math.random() * 900000);
  return `TO-${y}-${n}`;
}

// A single editable delivery line.
interface DeliveryLine {
  lineId: string;          // reagent_order_items.id ('legacy' for pre-migration-020 orders)
  orderId: string;
  reagentItemId: string;
  itemNumber: string;
  productName: string;
  unit: string;
  lotControlled: boolean;
  orderedQty: number;
  // editable
  qty: string;
  location: string;
  lot: string;
}

// Fallback to a synthetic single line for legacy orders without line-item rows.
function linesOf(o: ReagentOrder): ReagentOrderItem[] {
  const items = (o.items ?? []).slice().sort((a, b) => a.line_number - b.line_number);
  if (items.length > 0) return items;
  if (o.reagent_item && o.quantity != null) {
    return [{
      id: 'legacy', order_id: o.id, line_number: 1,
      reagent_item_id: o.reagent_item.id, quantity: o.quantity,
      unit: o.unit ?? o.reagent_item.unit_of_measure,
      created_at: o.created_at, reagent_item: o.reagent_item,
    }];
  }
  return [];
}

export default function ReagentDeliveryPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { profile } = useAuth();
  const [params] = useSearchParams();

  const orderIds = useMemo(
    () => (params.get('orders') ?? '').split(',').map(s => s.trim()).filter(Boolean),
    [params]
  );

  const [deliveryDate, setDeliveryDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [linesState, setLinesState] = useState<Record<string, { qty: string; location: string; lot: string }>>({});
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ transferNumbers: string[]; labCount: number; lineCount: number } | null>(null);

  const { data: orders = [], isLoading } = useQuery<ReagentOrder[]>({
    queryKey: ['reagent-orders-deliver', orderIds],
    enabled: orderIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reagent_orders')
        .select(`
          *,
          reagent_item:reagent_items(id, item_number, product_name, unit_of_measure, lot_controlled),
          items:reagent_order_items(
            id, line_number, quantity, unit, reagent_item_id,
            reagent_item:reagent_items(id, item_number, product_name, unit_of_measure, lot_controlled)
          ),
          lab:labs(id, name, warehouse_id),
          requester:profiles!reagent_orders_requested_by_fkey(id, full_name)
        `)
        .in('id', orderIds);
      if (error) throw error;
      return data as ReagentOrder[];
    },
  });

  // Group selected orders by destination lab — one transfer order per lab.
  const groups = useMemo(() => {
    const map = new Map<string, { labId: string; labName: string; warehouseId: string; orders: ReagentOrder[] }>();
    for (const o of orders) {
      const labId = o.lab?.id ?? o.lab_id;
      let g = map.get(labId);
      if (!g) {
        g = { labId, labName: o.lab?.name ?? '—', warehouseId: o.lab?.warehouse_id ?? '', orders: [] };
        map.set(labId, g);
      }
      g.orders.push(o);
    }
    return [...map.values()];
  }, [orders]);

  // Default editable state for a line (ordered qty, blank location/lot).
  function defaultFor(li: ReagentOrderItem) {
    return { qty: String(li.quantity ?? ''), location: '', lot: '' };
  }
  function lineState(li: ReagentOrderItem) {
    return linesState[li.id] ?? defaultFor(li);
  }
  function setLine(li: ReagentOrderItem, patch: Partial<{ qty: string; location: string; lot: string }>) {
    setLinesState(prev => ({ ...prev, [li.id]: { ...(prev[li.id] ?? defaultFor(li)), ...patch } }));
  }

  // Flatten to validated DeliveryLines for the finalize step.
  function buildLines(): DeliveryLine[] {
    const out: DeliveryLine[] = [];
    for (const o of orders) {
      for (const li of linesOf(o)) {
        const ri = li.reagent_item;
        const st = lineState(li);
        out.push({
          lineId: li.id,
          orderId: o.id,
          reagentItemId: li.reagent_item_id,
          itemNumber: ri?.item_number ?? '',
          productName: ri?.product_name ?? '—',
          unit: li.unit ?? ri?.unit_of_measure ?? 'ea',
          lotControlled: ri?.lot_controlled ?? false,
          orderedQty: li.quantity,
          qty: st.qty,
          location: st.location,
          lot: st.lot,
        });
      }
    }
    return out;
  }

  const finalize = useMutation({
    mutationFn: async () => {
      const lines = buildLines();
      if (lines.length === 0) throw new Error('Nothing to deliver.');

      // Validate
      for (const l of lines) {
        const q = parseFloat(l.qty);
        if (!l.qty || isNaN(q) || q <= 0) {
          throw new Error(`${l.productName}: delivery quantity must be greater than 0.`);
        }
        if (!l.location.trim()) {
          throw new Error(`${l.productName}: a destination location is required.`);
        }
        if (l.lotControlled && !l.lot.trim()) {
          throw new Error(`${l.productName} is lot-controlled — a LOT number is required.`);
        }
      }

      const now = new Date().toISOString();
      const transferNumbers: string[] = [];

      // One transfer order per destination lab.
      for (const g of groups) {
        const toNum = genTransferNumber();
        transferNumbers.push(toNum);

        for (const o of g.orders) {
          // Update each real line item with its delivered details.
          for (const li of linesOf(o)) {
            if (li.id === 'legacy') continue; // legacy orders have no line row to update
            const st = lineState(li);
            const { error: liErr } = await supabase
              .from('reagent_order_items')
              .update({
                delivered_quantity: parseFloat(st.qty),
                delivered_location: st.location.trim(),
                lot_number: (li.reagent_item?.lot_controlled ? st.lot.trim() : null) || null,
                delivered_at: now,
              })
              .eq('id', li.id);
            if (liErr) throw liErr;
          }

          // Mark the order delivered + stamp the transfer order.
          const { error: oErr } = await supabase
            .from('reagent_orders')
            .update({
              status: 'fulfilled',
              transfer_order_number: toNum,
              transfer_order_status: 'created',
              transfer_order_created_at: now,
            })
            .eq('id', o.id);
          if (oErr) throw oErr;
        }
      }

      return { transferNumbers, labCount: groups.length, lineCount: lines.length };
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['reagent-orders'] });
      setDone(res);
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Delivery failed'),
  });

  // ─── Empty / loading states ────────────────────────────────────────────────
  if (orderIds.length === 0) {
    return (
      <div className="max-w-3xl mx-auto">
        <p className="text-gray-500">No orders selected to deliver.</p>
        <button onClick={() => navigate('/reagent-orders')} className="mt-3 text-blue-600 hover:underline text-sm">
          ← Back to Reagent Orders
        </button>
      </div>
    );
  }

  // ─── Success card ──────────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="max-w-2xl mx-auto space-y-5">
        <div className="bg-white rounded-xl border border-gray-200 p-6 text-center space-y-4">
          <div className="mx-auto w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
            <PackageCheck size={26} className="text-green-600" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900">Delivery Finalized</h1>
            <p className="text-sm text-gray-500 mt-1">
              {done.lineCount} line{done.lineCount === 1 ? '' : 's'} delivered to {done.labCount} lab
              {done.labCount === 1 ? '' : 's'}. Orders marked <span className="font-medium text-green-700">Fulfilled</span>.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {done.transferNumbers.map(n => (
              <span key={n} className="inline-flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-sm">
                <Truck size={14} className="text-green-600" />
                <span className="font-mono">{n}</span>
              </span>
            ))}
          </div>
          <button
            onClick={() => navigate('/reagent-orders')}
            className="w-full bg-gray-900 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-gray-800"
          >
            View All Orders
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/reagent-orders')} className="text-gray-400 hover:text-gray-700">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Deliver Reagent Orders</h1>
          <p className="text-sm text-gray-500">
            Finalize the transfer from the REAGENT lab to the requesting lab(s)
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {/* Source / delivery meta */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">From (source)</p>
          <p className="flex items-center gap-1.5 text-gray-900 font-medium">
            <Building2 size={15} className="text-gray-400" />
            REAGENT Production Lab
          </p>
          <p className="text-xs text-gray-400 font-mono mt-0.5">Warehouse {SOURCE_WAREHOUSE}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Delivered by</p>
          <p className="text-gray-900">{profile?.full_name ?? '—'}</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Delivery date</label>
          <input
            type="date"
            value={deliveryDate}
            onChange={e => setDeliveryDate(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">Loading orders…</div>
      ) : (
        groups.map(g => (
          <div key={g.labId} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {/* Destination lab header = one transfer order */}
            <div className="flex items-center gap-2 px-5 py-3 bg-emerald-50 border-b border-emerald-100">
              <Truck size={16} className="text-emerald-600" />
              <span className="text-sm font-semibold text-gray-900">To: {g.labName}</span>
              {g.warehouseId && <span className="text-xs font-mono text-gray-500">({g.warehouseId})</span>}
              <span className="ml-auto text-xs text-gray-500">
                {g.orders.length} order{g.orders.length === 1 ? '' : 's'} · 1 transfer order
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b border-gray-100 bg-gray-50">
                    <th className="px-4 py-2 font-medium">Order #</th>
                    <th className="px-4 py-2 font-medium">Product</th>
                    <th className="px-4 py-2 font-medium text-right">Ordered</th>
                    <th className="px-4 py-2 font-medium">Deliver Qty</th>
                    <th className="px-4 py-2 font-medium">Location</th>
                    <th className="px-4 py-2 font-medium">LOT</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {g.orders.flatMap(o =>
                    linesOf(o).map(li => {
                      const ri = li.reagent_item;
                      const st = lineState(li);
                      const lotControlled = ri?.lot_controlled ?? false;
                      return (
                        <tr key={li.id === 'legacy' ? `${o.id}-legacy` : li.id}>
                          <td className="px-4 py-2.5 font-mono text-xs text-gray-600 whitespace-nowrap align-top">
                            {o.order_number}
                          </td>
                          <td className="px-4 py-2.5 align-top">
                            <p className="text-gray-900 font-medium">{ri?.product_name ?? '—'}</p>
                            <p className="text-xs text-gray-500 font-mono">{ri?.item_number}</p>
                            {lotControlled && (
                              <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-teal-100 text-teal-700 uppercase tracking-wide">
                                Lot Controlled
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right text-gray-700 whitespace-nowrap align-top tabular-nums">
                            {li.quantity} <span className="text-gray-400">{li.unit}</span>
                          </td>
                          <td className="px-4 py-2.5 align-top">
                            <div className="flex">
                              <input
                                type="number" step="any" min="0"
                                value={st.qty}
                                onChange={e => setLine(li, { qty: e.target.value })}
                                className="w-24 border border-gray-300 rounded-l-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                              <span className="inline-flex items-center px-2 bg-gray-50 border border-l-0 border-gray-300 rounded-r-lg text-xs text-gray-500">
                                {li.unit}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 align-top">
                            <input
                              type="text"
                              value={st.location}
                              onChange={e => setLine(li, { location: e.target.value })}
                              placeholder="e.g. Cold Room A / Shelf 3"
                              className="w-44 border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </td>
                          <td className="px-4 py-2.5 align-top">
                            {lotControlled ? (
                              <input
                                type="text"
                                value={st.lot}
                                onChange={e => setLine(li, { lot: e.target.value })}
                                placeholder="LOT #"
                                className={cn(
                                  'w-32 border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2',
                                  st.lot.trim()
                                    ? 'border-gray-300 focus:ring-blue-500'
                                    : 'border-amber-300 bg-amber-50 focus:ring-amber-500'
                                )}
                              />
                            ) : (
                              <span className="text-xs text-gray-400">— n/a —</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}

      {/* Finalize */}
      <div className="flex items-center justify-end gap-3">
        <button
          onClick={() => navigate('/reagent-orders')}
          className="px-4 py-2.5 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          onClick={() => { setError(''); finalize.mutate(); }}
          disabled={finalize.isPending || isLoading || groups.length === 0}
          className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50"
        >
          {finalize.isPending ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
          {finalize.isPending ? 'Finalizing…' : 'Finalize Delivery'}
        </button>
      </div>
    </div>
  );
}
