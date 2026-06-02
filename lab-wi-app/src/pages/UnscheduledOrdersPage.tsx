import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, CheckCircle, ArrowLeft } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { cn } from '../lib/utils';

/* -------------------------------------------------------------------------- */

interface UnscheduledOrderRow {
  id: string;
  lot_number: string;
  status: 'pending' | 'in_progress' | 'awaiting_qc' | 'completed' | 'failed' | 'cancelled';
  created_at: string;
  required_by: string | null;
  assigned_to: string | null;
  scheduled_start: string | null;
  assignee: { id: string; full_name: string } | null;
  work_instruction: {
    id: string;
    title: string;
    product_name: string;
    scheduled_minutes: number | null;
  } | null;
}

/** Returns a `datetime-local`-formatted string for "the next quarter-hour". */
function nextQuarterHourLocal(): string {
  const d = new Date();
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* -------------------------------------------------------------------------- */

export default function UnscheduledOrdersPage() {
  const qc = useQueryClient();
  const [pickers, setPickers] = useState<Record<string, string>>({});
  const [savedFlash, setSavedFlash] = useState<Record<string, boolean>>({});

  const { data: orders = [], isLoading } = useQuery<UnscheduledOrderRow[]>({
    queryKey: ['unscheduled-orders'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('production_orders')
        .select(
          'id, lot_number, status, created_at, required_by, assigned_to, scheduled_start, ' +
          'assignee:profiles!production_orders_assigned_to_fkey(id, full_name), ' +
          'work_instruction:work_instructions(id, title, product_name, scheduled_minutes)'
        )
        .is('scheduled_start', null)
        .neq('status', 'completed')
        .neq('status', 'cancelled')
        .order('required_by', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as UnscheduledOrderRow[];
    },
  });

  const scheduleMutation = useMutation({
    mutationFn: async (args: { id: string; startIso: string; endIso: string }) => {
      const { error } = await supabase
        .from('production_orders')
        .update({ scheduled_start: args.startIso, scheduled_end: args.endIso })
        .eq('id', args.id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['unscheduled-orders'] });
      qc.invalidateQueries({ queryKey: ['gantt-orders'] });
      qc.invalidateQueries({ queryKey: ['production-orders'] });
      setSavedFlash(prev => ({ ...prev, [vars.id]: true }));
      setTimeout(() => {
        setSavedFlash(prev => {
          const next = { ...prev };
          delete next[vars.id];
          return next;
        });
      }, 1500);
    },
  });

  /* Group rows by required-by date so admins can prioritise what's due soonest. */
  const groups = useMemo(() => {
    const map = new Map<string, UnscheduledOrderRow[]>();
    for (const o of orders) {
      const key = o.required_by ?? '__none__';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(o);
    }
    return Array.from(map.entries()); // already sorted by required_by asc, then created_at
  }, [orders]);

  const today = new Date(); today.setHours(0, 0, 0, 0);
  function formatRequiredBy(key: string): { label: string; tone: 'overdue' | 'soon' | 'normal' | 'none' } {
    if (key === '__none__') return { label: 'No requirement date', tone: 'none' };
    const d = new Date(key + 'T00:00:00');
    const dayMs = 24 * 60 * 60 * 1000;
    const diff = Math.round((d.getTime() - today.getTime()) / dayMs);
    const label = `Required by ${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}` +
      (diff < 0 ? ` — ${Math.abs(diff)} day${Math.abs(diff) === 1 ? '' : 's'} overdue`
        : diff === 0 ? ' — today'
        : diff === 1 ? ' — tomorrow'
        : ` — in ${diff} days`);
    const tone: 'overdue' | 'soon' | 'normal' = diff < 0 ? 'overdue' : diff <= 2 ? 'soon' : 'normal';
    return { label, tone };
  }

  function handleSchedule(o: UnscheduledOrderRow) {
    const picked = pickers[o.id] ?? nextQuarterHourLocal();
    const startDate = new Date(picked);
    if (isNaN(startDate.getTime())) return;
    const minutes = o.work_instruction?.scheduled_minutes ?? 60;
    const endDate = new Date(startDate.getTime() + minutes * 60_000);
    scheduleMutation.mutate({
      id: o.id,
      startIso: startDate.toISOString(),
      endIso:   endDate.toISOString(),
    });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to="/" className="text-gray-400 hover:text-gray-700">
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <CalendarClock size={22} className="text-blue-600" />
            Unscheduled Orders
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Production orders waiting for a scheduled start time.
          </p>
        </div>
        <div className="ml-auto text-sm text-gray-500">
          {isLoading ? 'Loading…' : `${orders.length} order${orders.length === 1 ? '' : 's'}`}
        </div>
      </div>

      {!isLoading && orders.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
          <CheckCircle size={28} className="text-emerald-500 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-900">All caught up</p>
          <p className="text-xs text-gray-500 mt-1">Every active production order has a scheduled start time.</p>
        </div>
      )}

      {groups.map(([dateKey, rows]) => {
        const { label, tone } = formatRequiredBy(dateKey);
        return (
        <div key={dateKey} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className={cn(
            'px-4 py-2 border-b border-gray-100 flex items-center justify-between',
            tone === 'overdue' ? 'bg-red-50' :
            tone === 'soon'    ? 'bg-amber-50' :
            tone === 'none'    ? 'bg-gray-50' :
                                  'bg-gray-50'
          )}>
            <p className={cn(
              'text-xs font-semibold uppercase tracking-wide',
              tone === 'overdue' ? 'text-red-700' :
              tone === 'soon'    ? 'text-amber-700' :
              tone === 'none'    ? 'text-gray-500' :
                                    'text-gray-600'
            )}>
              {label}
            </p>
            <span className="text-xs text-gray-400">{rows.length} order{rows.length === 1 ? '' : 's'}</span>
          </div>

          <table className="w-full text-sm">
            <thead className="text-left text-xs text-gray-500 uppercase">
              <tr className="border-b border-gray-100">
                <th className="px-4 py-2 font-medium">Lot</th>
                <th className="px-4 py-2 font-medium">Work Instruction</th>
                <th className="px-4 py-2 font-medium">Assignee</th>
                <th className="px-4 py-2 font-medium">Duration</th>
                <th className="px-4 py-2 font-medium">Scheduled Start</th>
                <th className="px-4 py-2 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(o => {
                const minutes = o.work_instruction?.scheduled_minutes ?? 60;
                const picker = pickers[o.id] ?? nextQuarterHourLocal();
                const saved  = savedFlash[o.id];
                return (
                  <tr key={o.id} className="border-b border-gray-50 last:border-b-0 hover:bg-gray-50/50">
                    <td className="px-4 py-3">
                      <Link
                        to={`/production-orders/${o.id}`}
                        className="text-blue-600 hover:underline font-medium"
                      >
                        {o.lot_number}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-gray-900 truncate max-w-xs">
                        {o.work_instruction?.title ?? '—'}
                      </p>
                      <p className="text-xs text-gray-500 truncate max-w-xs">
                        {o.work_instruction?.product_name ?? ''}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {o.assignee?.full_name ?? <span className="text-gray-400 italic">Unassigned</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {minutes} min
                      {o.work_instruction?.scheduled_minutes == null && (
                        <span className="ml-1 text-xs text-yellow-600">(default)</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="datetime-local"
                        value={picker}
                        onChange={e =>
                          setPickers(prev => ({ ...prev, [o.id]: e.target.value }))
                        }
                        className="border border-gray-300 rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleSchedule(o)}
                        disabled={scheduleMutation.isPending}
                        className={cn(
                          'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                          saved
                            ? 'bg-emerald-600 text-white'
                            : 'bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50'
                        )}
                      >
                        {saved ? (<><CheckCircle size={13} /> Scheduled</>) : 'Schedule'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        );
      })}
    </div>
  );
}
