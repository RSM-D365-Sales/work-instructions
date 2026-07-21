import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { StandingOrder, StandingOrderStatus } from '../types';
import { describePattern } from '../lib/recurrence';
import { formatDate, cn } from '../lib/utils';
import {
  Repeat, Plus, Search, Building2, ShoppingCart, CircleAlert, ArrowLeft,
} from 'lucide-react';

const STATUS_STYLES: Record<StandingOrderStatus, string> = {
  active:    'bg-emerald-100 text-emerald-800',
  completed: 'bg-gray-100 text-gray-600',
  cancelled: 'bg-red-100 text-red-700',
};

const STATUS_LABELS: Record<StandingOrderStatus, string> = {
  active:    'Active',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const ALL_STATUSES: StandingOrderStatus[] = ['active', 'completed', 'cancelled'];

export default function StandingOrdersListPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [search, setSearch] = useState('');
  const [hidden, setHidden] = useState<Set<StandingOrderStatus>>(new Set());

  const { data: orders = [], isLoading } = useQuery<StandingOrder[]>({
    queryKey: ['standing-orders'],
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
          requester:profiles!standing_orders_requested_by_fkey(id, full_name, email, role)
        `)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as StandingOrder[];
    },
  });

  function toggleStatus(s: StandingOrderStatus) {
    setHidden(prev => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  }

  function linesOf(o: StandingOrder) {
    return (o.items ?? []).slice().sort((a, b) => a.line_number - b.line_number);
  }

  const filtered = useMemo(() => orders.filter(o => {
    if (hidden.has(o.status)) return false;
    if (search.trim()) {
      const s = search.toLowerCase();
      const lineHay = linesOf(o)
        .map(li => `${li.reagent_item?.product_name ?? ''} ${li.reagent_item?.item_number ?? ''}`)
        .join(' ');
      const hay = `${o.standing_order_number} ${lineHay} ${o.lab?.name ?? ''} ${o.requester?.full_name ?? ''}`.toLowerCase();
      if (!hay.includes(s)) return false;
    }
    return true;
  }), [orders, hidden, search]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/reagent-orders')} className="text-gray-400 hover:text-gray-700">
            <ArrowLeft size={20} />
          </button>
          <div className="bg-blue-600 text-white p-2 rounded-lg">
            <Repeat size={20} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Standing Orders</h1>
            <p className="text-sm text-gray-500">
              Recurring reagent requests — every order in a series is raised up front
            </p>
          </div>
        </div>
        {profile?.role !== 'operator' && (
          <button
            onClick={() => navigate('/standing-orders/new')}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            <Plus size={16} />
            New Standing Order
          </button>
        )}
      </div>

      {/* Status filter pills */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wide mr-1">Show:</span>
        {ALL_STATUSES.map(status => {
          const active = !hidden.has(status);
          const count = orders.filter(o => o.status === status).length;
          return (
            <button
              key={status}
              onClick={() => toggleStatus(status)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-colors',
                active
                  ? STATUS_STYLES[status] + ' border-transparent'
                  : 'bg-white text-gray-400 border-gray-200 hover:border-gray-300'
              )}
            >
              {STATUS_LABELS[status]}
              {count > 0 && (
                <span className={cn('rounded-full px-1.5 py-0.5 text-xs font-bold', active ? 'bg-white/50' : 'bg-gray-100')}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
        <div className="relative ml-auto">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search standing orders…"
            className="pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium">Standing Order #</th>
              <th className="text-left px-4 py-2.5 font-medium">Items</th>
              <th className="text-left px-4 py-2.5 font-medium">Lab</th>
              <th className="text-left px-4 py-2.5 font-medium">Repeats</th>
              <th className="text-left px-4 py-2.5 font-medium">Runs</th>
              <th className="text-left px-4 py-2.5 font-medium">Orders</th>
              <th className="text-left px-4 py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading ? (
              <tr><td colSpan={7} className="text-center py-8 text-gray-400">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-10 text-gray-400">
                No standing orders yet.
              </td></tr>
            ) : filtered.map(o => (
              <tr key={o.id} className="hover:bg-gray-50 align-top">
                <td className="px-4 py-3 font-mono text-xs">
                  <div className="flex items-center gap-2">
                    {o.high_priority && (
                      <span title="High Priority" className="inline-flex items-center text-red-600">
                        <CircleAlert size={16} strokeWidth={2.5} />
                      </span>
                    )}
                    <button
                      onClick={() => navigate(`/standing-orders/${o.id}`)}
                      className="text-blue-600 hover:underline font-medium"
                    >
                      {o.standing_order_number}
                    </button>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <ul className="space-y-1">
                    {linesOf(o).map(li => (
                      <li key={li.id} className="flex items-baseline gap-2">
                        <span className="text-gray-900 font-medium">{li.reagent_item?.product_name ?? '—'}</span>
                        <span className="text-xs text-gray-500 font-mono">{li.reagent_item?.item_number}</span>
                        <span className="ml-auto text-xs text-gray-700 whitespace-nowrap">
                          {li.quantity} <span className="text-gray-500">{li.unit}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5 text-gray-700">
                    <Building2 size={12} className="text-gray-400" />
                    {o.lab?.name ?? '—'}
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-700">
                  {describePattern({
                    frequency: o.frequency,
                    intervalCount: o.interval_count,
                    weekdays: o.weekdays,
                    dayOfMonth: o.day_of_month,
                  })}
                </td>
                <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">
                  {o.first_order_date ? formatDate(o.first_order_date) : formatDate(o.start_date)}
                  {' → '}
                  {o.last_order_date ? formatDate(o.last_order_date) : '—'}
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1.5 text-gray-700">
                    <ShoppingCart size={12} className="text-gray-400" />
                    {o.generated_count}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_STYLES[o.status])}>
                    {STATUS_LABELS[o.status]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
