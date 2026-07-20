import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

// Real-time "possible deviation" pop-up for supervisors.
//
// When an operator flags a deviation and hits Notify Supervisor, a row is
// inserted into `notifications` (type = possible_deviation). This component
// subscribes to those inserts over Supabase realtime and pops an alert on the
// screen of every signed-in supervisor. "Supervisor" here = admin / approver —
// there's no dedicated supervisor role — and realtime honours the notifications
// RLS, so only users allowed to read the row receive the event.
//
// Requires realtime to be enabled on public.notifications (migration 054). If it
// isn't, the subscription simply never fires — no errors, no pop-up.

interface DeviationEvent {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  created_by: string | null;
}

export default function DeviationAlert() {
  const { profile } = useAuth();
  const [alert, setAlert] = useState<DeviationEvent | null>(null);

  const isSupervisor = profile?.role === 'admin' || profile?.role === 'approver';
  const uid = profile?.id;

  useEffect(() => {
    if (!isSupervisor || !uid) return;
    const channel = supabase
      .channel('deviation-alerts')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: 'type=eq.possible_deviation' },
        payload => {
          const n = payload.new as Record<string, unknown>;
          // Don't alert the person who raised it (e.g. an admin flagging their own run).
          if (n.created_by === uid) return;
          setAlert({
            id: n.id as string,
            title: (n.title as string) ?? 'Possible deviation',
            body: (n.body as string | null) ?? null,
            link: (n.link as string | null) ?? null,
            created_by: (n.created_by as string | null) ?? null,
          });
        },
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [isSupervisor, uid]);

  if (!alert) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center p-4 pt-24 bg-black/30"
      onClick={() => setAlert(null)}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border-t-4 border-red-600"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 bg-red-50">
          <div className="flex items-center gap-2 text-red-700 font-semibold text-sm">
            <span className="relative flex h-4 w-4">
              <span className="absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75 animate-ping" />
              <AlertTriangle size={16} className="relative" />
            </span>
            Possible Deviation Flagged
          </div>
          <button onClick={() => setAlert(null)} className="text-red-400 hover:text-red-600" aria-label="Dismiss">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-1.5">
          <p className="text-sm font-semibold text-gray-900">{alert.title}</p>
          {alert.body && <p className="text-sm text-gray-600">{alert.body}</p>}
        </div>

        <div className="px-4 py-3 border-t border-gray-100 bg-gray-50 flex items-center justify-end gap-2">
          <button
            onClick={() => setAlert(null)}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100"
          >
            Dismiss
          </button>
          {alert.link && (
            <Link
              to={alert.link}
              onClick={() => setAlert(null)}
              className="px-3 py-1.5 text-sm rounded-lg bg-red-600 text-white font-medium hover:bg-red-700"
            >
              View production order
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
