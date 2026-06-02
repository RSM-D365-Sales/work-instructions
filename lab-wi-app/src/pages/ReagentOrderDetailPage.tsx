import type { ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { ReagentOrder, ReagentOrderItem, ReagentOrderStatus } from '../types';
import { cn, formatDate } from '../lib/utils';
import {
  ArrowLeft, Building2, Calendar, Truck, MessageSquare, CircleAlert, PackageCheck, User, Paperclip,
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
    </div>
  );
}
