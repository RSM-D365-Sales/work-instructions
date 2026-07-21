import type { ReactNode } from 'react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type {
  StandingOrder, StandingOrderStatus, ReagentOrder, ReagentOrderStatus,
} from '../types';
import { describePattern, todayISO } from '../lib/recurrence';
import { cn, formatDate } from '../lib/utils';
import {
  ArrowLeft, Repeat, Building2, User, CalendarDays, CircleAlert, Paperclip,
  ShoppingCart, Ban, Loader2, AlertTriangle,
} from 'lucide-react';

const SO_STATUS_STYLES: Record<StandingOrderStatus, string> = {
  active:    'bg-emerald-100 text-emerald-800',
  completed: 'bg-gray-100 text-gray-600',
  cancelled: 'bg-red-100 text-red-700',
};
const SO_STATUS_LABELS: Record<StandingOrderStatus, string> = {
  active: 'Active', completed: 'Completed', cancelled: 'Cancelled',
};

const RO_STATUS_STYLES: Record<ReagentOrderStatus, string> = {
  pending:     'bg-yellow-100 text-yellow-800',
  in_progress: 'bg-indigo-100 text-indigo-800',
  fulfilled:   'bg-green-100 text-green-800',
  cancelled:   'bg-gray-100 text-gray-600',
};
const RO_STATUS_LABELS: Record<ReagentOrderStatus, string> = {
  pending: 'Pending', in_progress: 'In Progress', fulfilled: 'Fulfilled', cancelled: 'Cancelled',
};

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-0.5">{label}</p>
      <div className="text-sm text-gray-900">{children}</div>
    </div>
  );
}

export default function StandingOrderDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { profile } = useAuth();

  const [cancelling, setCancelling] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [error, setError] = useState('');
  const [cancelResult, setCancelResult] = useState<number | null>(null);

  const { data: so, isLoading } = useQuery<StandingOrder | null>({
    queryKey: ['standing-order', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('standing_orders')
        .select(`
          *,
          items:standing_order_items(
            id, line_number, quantity, unit,
            reagent_item:reagent_items(id, item_number, product_name, unit_of_measure)
          ),
          lab:labs(id, name, warehouse_id),
          creator:profiles!standing_orders_created_by_fkey(id, full_name, email, role),
          requester:profiles!standing_orders_requested_by_fkey(id, full_name, email, role)
        `)
        .eq('id', id!)
        .single();
      if (error) throw error;
      return data as StandingOrder;
    },
  });

  // The orders this series actually created — the source of truth for what
  // happened, as opposed to the pattern that described it.
  const { data: generated = [] } = useQuery<ReagentOrder[]>({
    queryKey: ['standing-order-orders', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reagent_orders')
        .select('id, order_number, requested_for_date, status, standing_order_seq, transfer_order_number, transfer_order_status')
        .eq('standing_order_id', id!)
        .order('requested_for_date', { ascending: true });
      if (error) throw error;
      return data as ReagentOrder[];
    },
  });

  async function handleCancel() {
    setCancelling(true);
    setError('');
    const { data, error: rpcErr } = await supabase.rpc('cancel_standing_order', {
      p_standing_order_id: id!,
    });
    setCancelling(false);
    setConfirmCancel(false);
    if (rpcErr) {
      setError(rpcErr.message || 'Could not cancel the standing order');
      return;
    }
    qc.invalidateQueries({ queryKey: ['standing-order', id] });
    qc.invalidateQueries({ queryKey: ['standing-order-orders', id] });
    qc.invalidateQueries({ queryKey: ['standing-orders'] });
    qc.invalidateQueries({ queryKey: ['reagent-orders'] });
    // The RPC returns how many upcoming orders it cancelled.
    setCancelResult(typeof data === 'number' ? data : 0);
  }

  if (isLoading) {
    return <div className="max-w-4xl mx-auto py-12 text-center text-gray-400">Loading standing order…</div>;
  }
  if (!so) {
    return (
      <div className="max-w-4xl mx-auto">
        <p className="text-gray-500">Standing order not found.</p>
        <button onClick={() => navigate('/standing-orders')} className="mt-3 text-blue-600 hover:underline text-sm">
          ← Back to Standing Orders
        </button>
      </div>
    );
  }

  const lines = (so.items ?? []).slice().sort((a, b) => a.line_number - b.line_number);
  const today = todayISO();
  const upcoming = generated.filter(o => o.requested_for_date >= today && o.status === 'pending');
  const canCancel =
    so.status === 'active' &&
    (profile?.role !== 'operator');

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/standing-orders')} className="text-gray-400 hover:text-gray-700">
          <ArrowLeft size={20} />
        </button>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-xl font-bold text-gray-900 font-mono">{so.standing_order_number}</h1>
          <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', SO_STATUS_STYLES[so.status])}>
            {SO_STATUS_LABELS[so.status]}
          </span>
          {so.high_priority && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600">
              <CircleAlert size={14} strokeWidth={2.5} /> High priority
            </span>
          )}
        </div>
        {canCancel && (
          <button
            onClick={() => setConfirmCancel(true)}
            className="ml-auto flex items-center gap-2 border border-red-200 text-red-700 px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-red-50"
          >
            <Ban size={15} />
            Cancel Series
          </button>
        )}
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
      )}

      {cancelResult !== null && (
        <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
          <Ban size={15} />
          Series cancelled — {cancelResult} upcoming order{cancelResult === 1 ? '' : 's'} cancelled.
        </div>
      )}

      {/* Pattern + metadata */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        <div className="flex items-center gap-2">
          <Repeat size={18} className="text-blue-600" />
          <h2 className="text-sm font-semibold text-gray-900">
            {describePattern({
              frequency: so.frequency,
              intervalCount: so.interval_count,
              weekdays: so.weekdays,
              dayOfMonth: so.day_of_month,
            })}
          </h2>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Meta label="Lab">
            <span className="inline-flex items-center gap-1.5">
              <Building2 size={13} className="text-gray-400" />
              {so.lab?.name ?? '—'}
            </span>
          </Meta>
          <Meta label="Requester">
            <span className="inline-flex items-center gap-1.5">
              <User size={13} className="text-gray-400" />
              {so.requester?.full_name ?? '—'}
            </span>
          </Meta>
          <Meta label="Runs">
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays size={13} className="text-gray-400" />
              {so.first_order_date ? formatDate(so.first_order_date) : formatDate(so.start_date)}
              {' → '}
              {so.last_order_date ? formatDate(so.last_order_date) : '—'}
            </span>
          </Meta>
          <Meta label="Ends">
            {so.end_mode === 'date'
              ? `On ${so.end_date ? formatDate(so.end_date) : '—'}`
              : `After ${so.occurrence_count} deliveries`}
          </Meta>
        </div>

        {so.notes?.trim() && (
          <div className="flex items-start gap-2 text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg p-3">
            <Paperclip size={14} className="mt-0.5 shrink-0 text-gray-400" />
            <span>{so.notes}</span>
          </div>
        )}
      </div>

      {/* Template lines */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
          <h2 className="text-sm font-semibold text-gray-900">Ordered Each Time</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-white text-xs uppercase text-gray-500">
            <tr>
              <th className="text-left px-4 py-2 font-medium w-12">#</th>
              <th className="text-left px-4 py-2 font-medium">Item</th>
              <th className="text-right px-4 py-2 font-medium">Quantity</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {lines.map(li => (
              <tr key={li.id}>
                <td className="px-4 py-2.5 text-gray-400 text-xs">{li.line_number}</td>
                <td className="px-4 py-2.5">
                  <span className="text-gray-900 font-medium">{li.reagent_item?.product_name ?? '—'}</span>
                  <span className="ml-2 text-xs text-gray-500 font-mono">{li.reagent_item?.item_number}</span>
                </td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap">
                  {li.quantity} <span className="text-gray-500 text-xs">{li.unit}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Generated orders */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center gap-2">
          <ShoppingCart size={15} className="text-gray-400" />
          <h2 className="text-sm font-semibold text-gray-900">
            Generated Orders <span className="font-normal text-gray-400">({generated.length})</span>
          </h2>
          {upcoming.length > 0 && (
            <span className="ml-auto text-xs text-gray-500">{upcoming.length} still upcoming</span>
          )}
        </div>
        <div className="overflow-x-auto max-h-[28rem] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-white text-xs uppercase text-gray-500 sticky top-0">
              <tr className="border-b border-gray-100">
                <th className="text-left px-4 py-2 font-medium w-12">#</th>
                <th className="text-left px-4 py-2 font-medium">Order</th>
                <th className="text-left px-4 py-2 font-medium">Needed By</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {generated.length === 0 ? (
                <tr><td colSpan={4} className="text-center py-8 text-gray-400">No orders found for this series.</td></tr>
              ) : generated.map(o => (
                <tr key={o.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 text-gray-400 text-xs">{o.standing_order_seq ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <button
                      onClick={() => navigate(`/reagent-orders/${o.id}`)}
                      className="text-blue-600 hover:underline font-mono text-xs font-medium"
                    >
                      {o.order_number}
                    </button>
                  </td>
                  <td className="px-4 py-2.5 text-gray-700">{formatDate(o.requested_for_date)}</td>
                  <td className="px-4 py-2.5">
                    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', RO_STATUS_STYLES[o.status])}>
                      {RO_STATUS_LABELS[o.status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cancel confirmation */}
      {confirmCancel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-5 space-y-4">
            <div className="flex items-center gap-2">
              <AlertTriangle size={20} className="text-red-600" />
              <h2 className="font-bold text-gray-900">Cancel this standing order?</h2>
            </div>
            <p className="text-sm text-gray-700">
              {upcoming.length > 0 ? (
                <>
                  <span className="font-semibold">{upcoming.length}</span> upcoming order
                  {upcoming.length === 1 ? '' : 's'} will be cancelled. Orders already in progress,
                  delivered, or past their needed-by date are left untouched.
                </>
              ) : (
                <>The series will be marked cancelled. No upcoming orders remain to cancel.</>
              )}
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleCancel}
                disabled={cancelling}
                className="flex-1 flex items-center justify-center gap-2 bg-red-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {cancelling && <Loader2 size={14} className="animate-spin" />}
                {cancelling ? 'Cancelling…' : 'Cancel Series'}
              </button>
              <button
                onClick={() => setConfirmCancel(false)}
                disabled={cancelling}
                className="flex-1 border border-gray-300 text-gray-700 py-2 rounded-lg text-sm font-medium hover:bg-gray-50"
              >
                Keep It
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
