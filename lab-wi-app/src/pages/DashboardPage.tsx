import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { ClipboardList, PlayCircle, CheckCircle, Clock } from 'lucide-react';
import ProductionGantt from '../components/ProductionGantt';

export default function DashboardPage() {
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
      const counts = { pending: 0, in_progress: 0, completed: 0, failed: 0 };
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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
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
            {recentOrders.map((order: any) => (
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
    completed: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
    cancelled: 'bg-gray-100 text-gray-500',
  };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${map[status] ?? ''}`}>
      {status.replace('_', ' ')}
    </span>
  );
}
