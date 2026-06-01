import { Link, useLocation, Outlet } from 'react-router-dom';
import {
  FlaskConical, LayoutDashboard, BookOpen, ClipboardList,
  PlayCircle, LogOut, ChevronRight, Beaker, Scale, Users, Building2,
  ShoppingCart, CalendarClock, TrendingUp,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { cn } from '../lib/utils';
import DefaultLabSelector from './DefaultLabSelector';

const mainNav = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, roles: ['admin', 'author', 'approver', 'operator', 'lab'] },
  { to: '/work-instructions', label: 'Work Instructions', icon: ClipboardList, roles: ['admin', 'author', 'approver', 'operator'] },
  { to: '/production-orders', label: 'Production Orders', icon: PlayCircle, roles: ['admin', 'author', 'approver', 'operator'] },
  { to: '/quality-trends', label: 'Quality Trends', icon: TrendingUp, roles: ['admin', 'author', 'approver', 'operator'] },
  { to: '/unscheduled-orders', label: 'Unscheduled Orders', icon: CalendarClock, roles: ['admin'] },
  { to: '/reagent-orders', label: 'Reagent Orders', icon: ShoppingCart, roles: ['admin', 'author', 'approver', 'operator', 'lab'] },
];

const setupNav = [
  { to: '/users', label: 'Users', icon: Users, roles: ['admin'] },
  { to: '/labs', label: 'Labs', icon: Building2, roles: ['admin'] },
  { to: '/scales', label: 'Scales', icon: Scale, roles: ['admin'] },
  { to: '/reagents', label: 'Reagent Items', icon: Beaker, roles: ['admin', 'author'] },
  { to: '/library', label: 'Step Library', icon: BookOpen, roles: ['admin', 'author', 'approver'] },
];

export default function AppLayout() {
  const { profile, signOut } = useAuth();
  const location = useLocation();

  const visibleMain  = mainNav.filter(item  => profile ? item.roles.includes(profile.role) : false);
  const visibleSetup = setupNav.filter(item => profile ? item.roles.includes(profile.role) : false);

  const renderNavLink = (item: typeof mainNav[number]) => {
    const active = item.to === '/'
      ? location.pathname === '/'
      : location.pathname.startsWith(item.to);
    return (
      <Link
        key={item.to}
        to={item.to}
        className={cn(
          'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
          active
            ? 'bg-blue-50 text-blue-700'
            : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
        )}
      >
        <item.icon size={18} />
        {item.label}
        {active && <ChevronRight size={14} className="ml-auto" />}
      </Link>
    );
  };

  return (
    <div className="min-h-screen flex bg-gray-50">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-5 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 text-white p-1.5 rounded-lg">
              <FlaskConical size={22} />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900 leading-tight">Lab WI System</p>
              <p className="text-xs text-gray-500">Reagent Production</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-3 flex flex-col overflow-y-auto">
          <div className="space-y-1">
            {visibleMain.map(renderNavLink)}
          </div>

          {visibleSetup.length > 0 && (
            <div className="mt-auto pt-4">
              <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                Setup
              </p>
              <div className="space-y-1 pt-1 border-t border-gray-100">
                <div className="pt-2 space-y-1">
                  {visibleSetup.map(renderNavLink)}
                </div>
              </div>
            </div>
          )}
        </nav>

        <div className="p-4 border-t border-gray-200">
          <DefaultLabSelector />
          <div className="mb-3">
            <p className="text-sm font-medium text-gray-900 truncate">{profile?.full_name || 'User'}</p>
            <p className="text-xs text-gray-500 capitalize">{profile?.role}</p>
          </div>
          <button
            onClick={signOut}
            className="flex items-center gap-2 text-sm text-gray-600 hover:text-red-600 transition-colors w-full"
          >
            <LogOut size={16} />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
