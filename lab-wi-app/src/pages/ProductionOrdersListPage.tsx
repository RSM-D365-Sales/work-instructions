import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { ProductionOrder, Profile } from '../types';
import { Plus, ChevronRight, Ban, Trash2, Check } from 'lucide-react';
import { formatDate } from '../lib/utils';
import { cn } from '../lib/utils';

/* ── Date helpers ─────────────────────────────────────────────── */

/** Convert an ISO timestamp to a `datetime-local`-formatted string. */
function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
         `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/** Format a date-only value (YYYY-MM-DD) without UTC-shifting it a day. */
function formatDateOnly(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const d = new Date(`${dateStr}T00:00:00`);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

const ALL_STATUSES = ['pending', 'in_progress', 'completed', 'failed', 'cancelled'] as const;

const STATUS_STYLES: Record<string, string> = {
  pending:     'bg-gray-100 text-gray-600',
  in_progress: 'bg-blue-100 text-blue-700',
  completed:   'bg-green-100 text-green-700',
  failed:      'bg-red-100 text-red-700',
  cancelled:   'bg-gray-100 text-gray-400',
};

const STATUS_LABELS: Record<string, string> = {
  pending:     'Pending',
  in_progress: 'In Progress',
  completed:   'Completed',
  failed:      'Failed',
  cancelled:   'Cancelled',
};

export default function ProductionOrdersListPage() {
  const [hiddenStatuses, setHiddenStatuses] = useState<Set<string>>(new Set(['completed', 'cancelled']));
  const { profile } = useAuth();
  const qc = useQueryClient();

  function toggleStatus(status: string) {
    setHiddenStatuses(prev => {
      const next = new Set(prev);
      next.has(status) ? next.delete(status) : next.add(status);
      return next;
    });
  }

  const { data: orders = [], isLoading } = useQuery<ProductionOrder[]>({
    queryKey: ['production-orders'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('production_orders')
        .select('*, work_instruction:work_instructions(title, product_name, target_molarity), creator:profiles!created_by(full_name), assignee:profiles!assigned_to(full_name, email)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as ProductionOrder[];
    },
  });

  const { data: assignableUsers = [] } = useQuery<Profile[]>({
    queryKey: ['assignable-users'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email, role, created_at')
        .order('full_name');
      if (error) throw error;
      return data as Profile[];
    },
  });

  const filtered = orders.filter((o: any) => !hiddenStatuses.has(o.status));

  const cancelMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const { error } = await supabase
        .from('production_orders')
        .update({ status: 'cancelled' })
        .eq('id', orderId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['production-orders'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const { error } = await supabase
        .from('production_orders')
        .delete()
        .eq('id', orderId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['production-orders'] }),
  });

  // Local edit buffer for scheduled start / end pickers (keyed by order id).
  const [edits, setEdits] = useState<Record<string, { start: string; end: string }>>({});
  const [flash, setFlash] = useState<Record<string, boolean>>({});

  const scheduleMutation = useMutation({
    mutationFn: async (args: { id: string; startIso: string | null; endIso: string | null }) => {
      const { error } = await supabase
        .from('production_orders')
        .update({ scheduled_start: args.startIso, scheduled_end: args.endIso })
        .eq('id', args.id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['production-orders'] });
      qc.invalidateQueries({ queryKey: ['gantt-orders'] });
      qc.invalidateQueries({ queryKey: ['unscheduled-orders'] });
      setEdits(prev => {
        const next = { ...prev }; delete next[vars.id]; return next;
      });
      setFlash(prev => ({ ...prev, [vars.id]: true }));
      setTimeout(() => setFlash(prev => {
        const next = { ...prev }; delete next[vars.id]; return next;
      }), 1200);
    },
  });

  /** Get the current picker values for a row (buffered edits or DB values). */
  function pickerValues(o: any): { start: string; end: string } {
    if (edits[o.id]) return edits[o.id];
    return {
      start: isoToLocalInput(o.scheduled_start),
      end:   isoToLocalInput(o.scheduled_end),
    };
  }

  /** When the user changes the start, shift end by the same delta so the
   *  blocked duration stays constant — but only if end was already set. */
  function handleStartChange(o: any, newStart: string) {
    const cur = pickerValues(o);
    let newEnd = cur.end;
    if (cur.start && cur.end) {
      const oldStartMs = new Date(cur.start).getTime();
      const oldEndMs   = new Date(cur.end).getTime();
      const newStartMs = new Date(newStart).getTime();
      if (!isNaN(oldStartMs) && !isNaN(oldEndMs) && !isNaN(newStartMs)) {
        const duration = oldEndMs - oldStartMs;
        newEnd = isoToLocalInput(new Date(newStartMs + duration).toISOString());
      }
    }
    setEdits(prev => ({ ...prev, [o.id]: { start: newStart, end: newEnd } }));
  }

  function handleEndChange(o: any, newEnd: string) {
    const cur = pickerValues(o);
    setEdits(prev => ({ ...prev, [o.id]: { start: cur.start, end: newEnd } }));
  }

  function saveSchedule(o: any) {
    const buf = edits[o.id];
    if (!buf) return;
    scheduleMutation.mutate({
      id: o.id,
      startIso: localInputToIso(buf.start),
      endIso:   localInputToIso(buf.end),
    });
  }

  function handleCancel(orderId: string) {
    if (!window.confirm('Cancel this production order?')) return;
    cancelMutation.mutate(orderId);
  }

  function handleDelete(orderId: string) {
    if (!window.confirm('Permanently delete this order and all its step data? This cannot be undone.')) return;
    deleteMutation.mutate(orderId);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Production Orders</h1>
          <p className="text-sm text-gray-500 mt-1">Active and historical production runs</p>
        </div>
        <Link
          to="/production-orders/new"
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} />
          New Order
        </Link>
      </div>

      {/* Status filter pills */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wide mr-1">Show:</span>
        {ALL_STATUSES.map(status => {
          const active = !hiddenStatuses.has(status);
          const count = orders.filter((o: any) => o.status === status).length;
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

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
          <p className="text-gray-500 mb-2">{orders.length === 0 ? 'No production orders yet' : 'No orders match the current filters'}</p>
          {orders.length === 0 && <Link to="/production-orders/new" className="text-blue-600 text-sm hover:underline">Create the first one</Link>}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-600">Production Order #</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Lot Number</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Product</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Batch</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Required By</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Assigned To</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Scheduled Start</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Scheduled End</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Created</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map((order: any) => (
                <tr key={order.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">{order.production_order_number ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{order.lot_number}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {order.work_instruction?.product_name ?? '—'}
                    {order.work_instruction?.target_molarity != null && (
                      <span className="text-xs text-gray-400 ml-1">({order.work_instruction.target_molarity} M)</span>
                    )}
                    {order.wi_version != null && (
                      <span className="text-xs text-indigo-500 ml-1.5">v{order.wi_version}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {order.batch_size != null ? `${order.batch_size} ${order.batch_size_unit}` : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[order.status]}`}>
                      {order.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <RequiredByCell
                      order={order}
                      canEdit={profile?.role === 'admin' || order.created_by === profile?.id || order.assigned_to === profile?.id}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <AssigneeCell
                      order={order}
                      users={assignableUsers}
                      canEdit={profile?.role === 'admin' || order.created_by === profile?.id || order.assigned_to === profile?.id}
                    />
                  </td>
                  {(() => {
                    const canEditSchedule = profile?.role === 'admin' ||
                      (order as any).created_by === profile?.id ||
                      (order as any).assigned_to === profile?.id;
                    const vals = pickerValues(order);
                    const dirty = !!edits[order.id];
                    const saved = flash[order.id];
                    return (
                      <>
                        <td className="px-4 py-3">
                          <input
                            type="datetime-local"
                            value={vals.start}
                            disabled={!canEditSchedule}
                            onChange={e => handleStartChange(order, e.target.value)}
                            className="border border-gray-200 rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-gray-50 disabled:text-gray-500"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <input
                              type="datetime-local"
                              value={vals.end}
                              disabled={!canEditSchedule}
                              onChange={e => handleEndChange(order, e.target.value)}
                              className="border border-gray-200 rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-gray-50 disabled:text-gray-500"
                            />
                            {dirty && canEditSchedule && (
                              <button
                                onClick={() => saveSchedule(order)}
                                disabled={scheduleMutation.isPending}
                                title="Save schedule"
                                className="p-1 text-blue-600 hover:text-blue-800 disabled:opacity-50"
                              >
                                <Check size={15} />
                              </button>
                            )}
                            {saved && (
                              <span className="text-[11px] font-medium text-emerald-600">Saved</span>
                            )}
                          </div>
                        </td>
                      </>
                    );
                  })()}
                  <td className="px-4 py-3 text-gray-400">{formatDate(order.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      {(profile?.role === 'admin' || (order as any).created_by === profile?.id) &&
                       (order.status === 'pending' || order.status === 'in_progress') && (
                        <button
                          onClick={() => handleCancel(order.id)}
                          title="Cancel order"
                          className="p-1 text-gray-400 hover:text-orange-600 transition-colors"
                        >
                          <Ban size={15} />
                        </button>
                      )}
                      {(profile?.role === 'admin' ||
                        ((order as any).created_by === profile?.id &&
                         (order.status === 'pending' || order.status === 'cancelled'))) && (
                        <button
                          onClick={() => handleDelete(order.id)}
                          title="Delete order"
                          className="p-1 text-gray-400 hover:text-red-600 transition-colors"
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                      <Link to={`/production-orders/${order.id}`} className="p-1 text-blue-600 hover:text-blue-800">
                        <ChevronRight size={18} />
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ── Inline editable cells ─────────────────────────────────────── */

/** Editable "Required By" date cell. Saves immediately on change. */
function RequiredByCell({ order, canEdit }: { order: any; canEdit: boolean }) {
  const qc = useQueryClient();
  const [val, setVal] = useState<string>(order.required_by ?? '');
  const [flash, setFlash] = useState(false);

  useEffect(() => { setVal(order.required_by ?? ''); }, [order.required_by]);

  const save = useMutation({
    mutationFn: async (next: string) => {
      const { error } = await supabase
        .from('production_orders')
        .update({ required_by: next || null })
        .eq('id', order.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['production-orders'] });
      qc.invalidateQueries({ queryKey: ['unscheduled-orders'] });
      setFlash(true);
      setTimeout(() => setFlash(false), 1200);
    },
  });

  if (!canEdit) return <span className="text-gray-600">{formatDateOnly(order.required_by)}</span>;

  return (
    <div className="flex items-center gap-1.5">
      <input
        type="date"
        value={val}
        onChange={e => { setVal(e.target.value); save.mutate(e.target.value); }}
        className="border border-gray-200 rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
      />
      {flash && <span className="text-[11px] font-medium text-emerald-600">Saved</span>}
    </div>
  );
}

/** Editable assignee cell. Saves immediately on change. */
function AssigneeCell({ order, users, canEdit }: { order: any; users: Profile[]; canEdit: boolean }) {
  const qc = useQueryClient();
  const [val, setVal] = useState<string>(order.assigned_to ?? '');
  const [flash, setFlash] = useState(false);

  useEffect(() => { setVal(order.assigned_to ?? ''); }, [order.assigned_to]);

  const save = useMutation({
    mutationFn: async (next: string) => {
      const { error } = await supabase
        .from('production_orders')
        .update({ assigned_to: next || null })
        .eq('id', order.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['production-orders'] });
      setFlash(true);
      setTimeout(() => setFlash(false), 1200);
    },
  });

  if (!canEdit) return <span className="text-gray-600">{order.assignee?.full_name ?? '—'}</span>;

  return (
    <div className="flex items-center gap-1.5">
      <select
        value={val}
        onChange={e => { setVal(e.target.value); save.mutate(e.target.value); }}
        className="border border-gray-200 rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
      >
        <option value="">— Unassigned —</option>
        {users.map(u => (
          <option key={u.id} value={u.id}>{u.full_name}</option>
        ))}
      </select>
      {flash && <span className="text-[11px] font-medium text-emerald-600">Saved</span>}
    </div>
  );
}
