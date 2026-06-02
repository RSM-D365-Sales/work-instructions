import { useState, useMemo, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { ReagentOrder, ReagentOrderStatus } from '../types';
import { ShoppingCart, Plus, Search, AlertTriangle, Calendar, Building2, Truck } from 'lucide-react';
import { formatDate, cn } from '../lib/utils';

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

const ALL_STATUSES: ReagentOrderStatus[] = ['pending', 'in_progress', 'fulfilled', 'cancelled'];

// Orders that can still be delivered.
const DELIVERABLE: ReagentOrderStatus[] = ['pending', 'in_progress'];

type GroupBy = 'none' | 'lab' | 'date';

// Persisted UI preferences ----------------------------------------------------
const HIDDEN_KEY = 'reagentOrders.hiddenStatuses';
const GROUP_KEY  = 'reagentOrders.groupBy';

function loadHiddenStatuses(): Set<ReagentOrderStatus> {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY);
    if (raw) return new Set(JSON.parse(raw) as ReagentOrderStatus[]);
  } catch { /* ignore */ }
  // Default: show Pending + In Progress (hide the rest).
  return new Set<ReagentOrderStatus>(['fulfilled', 'cancelled']);
}

function loadGroupBy(): GroupBy {
  try {
    const raw = localStorage.getItem(GROUP_KEY) as GroupBy | null;
    if (raw === 'lab' || raw === 'date' || raw === 'none') return raw;
  } catch { /* ignore */ }
  return 'none';
}

export default function ReagentOrdersListPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hiddenStatuses, setHiddenStatuses] = useState<Set<ReagentOrderStatus>>(loadHiddenStatuses);
  const [groupBy, setGroupBy] = useState<GroupBy>(loadGroupBy);

  const isLab = profile?.role === 'lab';
  const canDeliver = !isLab;  // central-lab staff (admin/author/approver/operator) deliver to labs
  const totalCols = canDeliver ? 9 : 8;

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // Multi-select status toggle (remembers the choice).
  function toggleStatus(status: ReagentOrderStatus) {
    setHiddenStatuses(prev => {
      const next = new Set(prev);
      next.has(status) ? next.delete(status) : next.add(status);
      try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }

  function changeGroupBy(g: GroupBy) {
    setGroupBy(g);
    try { localStorage.setItem(GROUP_KEY, g); } catch { /* ignore */ }
  }

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
            delivered_quantity, from_location, to_location, lot_number, delivered_at,
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
      if (hiddenStatuses.has(o.status)) return false;
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
  }, [orders, hiddenStatuses, search]);

  // Build groups when grouping is active.
  const groups = useMemo(() => {
    if (groupBy === 'none') return null;
    const map = new Map<string, { key: string; label: string; sortKey: string; orders: ReagentOrder[] }>();
    for (const o of filtered) {
      let key: string, label: string, sortKey: string;
      if (groupBy === 'lab') {
        key = o.lab?.id ?? 'none';
        label = o.lab?.name ?? 'Unassigned lab';
        sortKey = label.toLowerCase();
      } else {
        key = o.requested_for_date ?? 'none';
        label = o.requested_for_date ? formatDate(o.requested_for_date) : 'No date';
        sortKey = o.requested_for_date ?? '9999-99-99';
      }
      let g = map.get(key);
      if (!g) { g = { key, label, sortKey, orders: [] }; map.set(key, g); }
      g.orders.push(o);
    }
    return [...map.values()].sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  }, [filtered, groupBy]);

  // Selection works against the currently visible, still-deliverable orders.
  const deliverableFiltered = useMemo(
    () => filtered.filter(o => DELIVERABLE.includes(o.status)),
    [filtered]
  );
  const selectedDeliverable = useMemo(
    () => deliverableFiltered.filter(o => selected.has(o.id)),
    [deliverableFiltered, selected]
  );
  const allDeliverableSelected =
    deliverableFiltered.length > 0 && deliverableFiltered.every(o => selected.has(o.id));

  function toggleSelectAll() {
    setSelected(prev => {
      if (deliverableFiltered.every(o => prev.has(o.id))) {
        const next = new Set(prev);
        deliverableFiltered.forEach(o => next.delete(o.id));
        return next;
      }
      return new Set([...prev, ...deliverableFiltered.map(o => o.id)]);
    });
  }

  function startDelivery() {
    if (selectedDeliverable.length === 0) return;
    navigate(`/reagent-orders/deliver?orders=${selectedDeliverable.map(o => o.id).join(',')}`);
  }

  function renderOrderRow(o: ReagentOrder) {
    const orderLines = linesOf(o);
    const deliverable = DELIVERABLE.includes(o.status);
    return (
      <tr key={o.id} className={cn('hover:bg-gray-50 align-top', selected.has(o.id) && 'bg-emerald-50/50')}>
        {canDeliver && (
          <td className="px-4 py-3">
            {deliverable && (
              <input
                type="checkbox"
                checked={selected.has(o.id)}
                onChange={() => toggleSelect(o.id)}
                className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
              />
            )}
          </td>
        )}
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
            <ul className="space-y-1.5">
              {orderLines.map(li => (
                <li key={li.id}>
                  <div className="flex items-baseline gap-2">
                    <span className="text-gray-900 font-medium">{li.reagent_item?.product_name ?? '—'}</span>
                    <span className="text-xs text-gray-500 font-mono">{li.reagent_item?.item_number}</span>
                    <span className="ml-auto text-xs text-gray-700 whitespace-nowrap">
                      {li.quantity} <span className="text-gray-500">{li.unit}</span>
                    </span>
                  </div>
                  {li.delivered_at && (
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-emerald-700">
                      <Truck size={11} className="shrink-0" />
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
                    </div>
                  )}
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
  }

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
        <div className="flex items-center gap-2">
          {canDeliver && selectedDeliverable.length > 0 && (
            <button
              onClick={startDelivery}
              className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700"
            >
              <Truck size={16} />
              Deliver Selected ({selectedDeliverable.length})
            </button>
          )}
          <button
            onClick={() => navigate('/reagent-orders/new')}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            <Plus size={16} />
            New Order
          </button>
        </div>
      </div>

      {/* Status filter pills (multi-select; remembers your choice) */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wide mr-1">Show:</span>
        {ALL_STATUSES.map(status => {
          const active = !hiddenStatuses.has(status);
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
      </div>

      {/* Group-by + search */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">Group by:</span>
        <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
          {(['none', 'lab', 'date'] as const).map((g, i) => (
            <button
              key={g}
              onClick={() => changeGroupBy(g)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors',
                i > 0 && 'border-l border-gray-200',
                groupBy === g ? 'bg-blue-50 text-blue-700' : 'bg-white text-gray-600 hover:bg-gray-50'
              )}
            >
              {g === 'lab' && <Building2 size={13} />}
              {g === 'date' && <Calendar size={13} />}
              {g === 'none' ? 'None' : g === 'lab' ? 'Lab' : 'Needed By'}
            </button>
          ))}
        </div>
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
              {canDeliver && (
                <th className="px-4 py-2.5 w-10">
                  <input
                    type="checkbox"
                    checked={allDeliverableSelected}
                    onChange={toggleSelectAll}
                    disabled={deliverableFiltered.length === 0}
                    title="Select all deliverable orders"
                    className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 disabled:opacity-30"
                  />
                </th>
              )}
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
              <tr><td colSpan={totalCols} className="text-center py-8 text-gray-400">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={totalCols} className="text-center py-10 text-gray-400">
                No reagent orders found.
              </td></tr>
            ) : groups ? (
              groups.map(g => (
                <Fragment key={g.key}>
                  <tr className="bg-gray-50/80">
                    <td colSpan={totalCols} className="px-4 py-2 border-t border-gray-200">
                      <div className="flex items-center gap-2 text-xs font-semibold text-gray-600">
                        {groupBy === 'lab'
                          ? <Building2 size={13} className="text-gray-400" />
                          : <Calendar size={13} className="text-gray-400" />}
                        {g.label}
                        <span className="font-normal text-gray-400">({g.orders.length})</span>
                      </div>
                    </td>
                  </tr>
                  {g.orders.map(renderOrderRow)}
                </Fragment>
              ))
            ) : (
              filtered.map(renderOrderRow)
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
