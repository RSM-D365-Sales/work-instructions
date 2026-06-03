import { useState, useMemo, Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import {
  ClipboardList, PlayCircle, CheckCircle, Clock, FlaskConical,
  ShoppingCart, Plus, Calendar, Building2, Truck, AlertTriangle, Paperclip, CircleAlert,
} from 'lucide-react';
import ProductionGantt from '../components/ProductionGantt';
import type { ReagentOrder, ReagentOrderStatus } from '../types';
import { formatDate, cn } from '../lib/utils';

export default function DashboardPage() {
  const { profile } = useAuth();
  // The Lab Scientist gets a focused, order-only dashboard scoped to their lab.
  if (profile?.role === 'lab') return <LabDashboard />;
  return <StandardDashboard />;
}

function StandardDashboard() {
  const { profile } = useAuth();

  const { data: wiStats } = useQuery({
    queryKey: ['wi-stats'],
    queryFn: async () => {
      const { data } = await supabase
        .from('work_instructions')
        .select('status');
      const counts = { draft: 0, pending_review: 0, approved: 0, rejected: 0 };
      data?.forEach(wi => { counts[wi.status as keyof typeof counts]++ });
      return counts;
    },
  });

  const { data: poStats } = useQuery({
    queryKey: ['po-stats'],
    queryFn: async () => {
      const { data } = await supabase
        .from('production_orders')
        .select('status');
      const counts = { pending: 0, in_progress: 0, awaiting_qc: 0, completed: 0, failed: 0 };
      data?.forEach(po => {
        const k = po.status as keyof typeof counts;
        if (k in counts) counts[k]++;
      });
      return counts;
    },
  });

  const { data: recentOrders } = useQuery({
    queryKey: ['recent-orders'],
    queryFn: async () => {
      const { data } = await supabase
        .from('production_orders')
        .select('*, work_instruction:work_instructions(title, product_name)')
        .order('created_at', { ascending: false })
        .limit(5);
      return data ?? [];
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 text-sm mt-1">
          Welcome back, {profile?.full_name || 'User'} — <span className="capitalize">{profile?.role}</span>
        </p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard
          icon={<ClipboardList size={20} className="text-blue-600" />}
          label="Approved WIs"
          value={wiStats?.approved ?? 0}
          bg="bg-blue-50"
        />
        <StatCard
          icon={<Clock size={20} className="text-yellow-600" />}
          label="Pending Review"
          value={wiStats?.pending_review ?? 0}
          bg="bg-yellow-50"
        />
        <StatCard
          icon={<PlayCircle size={20} className="text-purple-600" />}
          label="Active Orders"
          value={poStats?.in_progress ?? 0}
          bg="bg-purple-50"
        />
        <StatCard
          icon={<FlaskConical size={20} className="text-amber-600" />}
          label="Awaiting QC"
          value={poStats?.awaiting_qc ?? 0}
          bg="bg-amber-50"
        />
        <StatCard
          icon={<CheckCircle size={20} className="text-green-600" />}
          label="Completed Orders"
          value={poStats?.completed ?? 0}
          bg="bg-green-50"
        />
      </div>

      {/* Production schedule (Gantt) */}
      <ProductionGantt />

      {/* Quick actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {(profile?.role === 'author') && (
          <Link
            to="/work-instructions/new"
            className="flex items-center gap-4 p-5 bg-white rounded-xl border border-gray-200 hover:border-blue-300 hover:shadow-sm transition-all"
          >
            <div className="bg-blue-100 p-3 rounded-lg">
              <ClipboardList size={22} className="text-blue-600" />
            </div>
            <div>
              <p className="font-semibold text-gray-900">New Work Instruction</p>
              <p className="text-sm text-gray-500">Author a new production procedure</p>
            </div>
          </Link>
        )}
        <Link
          to="/production-orders/new"
          className="flex items-center gap-4 p-5 bg-white rounded-xl border border-gray-200 hover:border-green-300 hover:shadow-sm transition-all"
        >
          <div className="bg-green-100 p-3 rounded-lg">
            <PlayCircle size={22} className="text-green-600" />
          </div>
          <div>
            <p className="font-semibold text-gray-900">New Production Order</p>
            <p className="text-sm text-gray-500">Start a production run</p>
          </div>
        </Link>
      </div>

      {/* Recent production orders */}
      {recentOrders && recentOrders.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="p-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Recent Production Orders</h2>
            <Link to="/production-orders" className="text-sm text-blue-600 hover:underline">View all</Link>
          </div>
          <div className="divide-y divide-gray-50">
            {recentOrders.map(order => (
              <Link
                key={order.id}
                to={`/production-orders/${order.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
              >
                <div>
                  <p className="text-sm font-medium text-gray-900">{order.lot_number}</p>
                  <p className="text-xs text-gray-500">{order.work_instruction?.product_name}</p>
                </div>
                <POStatusBadge status={order.status} />
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, bg }: { icon: React.ReactNode; label: string; value: number; bg: string }) {
  return (
    <div className={`${bg} rounded-xl p-4 flex items-center gap-3`}>
      <div className="shrink-0">{icon}</div>
      <div>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
        <p className="text-xs text-gray-600">{label}</p>
      </div>
    </div>
  );
}

function POStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: 'bg-gray-100 text-gray-600',
    in_progress: 'bg-blue-100 text-blue-700',
    awaiting_qc: 'bg-amber-100 text-amber-700',
    completed: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
    cancelled: 'bg-gray-100 text-gray-500',
  };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${map[status] ?? ''}`}>
      {status === 'awaiting_qc' ? 'Awaiting QC' : status.replace('_', ' ')}
    </span>
  );
}

// ─── Lab Scientist dashboard ─────────────────────────────────────────────────
// A focused, order-only view scoped to the user's default lab — no production /
// authoring / KPI content from the standard dashboard.
const RO_STATUS_STYLES: Record<ReagentOrderStatus, string> = {
  pending:     'bg-yellow-100 text-yellow-800',
  in_progress: 'bg-indigo-100 text-indigo-800',
  fulfilled:   'bg-green-100 text-green-800',
  cancelled:   'bg-gray-100 text-gray-600',
};
const RO_STATUS_LABELS: Record<ReagentOrderStatus, string> = {
  pending:     'Pending',
  in_progress: 'In Progress',
  fulfilled:   'Fulfilled',
  cancelled:   'Cancelled',
};

/** Sort reagent orders by needed-by date ascending (soonest first; no-date last),
 *  then newest-created as a tiebreaker. */
function byNeededBy(a: ReagentOrder, b: ReagentOrder): number {
  const ra = a.requested_for_date, rb = b.requested_for_date;
  if (ra && rb) { if (ra !== rb) return ra < rb ? -1 : 1; }
  else if (ra) return -1;
  else if (rb) return 1;
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
}

function LabDashboard() {
  const { profile } = useAuth();
  const labId = profile?.default_lab_id ?? null;

  const { data: lab } = useQuery({
    queryKey: ['lab', labId],
    enabled: !!labId,
    queryFn: async () => {
      const { data } = await supabase.from('labs').select('id, name, warehouse_id').eq('id', labId!).single();
      return data;
    },
  });

  const { data: orders = [], isLoading } = useQuery<ReagentOrder[]>({
    queryKey: ['lab-reagent-orders', labId],
    enabled: !!labId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reagent_orders')
        .select(`
          *,
          items:reagent_order_items(
            id, line_number, quantity, unit,
            delivered_quantity, from_location, to_location, lot_number, delivered_at,
            reagent_item:reagent_items(id, item_number, product_name, unit_of_measure)
          ),
          reagent_item:reagent_items(id, item_number, product_name, unit_of_measure),
          lab:labs(id, name, warehouse_id)
        `)
        .eq('lab_id', labId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as ReagentOrder[];
    },
  });

  function linesOf(o: ReagentOrder) {
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

  const counts = orders.reduce((acc, o) => {
    acc[o.status] = (acc[o.status] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const [groupByDay, setGroupByDay] = useState(false);
  // Always needed-by sorted; optionally bucketed by needed-by day.
  const sorted = useMemo(() => [...orders].sort(byNeededBy), [orders]);
  const dayGroups = useMemo(() => {
    const map = new Map<string, ReagentOrder[]>();
    for (const o of sorted) {
      const key = o.requested_for_date ?? '__none__';
      const arr = map.get(key);
      if (arr) arr.push(o); else map.set(key, [o]);
    }
    return [...map.entries()]; // insertion order = needed-by ascending
  }, [sorted]);

  function renderRow(o: ReagentOrder) {
    const lines = linesOf(o);
    const delivered = lines.some(li => li.delivered_at);
    return (
      <tr key={o.id} className="hover:bg-gray-50 align-top">
        <td className="px-4 py-3 font-mono text-xs">
          <div className="flex items-center gap-2">
            {o.high_priority && <CircleAlert size={18} strokeWidth={2.5} className="text-red-600" aria-label="High priority" />}
            {o.order_number}
            {o.notes?.trim() && (
              <span title={o.notes} className="inline-flex text-indigo-600 cursor-help" aria-label="Order note">
                <Paperclip size={13} />
              </span>
            )}
          </div>
        </td>
        <td className="px-4 py-3">
          {lines.length === 0 ? <span className="text-xs text-gray-400">—</span> : (
            <ul className="space-y-0.5">
              {lines.map(li => (
                <li key={li.id} className="flex items-baseline gap-2">
                  <span className="text-gray-900 font-medium">{li.reagent_item?.product_name ?? '—'}</span>
                  <span className="text-xs text-gray-500 font-mono">{li.reagent_item?.item_number}</span>
                  <span className="ml-auto text-xs text-gray-700 whitespace-nowrap">{li.quantity} <span className="text-gray-500">{li.unit}</span></span>
                </li>
              ))}
            </ul>
          )}
        </td>
        <td className="px-4 py-3">
          <span className="flex items-center gap-1.5 text-gray-700">
            <Calendar size={12} className="text-gray-400" />
            {formatDate(o.requested_for_date)}
          </span>
        </td>
        <td className="px-4 py-3">
          <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', RO_STATUS_STYLES[o.status])}>
            {RO_STATUS_LABELS[o.status]}
          </span>
        </td>
        <td className="px-4 py-3">
          {delivered ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700">
              <Truck size={12} /> Delivered
            </span>
          ) : (
            <span className="text-xs text-gray-400">—</span>
          )}
        </td>
      </tr>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-sky-600 text-white p-2.5 rounded-xl">
            <ShoppingCart size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">My Reagent Orders</h1>
            <p className="text-sm text-gray-500 mt-0.5 flex items-center gap-1.5">
              {lab
                ? <><Building2 size={13} className="text-gray-400" /> {lab.name}{lab.warehouse_id ? ` · ${lab.warehouse_id}` : ''}</>
                : 'Orders for your lab'}
            </p>
          </div>
        </div>
        {labId && (
          <Link
            to="/reagent-orders/new"
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            <Plus size={16} /> New Order
          </Link>
        )}
      </div>

      {/* No default lab → prompt to set one */}
      {!labId ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 text-sm text-amber-800 flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">No default lab selected</p>
            <p className="mt-0.5">Choose your lab in the selector at the bottom of the sidebar to see and place reagent orders.</p>
          </div>
        </div>
      ) : (
        <>
          {/* Status summary + grouping toggle */}
          <div className="flex flex-wrap items-center gap-2">
            {(['pending', 'in_progress', 'fulfilled'] as ReagentOrderStatus[]).map(s => (
              <span key={s} className={cn('inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium', RO_STATUS_STYLES[s])}>
                {RO_STATUS_LABELS[s]}
                <span className="font-bold">{counts[s] ?? 0}</span>
              </span>
            ))}
            <button
              onClick={() => setGroupByDay(v => !v)}
              className={cn(
                'ml-auto inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-colors',
                groupByDay ? 'bg-blue-600 text-white border-transparent' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              )}
              title="Group orders by needed-by day"
            >
              <Calendar size={13} /> {groupByDay ? 'Grouped by day' : 'Group by day'}
            </button>
          </div>
          <p className="text-xs text-gray-400 -mt-3">Sorted by needed-by date.</p>

          {/* Orders list */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium">Order #</th>
                  <th className="text-left px-4 py-2.5 font-medium">Items</th>
                  <th className="text-left px-4 py-2.5 font-medium">Needed By</th>
                  <th className="text-left px-4 py-2.5 font-medium">Status</th>
                  <th className="text-left px-4 py-2.5 font-medium">Delivery</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {isLoading ? (
                  <tr><td colSpan={5} className="text-center py-8 text-gray-400">Loading…</td></tr>
                ) : orders.length === 0 ? (
                  <tr><td colSpan={5} className="text-center py-12 text-gray-400">
                    <ShoppingCart size={28} className="mx-auto text-gray-300 mb-2" />
                    No reagent orders yet.
                    <div className="mt-2">
                      <Link to="/reagent-orders/new" className="text-blue-600 hover:underline">Place your first order</Link>
                    </div>
                  </td></tr>
                ) : groupByDay ? (
                  dayGroups.map(([key, rows]) => (
                    <Fragment key={key}>
                      <tr className="bg-gray-50/70">
                        <td colSpan={5} className="px-4 py-2 text-xs font-semibold text-gray-600">
                          <span className="inline-flex items-center gap-1.5">
                            <Calendar size={12} className="text-gray-400" />
                            {key === '__none__' ? 'No needed-by date' : formatDate(key)}
                            <span className="font-normal text-gray-400">· {rows.length} order{rows.length === 1 ? '' : 's'}</span>
                          </span>
                        </td>
                      </tr>
                      {rows.map(renderRow)}
                    </Fragment>
                  ))
                ) : (
                  sorted.map(renderRow)
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
