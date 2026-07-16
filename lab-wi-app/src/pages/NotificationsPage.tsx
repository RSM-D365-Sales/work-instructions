import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { AppNotification, NotificationChannel, NotificationSeverity } from '../types';
import { cn } from '../lib/utils';
import {
  Bell, BellOff, Mail, MessageSquare, AlertTriangle, Info, CircleAlert,
  Check, CheckCheck, ChevronRight,
} from 'lucide-react';

const TYPE_LABELS: Record<string, string> = {
  possible_deviation: 'Possible Deviation',
  high_priority_order: 'High Priority Order',
};

const SEVERITY_STYLES: Record<NotificationSeverity, string> = {
  info:     'bg-blue-100 text-blue-700',
  warning:  'bg-amber-100 text-amber-700',
  critical: 'bg-red-100 text-red-700',
};

const SEVERITY_ICONS: Record<NotificationSeverity, React.ReactNode> = {
  info:     <Info size={14} />,
  warning:  <CircleAlert size={14} />,
  critical: <AlertTriangle size={14} />,
};

const CHANNEL_META: Record<NotificationChannel, { label: string; icon: React.ReactNode }> = {
  in_app: { label: 'In-app', icon: <Bell size={11} /> },
  email:  { label: 'Email', icon: <Mail size={11} /> },
  teams:  { label: 'Teams', icon: <MessageSquare size={11} /> },
};

function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function NotificationsPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'unread' | 'all'>('unread');

  const { data: notifications = [], isLoading } = useQuery<AppNotification[]>({
    queryKey: ['notifications', 'list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notifications')
        .select('*, creator:profiles!created_by(id, full_name), reader:profiles!read_by(id, full_name)')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as AppNotification[];
    },
  });

  const unread = notifications.filter(n => !n.read_at);
  const visible = tab === 'unread' ? unread : notifications;

  const markReadMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString(), read_by: profile!.id })
        .in('id', ids)
        .is('read_at', null);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-red-600 text-white p-2.5 rounded-xl">
            <Bell size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Notifications</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Deviations, high-priority requests, and other alerts recorded by the notification service
            </p>
          </div>
        </div>
        {unread.length > 0 && (
          <button
            onClick={() => markReadMutation.mutate(unread.map(n => n.id))}
            disabled={markReadMutation.isPending}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            <CheckCheck size={15} /> Mark all as read
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2">
        {(['unread', 'all'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-colors capitalize',
              tab === t
                ? 'bg-blue-600 text-white border-transparent'
                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            )}
          >
            {t}
            <span className="font-bold">{t === 'unread' ? unread.length : notifications.length}</span>
          </button>
        ))}
        <span className="ml-auto text-xs text-gray-400">
          Email &amp; Teams delivery is simulated for the demo — every send is recorded here.
        </span>
      </div>

      {/* List */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="py-12 text-center text-gray-400">Loading…</div>
        ) : visible.length === 0 ? (
          <div className="py-14 text-center text-gray-400">
            <BellOff size={28} className="mx-auto text-gray-300 mb-2" />
            {tab === 'unread' ? 'No unread notifications — all caught up.' : 'No notifications yet.'}
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {visible.map(n => (
              <div
                key={n.id}
                className={cn(
                  'px-4 py-3 flex items-start gap-3 transition-colors',
                  !n.read_at && 'bg-blue-50/40'
                )}
              >
                {/* Unread dot */}
                <span
                  className={cn(
                    'mt-2 h-2 w-2 rounded-full shrink-0',
                    n.read_at ? 'bg-transparent' : 'bg-blue-500'
                  )}
                />

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={cn(
                      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
                      SEVERITY_STYLES[n.severity] ?? SEVERITY_STYLES.info
                    )}>
                      {SEVERITY_ICONS[n.severity] ?? SEVERITY_ICONS.info}
                      {typeLabel(n.type)}
                    </span>
                    {n.channels?.map(c => CHANNEL_META[c] && (
                      <span
                        key={c}
                        title="Delivery simulated for the demo"
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-500"
                      >
                        {CHANNEL_META[c].icon}
                        {CHANNEL_META[c].label}
                      </span>
                    ))}
                    <span className="ml-auto text-xs text-gray-400 whitespace-nowrap">
                      {formatDateTime(n.created_at)}
                    </span>
                  </div>

                  <p className={cn('text-sm mt-1.5', n.read_at ? 'text-gray-700' : 'font-semibold text-gray-900')}>
                    {n.title}
                  </p>
                  {n.body && <p className="text-sm text-gray-600 mt-0.5">{n.body}</p>}

                  <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-400">
                    {n.creator?.full_name && <span>Raised by {n.creator.full_name}</span>}
                    {n.read_at && n.reader?.full_name && (
                      <span className="inline-flex items-center gap-1">
                        <Check size={12} /> Read by {n.reader.full_name}
                      </span>
                    )}
                    <span className="ml-auto flex items-center gap-3">
                      {n.link && (
                        <Link
                          to={n.link}
                          className="inline-flex items-center gap-0.5 font-medium text-blue-600 hover:underline"
                        >
                          View <ChevronRight size={13} />
                        </Link>
                      )}
                      {!n.read_at && (
                        <button
                          onClick={() => markReadMutation.mutate([n.id])}
                          disabled={markReadMutation.isPending}
                          className="inline-flex items-center gap-1 font-medium text-gray-500 hover:text-gray-800 disabled:opacity-50"
                        >
                          <Check size={13} /> Mark read
                        </button>
                      )}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
