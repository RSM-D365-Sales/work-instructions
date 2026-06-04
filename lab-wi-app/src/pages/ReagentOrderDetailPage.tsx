import type { ReactNode } from 'react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { ReagentOrder, ReagentOrderItem, ReagentOrderStatus, WorkInstruction } from '../types';
import { cn, formatDate } from '../lib/utils';
import {
  ArrowLeft, Building2, Calendar, Truck, MessageSquare, CircleAlert, PackageCheck, User, Paperclip,
  AlertTriangle, Factory, Loader2, CheckCircle, XCircle, ChevronRight,
} from 'lucide-react';

const STATUS_STYLES: Record<ReagentOrderStatus, string> = {
  pending:     'bg-yellow-100 text-yellow-800',
  in_progress: 'bg-indigo-100 text-indigo-800',
  fulfilled:   'bg-green-100 text-green-800',
  cancelled:   'bg-gray-100 text-gray-600',
};
const STATUS_LABELS: Record<ReagentOrderStatus, string> = {
  pending:     'Pending',
  in_progress: 'In Progress',
  fulfilled:   'Fulfilled',
  cancelled:   'Cancelled',
};

/** Line items for an order, falling back to a synthetic single line for
 *  pre-migration-020 orders (mirrors the list/delivery pages). */
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

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-0.5">{label}</p>
      <div className="text-sm text-gray-900">{children}</div>
    </div>
  );
}

export default function ReagentOrderDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data: order, isLoading } = useQuery<ReagentOrder | null>({
    queryKey: ['reagent-order', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reagent_orders')
        .select(`
          *,
          reagent_item:reagent_items(id, item_number, product_name, unit_of_measure, lot_controlled),
          items:reagent_order_items(
            id, line_number, quantity, unit,
            delivered_quantity, from_location, to_location, lot_number, delivered_at, delivery_comment,
            reagent_item:reagent_items(id, item_number, product_name, unit_of_measure, lot_controlled)
          ),
          lab:labs(id, name, warehouse_id),
          creator:profiles!reagent_orders_created_by_fkey(id, full_name, email, role),
          requester:profiles!reagent_orders_requested_by_fkey(id, full_name, email, role)
        `)
        .eq('id', id!)
        .single();
      if (error) throw error;
      return data as ReagentOrder;
    },
  });

  if (isLoading) {
    return <div className="max-w-4xl mx-auto py-12 text-center text-gray-400">Loading order…</div>;
  }
  if (!order) {
    return (
      <div className="max-w-4xl mx-auto">
        <p className="text-gray-500">Order not found.</p>
        <button onClick={() => navigate('/reagent-orders')} className="mt-3 text-blue-600 hover:underline text-sm">
          ← Back to Reagent Orders
        </button>
      </div>
    );
  }

  const lines = linesOf(order);
  const anyDelivered = lines.some(l => l.delivered_at);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/reagent-orders')} className="text-gray-400 hover:text-gray-700">
          <ArrowLeft size={20} />
        </button>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-xl font-bold text-gray-900 font-mono">{order.order_number}</h1>
          <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_STYLES[order.status])}>
            {STATUS_LABELS[order.status]}
          </span>
          {order.high_priority && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600">
              <CircleAlert size={14} strokeWidth={2.5} /> High priority
            </span>
          )}
        </div>
      </div>

      {/* Insufficient-stock warning + planner production action */}
      {order.insufficient_stock && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle size={22} className="text-amber-600 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="font-semibold text-amber-900">Insufficient stock</p>
            <p className="text-sm text-amber-800 mt-0.5">
              On-hand stock can't fulfil this order. Raise a production order for the affected item(s) below —
              this creates a production order in D365 (warehouse <span className="font-mono">REAGENT</span>, site <span className="font-mono">3</span>).
            </p>
          </div>
        </div>
      )}

      {/* Order record / audit meta */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 grid grid-cols-2 sm:grid-cols-3 gap-5">
        <Meta label="Destination lab">
          <span className="inline-flex items-center gap-1.5">
            <Building2 size={14} className="text-gray-400" />
            {order.lab?.name ?? '—'}
            {order.lab?.warehouse_id && <span className="text-xs font-mono text-gray-400">({order.lab.warehouse_id})</span>}
          </span>
        </Meta>
        <Meta label="Requested by">
          <span className="inline-flex items-center gap-1.5"><User size={14} className="text-gray-400" />{order.requester?.full_name ?? '—'}</span>
        </Meta>
        <Meta label="Created by">{order.creator?.full_name ?? '—'}</Meta>
        <Meta label="Needed by">
          <span className="inline-flex items-center gap-1.5"><Calendar size={14} className="text-gray-400" />{formatDate(order.requested_for_date)}</span>
        </Meta>
        <Meta label="Created">{fmtDateTime(order.created_at)}</Meta>
        <Meta label="Transfer order">
          {order.transfer_order_number ? (
            <span className="inline-flex items-center gap-1.5">
              <Truck size={14} className={order.transfer_order_status === 'failed' ? 'text-red-600' : 'text-green-600'} />
              <span className="font-mono text-xs">{order.transfer_order_number}</span>
            </span>
          ) : <span className="text-gray-400">—</span>}
        </Meta>
        {order.transfer_order_created_at && (
          <Meta label="Delivered / transferred">{fmtDateTime(order.transfer_order_created_at)}</Meta>
        )}
      </div>

      {/* Order note from the requester */}
      {order.notes?.trim() && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-start gap-2">
          <Paperclip size={15} className="text-indigo-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-0.5">Order note</p>
            <p className="text-sm text-gray-800 whitespace-pre-wrap">{order.notes}</p>
          </div>
        </div>
      )}

      {/* Lab-level delivery comment (applies to every order delivered to this lab) */}
      {order.delivery_comment?.trim() && (
        <div className="bg-emerald-50 rounded-xl border border-emerald-200 p-4 flex items-start gap-2">
          <MessageSquare size={15} className="text-emerald-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-medium text-emerald-700 uppercase tracking-wide mb-0.5">
              Delivery comment <span className="font-normal normal-case text-emerald-600">(all orders delivered to {order.lab?.name ?? 'this lab'})</span>
            </p>
            <p className="text-sm text-gray-800 whitespace-pre-wrap">{order.delivery_comment}</p>
          </div>
        </div>
      )}

      {/* Line items + delivery record */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 flex items-center gap-2">
          <PackageCheck size={16} className="text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-800">Line items</h2>
          <span className="text-xs text-gray-400">({lines.length})</span>
          {anyDelivered && <span className="ml-auto text-xs text-emerald-600 font-medium">Delivery recorded</span>}
        </div>
        <ul className="divide-y divide-gray-50">
          {lines.length === 0 && <li className="px-5 py-4 text-sm text-gray-400">No line items.</li>}
          {lines.map(li => (
            <li key={li.id} className="px-5 py-3.5">
              <div className="flex items-baseline gap-2">
                <span className="text-gray-900 font-medium">{li.reagent_item?.product_name ?? '—'}</span>
                <span className="text-xs text-gray-500 font-mono">{li.reagent_item?.item_number}</span>
                <span className="ml-auto text-sm text-gray-700 whitespace-nowrap">
                  Ordered {li.quantity} <span className="text-gray-400">{li.unit}</span>
                </span>
              </div>

              {li.delivered_at ? (
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-emerald-700">
                  <Truck size={12} className="shrink-0" />
                  <span>Delivered {li.delivered_quantity ?? li.quantity} {li.unit}</span>
                  <span className="text-emerald-400">·</span>
                  <span className="font-mono">{li.from_location || '—'}</span>
                  <span className="text-emerald-400">→</span>
                  <span className="font-mono">{li.to_location || '—'}</span>
                  {li.lot_number && (
                    <>
                      <span className="text-emerald-400">·</span>
                      <span>LOT <span className="font-mono">{li.lot_number}</span></span>
                    </>
                  )}
                  <span className="text-emerald-400">·</span>
                  <span className="text-gray-500">{fmtDateTime(li.delivered_at)}</span>
                </div>
              ) : (
                <p className="mt-1 text-xs text-gray-400">Not yet delivered.</p>
              )}

              {li.delivery_comment?.trim() && (
                <div className="mt-1.5 flex items-start gap-1.5 text-xs text-gray-600">
                  <MessageSquare size={12} className="mt-0.5 shrink-0 text-gray-400" />
                  <span className="italic">{li.delivery_comment}</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>

      {/* Planner: raise production order(s) for an insufficient-stock order */}
      {order.insufficient_stock && <InsufficientStockProduction order={order} />}
    </div>
  );
}

// ─── Planner production action (insufficient-stock flow) ─────────────────────
type CreateState =
  | { phase: 'idle' }
  | { phase: 'creating' }
  | { phase: 'done'; poId: string; poNumber: string; d365: 'sent' | 'skipped' | 'failed'; d365Detail?: string; d365ProdId?: string | null }
  | { phase: 'error'; error: string };

function InsufficientStockProduction({ order }: { order: ReagentOrder }) {
  const { profile } = useAuth();
  const isPlanner = profile?.role === 'admin' || profile?.role === 'approver';
  const lines = linesOf(order);
  const itemIds = [...new Set(lines.map(l => l.reagent_item_id).filter(Boolean))] as string[];
  const [states, setStates] = useState<Record<string, CreateState>>({});

  const { data: approvedWIs = [] } = useQuery<WorkInstruction[]>({
    queryKey: ['approved-wis-for-items', itemIds],
    enabled: isPlanner && itemIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('work_instructions')
        .select('*')
        .eq('status', 'approved')
        .in('reagent_item_id', itemIds);
      if (error) throw error;
      return (data ?? []) as WorkInstruction[];
    },
  });

  // Latest approved WI per item.
  const wiByItem = new Map<string, WorkInstruction>();
  for (const wi of approvedWIs) {
    if (!wi.reagent_item_id) continue;
    const cur = wiByItem.get(wi.reagent_item_id);
    if (!cur || wi.version > cur.version) wiByItem.set(wi.reagent_item_id, wi);
  }

  if (!isPlanner) return null;

  async function createProductionOrder(line: ReagentOrderItem) {
    const wi = line.reagent_item_id ? wiByItem.get(line.reagent_item_id) : undefined;
    if (!wi) return;
    setStates(s => ({ ...s, [line.id]: { phase: 'creating' } }));
    try {
      const stamp = new Date().toISOString().split('T')[0].replace(/-/g, '');
      const lot = `LOT-${line.reagent_item?.item_number ?? 'RX'}-${stamp}`;
      const { data: po, error } = await supabase
        .from('production_orders')
        .insert({
          work_instruction_id: wi.id,
          lot_number: lot,
          batch_size: line.quantity,
          batch_size_unit: line.unit,
          status: 'pending',
          created_by: profile!.id,
          source_reagent_order_id: order.id,
          required_by: order.requested_for_date,
          d365_create_status: 'pending',
        })
        .select('id, production_order_number')
        .single();
      if (error || !po) throw new Error(error?.message ?? 'Failed to create production order');

      // Create the production order in D365 via OData (skips when disabled).
      let d365: 'sent' | 'skipped' | 'failed' = 'failed';
      let d365Detail: string | undefined;
      let d365ProdId: string | null | undefined;
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-d365-production-order`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
          },
          body: JSON.stringify({ production_order_id: po.id }),
        });
        const body = await res.json().catch(() => ({}));
        if (body?.skipped) { d365 = 'skipped'; d365Detail = body?.error; }
        else if (res.ok && body?.success) { d365 = 'sent'; d365ProdId = body?.d365_prod_id; }
        else { d365 = 'failed'; d365Detail = body?.error ?? `HTTP ${res.status}`; }
      } catch (e) {
        d365 = 'failed';
        d365Detail = e instanceof Error ? e.message : 'D365 call failed';
      }

      setStates(s => ({ ...s, [line.id]: { phase: 'done', poId: po.id, poNumber: po.production_order_number, d365, d365Detail, d365ProdId } }));
    } catch (e) {
      setStates(s => ({ ...s, [line.id]: { phase: 'error', error: e instanceof Error ? e.message : 'Failed to create production order' } }));
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 flex items-center gap-2">
        <Factory size={16} className="text-gray-500" />
        <h2 className="text-sm font-semibold text-gray-800">Raise production</h2>
        <span className="text-xs text-gray-400">create a production order to cover the shortfall</span>
      </div>
      <ul className="divide-y divide-gray-50">
        {lines.map(line => {
          const wi = line.reagent_item_id ? wiByItem.get(line.reagent_item_id) : undefined;
          const st = states[line.id] ?? { phase: 'idle' as const };
          return (
            <li key={line.id} className="px-5 py-3.5 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-gray-900 font-medium truncate">{line.reagent_item?.product_name ?? '—'}</span>
                  <span className="text-xs text-gray-500 font-mono">{line.reagent_item?.item_number}</span>
                  <span className="text-xs text-gray-400">· {line.quantity} {line.unit}</span>
                </div>
                {wi
                  ? <p className="text-xs text-gray-400 mt-0.5">WI: {wi.title} <span className="text-indigo-500">v{wi.version}</span></p>
                  : <p className="text-xs text-amber-600 mt-0.5">No approved work instruction for this item</p>}
              </div>

              <div className="shrink-0">
                {st.phase === 'done' ? (
                  <div className="flex flex-col items-end gap-1">
                    <Link to={`/production-orders/${st.poId}`} className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline">
                      {st.poNumber} <ChevronRight size={14} />
                    </Link>
                    {st.d365 === 'sent' && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-green-700">
                        <CheckCircle size={12} /> D365{st.d365ProdId ? ` · ${st.d365ProdId}` : ' created'}
                      </span>
                    )}
                    {st.d365 === 'skipped' && (
                      <span className="text-[11px] text-yellow-700" title={st.d365Detail}>D365 integration disabled</span>
                    )}
                    {st.d365 === 'failed' && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-red-600" title={st.d365Detail}>
                        <XCircle size={12} /> D365 create failed
                      </span>
                    )}
                  </div>
                ) : st.phase === 'creating' ? (
                  <span className="inline-flex items-center gap-2 text-sm text-gray-500">
                    <Loader2 size={15} className="animate-spin" /> Creating…
                  </span>
                ) : (
                  <div className="flex flex-col items-end gap-1">
                    <button
                      onClick={() => createProductionOrder(line)}
                      disabled={!wi}
                      title={wi ? 'Create a production order from this line' : 'No approved work instruction for this item'}
                      className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Factory size={14} /> Create Production Order
                    </button>
                    {st.phase === 'error' && <span className="text-[11px] text-red-600 max-w-[14rem] text-right">{st.error}</span>}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
