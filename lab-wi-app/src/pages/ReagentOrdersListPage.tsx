import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { ReagentOrder, ReagentOrderStatus } from '../types';
import { ShoppingCart, Plus, Search, AlertTriangle, Calendar, Building2, Truck } from 'lucide-react';
import { formatDate, cn } from '../lib/utils';

const STATUS_STYLES: Record<ReagentOrderStatus, string> = {
  pending:     'bg-yellow-100 text-yellow-800',
  approved:    'bg-blue-100 text-blue-800',
  in_progress: 'bg-indigo-100 text-indigo-800',
  fulfilled:   'bg-green-100 text-green-800',
  cancelled:   'bg-gray-100 text-gray-600',
};

const STATUS_LABELS: Record<ReagentOrderStatus, string> = {
  pending:     'Pending',
  approved:    'Approved',
  in_progress: 'In Progress',
  fulfilled:   'Fulfilled',
  cancelled:   'Cancelled',
};

export default function ReagentOrdersListPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [statusFilter, setStatusFilter] = useState<ReagentOrderStatus | 'all'>('all');
  const [search, setSearch] = useState('');

  const isLab = profile?.role === 'lab';

  const { data: orders = [], isLoading } = useQuery<ReagentOrder[]>({
    queryKey: ['reagent-orders'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reagent_orders')
        .select(`
          *,
          reagent_item:reagent_items(id, item_number, product_name, unit_of_measure),
          items:reagent_order_items(
            id, line_number, quantity, unit,
            reagent_item:reagent_items(id, item_number, product_name, unit_of_measure)
          ),
          lab:labs(id, name, warehouse_id),
          creator:profiles!reagent_orders_created_by_fkey(id, full_name, email, role),
          requester:profiles!reagent_orders_requested_by_fkey(id, full_name, email, role)
        `)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as ReagentOrder[];
    },
  });

  // Returns the line items for an order, falling back to a synthetic
  // single-item list for pre-migration-020 orders.
  function linesOf(o: ReagentOrder) {
    const items = (o.items ?? []).slice().sort((a, b) => a.line_number - b.line_number);
    if (items.length > 0) return items;
    if (o.reagent_item && o.quantity != null) {
      return [{
        id: 'legacy',
        order_id: o.id,
        line_number: 1,
        reagent_item_id: o.reagent_item.id,
        quantity: o.quantity,
        unit: o.unit ?? o.reagent_item.unit_of_measure,
        created_at: o.created_at,
        reagent_item: o.reagent_item,
      }];
    }
    return [];
  }

  const filtered = useMemo(() => {
    return orders.filter(o => {
      if (statusFilter !== 'all' && o.status !== statusFilter) return false;
      if (search.trim()) {
        const s = search.toLowerCase();
        const lineHay = linesOf(o)
          .map(li => `${li.reagent_item?.product_name ?? ''} ${li.reagent_item?.item_number ?? ''}`)
          .join(' ');
        const hay = `${o.order_number} ${lineHay} ${o.lab?.name ?? ''} ${o.requester?.full_name ?? ''}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [orders, statusFilter, search]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: orders.length };
    for (const o of orders) c[o.status] = (c[o.status] ?? 0) + 1;
    return c;
  }, [orders]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-emerald-600 text-white p-2 rounded-lg">
            <ShoppingCart size={20} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Reagent Orders</h1>
            <p className="text-sm text-gray-500">
              {isLab
                ? 'Orders from your lab to the REAGENT production lab'
                : 'Inbound reagent requests from labs'}
            </p>
          </div>
        </div>
        <button
          onClick={() => navigate('/reagent-orders/new')}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          <Plus size={16} />
          New Order
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {(['all', 'pending', 'approved', 'in_progress', 'fulfilled', 'cancelled'] as const).map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={cn(
              'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
              statusFilter === s
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            )}
          >
            {s === 'all' ? 'All' : STATUS_LABELS[s]}
            <span className={cn(
              'ml-1.5 inline-flex items-center justify-center px-1.5 py-0 rounded-full text-[10px]',
              statusFilter === s ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-600'
            )}>
              {counts[s] ?? 0}
            </span>
          </button>
        ))}
        <div className="relative ml-auto">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search orders…"
            className="pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium">Order #</th>
              <th className="text-left px-4 py-2.5 font-medium">Items</th>
              <th className="text-left px-4 py-2.5 font-medium">Lab</th>
              <th className="text-left px-4 py-2.5 font-medium">Requester</th>
              <th className="text-left px-4 py-2.5 font-medium">Needed By</th>
              <th className="text-left px-4 py-2.5 font-medium">Status</th>
              <th className="text-left px-4 py-2.5 font-medium">Transfer Order</th>
              <th className="text-left px-4 py-2.5 font-medium">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading ? (
              <tr><td colSpan={8} className="text-center py-8 text-gray-400">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-10 text-gray-400">
                No reagent orders found.
              </td></tr>
            ) : filtered.map(o => {
              const orderLines = linesOf(o);
              return (
              <tr key={o.id} className="hover:bg-gray-50 align-top">
                <td className="px-4 py-3 font-mono text-xs">
                  <div className="flex items-center gap-2">
                    {o.high_priority && (
                      <span title="High Priority" className="inline-flex items-center gap-0.5 text-red-600">
                        <AlertTriangle size={12} />
                      </span>
                    )}
                    {o.order_number}
                  </div>
                </td>
                <td className="px-4 py-3">
                  {orderLines.length === 0 ? (
                    <span className="text-xs text-gray-400">—</span>
                  ) : (
                    <ul className="space-y-1">
                      {orderLines.map(li => (
                        <li key={li.id} className="flex items-baseline gap-2">
                          <span className="text-gray-900 font-medium">{li.reagent_item?.product_name ?? '—'}</span>
                          <span className="text-xs text-gray-500 font-mono">{li.reagent_item?.item_number}</span>
                          <span className="ml-auto text-xs text-gray-700 whitespace-nowrap">
                            {li.quantity} <span className="text-gray-500">{li.unit}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5 text-gray-700">
                    <Building2 size={12} className="text-gray-400" />
                    {o.lab?.name ?? '—'}
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-700">{o.requester?.full_name ?? '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5 text-gray-700">
                    <Calendar size={12} className="text-gray-400" />
                    {formatDate(o.requested_for_date)}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_STYLES[o.status])}>
                    {STATUS_LABELS[o.status]}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {o.transfer_order_number ? (
                    <div className="flex items-center gap-1.5" title={o.transfer_order_error ?? ''}>
                      <Truck size={12} className={
                        o.transfer_order_status === 'created' ? 'text-green-600'
                        : o.transfer_order_status === 'failed' ? 'text-red-600'
                        : 'text-gray-400'
                      } />
                      <span className="font-mono text-xs">{o.transfer_order_number}</span>
                    </div>
                  ) : o.transfer_order_status === 'failed' ? (
                    <span title={o.transfer_order_error ?? ''} className="text-xs text-red-600">Failed</span>
                  ) : o.transfer_order_status === 'skipped' ? (
                    <span className="text-xs text-gray-400">Skipped</span>
                  ) : (
                    <span className="text-xs text-gray-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-gray-500">{formatDate(o.created_at)}</td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
