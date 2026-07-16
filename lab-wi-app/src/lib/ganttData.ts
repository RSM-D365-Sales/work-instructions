/* Shared data layer for the production schedule views: the dashboard gantt
 * (components/ProductionGantt.tsx) and the Production Schedule page
 * (pages/ProductionSchedulePage.tsx) both build on these. */

import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import { useAuth } from '../context/AuthContext';

export interface GanttOrderRow {
  id: string;
  lot_number: string;
  status: 'pending' | 'in_progress' | 'awaiting_qc' | 'completed' | 'failed' | 'cancelled';
  batch_size: number | null;
  batch_size_unit: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  assigned_to: string | null;
  created_by: string;
  assignee: { id: string; full_name: string; role: string } | null;
  creator: { id: string; full_name: string; role: string } | null;
  work_instruction: { title: string; product_name: string; scheduled_minutes: number | null } | null;
}

export const DAY_MS = 24 * 60 * 60 * 1000;

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

/** Pick start/end for a production order bar.
 *  Priority:
 *   1. scheduled_start / scheduled_end (the explicit "blocked time")
 *   2. started_at + WI.scheduled_minutes (or completed_at) for runs underway
 *  Returns null when the order has neither — an unscheduled pending order
 *  belongs in the Unscheduled Orders queue, not on the schedule.
 */
export function deriveSpan(order: GanttOrderRow): { start: Date; end: Date } | null {
  // 1) Explicit schedule wins.
  if (order.scheduled_start && order.scheduled_end) {
    return {
      start: new Date(order.scheduled_start),
      end:   new Date(order.scheduled_end),
    };
  }

  const rawStart = order.scheduled_start ?? order.started_at;
  if (!rawStart) return null;   // never draw a bar for unscheduled, unstarted orders
  const start = new Date(rawStart);
  let end: Date;
  if (order.completed_at) {
    end = new Date(order.completed_at);
  } else if (order.scheduled_end) {
    end = new Date(order.scheduled_end);
  } else if (order.work_instruction?.scheduled_minutes) {
    end = new Date(start.getTime() + order.work_instruction.scheduled_minutes * 60_000);
  } else if (order.status === 'in_progress') {
    // running bar — extend to "now" with a small forward buffer
    end = addDays(new Date(), 0.5);
  } else {
    end = addDays(start, 1);
  }
  // Guarantee a minimum visible width (4 hours)
  if (end.getTime() - start.getTime() < DAY_MS / 6) {
    end = new Date(start.getTime() + DAY_MS / 6);
  }
  return { start, end };
}

export const STATUS_DOT_CLASS: Record<GanttOrderRow['status'], string> = {
  pending:     'bg-blue-500',
  in_progress: 'bg-amber-500',
  awaiting_qc: 'bg-violet-500',
  completed:   'bg-emerald-500',
  failed:      'bg-rose-500',
  cancelled:   'bg-gray-400',
};

/** Orders that could intersect the window. Shared (same query key) between the
 *  dashboard gantt and the Production Schedule page, so both render one fetch. */
export function useGanttOrders(rangeStart: Date, rangeEnd: Date, windowDays: number) {
  const { profile } = useAuth();
  return useQuery<GanttOrderRow[]>({
    queryKey: ['gantt-orders', profile?.id, profile?.role, rangeStart.toISOString(), rangeEnd.toISOString()],
    enabled: !!profile,
    queryFn: async () => {
      // Pull orders that could intersect the window. We over-fetch slightly
      // (created up to `windowDays` before the range) so long-running pending
      // orders still appear.
      const fetchFromIso = addDays(rangeStart, -Math.max(windowDays, 30)).toISOString();

      let q = supabase
        .from('production_orders')
        .select(
          'id, lot_number, status, batch_size, batch_size_unit, ' +
          'created_at, started_at, completed_at, scheduled_start, scheduled_end, ' +
          'assigned_to, created_by, ' +
          'assignee:profiles!production_orders_assigned_to_fkey(id, full_name, role), ' +
          'creator:profiles!production_orders_created_by_fkey(id, full_name, role), ' +
          'work_instruction:work_instructions(title, product_name, scheduled_minutes)'
        )
        .gte('created_at', fetchFromIso)
        .order('created_at', { ascending: false });

      // Non-admins: only their work (assigned to them OR created by them)
      if (profile && profile.role !== 'admin') {
        q = q.or(`assigned_to.eq.${profile.id},created_by.eq.${profile.id}`);
      }

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as GanttOrderRow[];
    },
  });
}
