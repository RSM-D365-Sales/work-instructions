import { useState } from 'react';
import { Link, useLocation, Outlet } from 'react-router-dom';
import {
  Rocket, LayoutDashboard, BookOpen, ClipboardList,
  PlayCircle, LogOut, ChevronRight, Beaker, Scale, Users, Building2,
  ShoppingCart, CalendarClock, TrendingUp, Boxes, PanelLeftClose, PanelLeftOpen,
  Factory, CalendarDays, ListChecks,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { cn } from '../lib/utils';
import DefaultLabSelector from './DefaultLabSelector';

const mainNav = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, roles: ['admin', 'author', 'approver', 'operator', 'lab'] },
  { to: '/work-instructions', label: 'Work Instructions', icon: ClipboardList, roles: ['admin', 'author', 'approver', 'operator'] },
  { to: '/production-orders', label: 'Production Orders', icon: PlayCircle, roles: ['admin', 'author', 'approver', 'operator'] },
  { to: '/schedule', label: 'Production Schedule', icon: CalendarDays, roles: ['admin', 'author', 'approver', 'operator'] },
  { to: '/quality-trends', label: 'Quality Trends', icon: TrendingUp, roles: ['admin', 'author', 'approver'] },
  { to: '/inventory', label: 'Inventory', icon: Boxes, roles: ['admin', 'author', 'approver'] },
  { to: '/cycle-count', label: 'Cycle Count', icon: ListChecks, roles: ['admin', 'author', 'approver', 'operator', 'lab'] },
  { to: '/planned-orders', label: 'Planned Production Orders', icon: Factory, roles: ['admin', 'approver'] },
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

const COLLAPSED_KEY = 'sidebar-collapsed';

export default function AppLayout() {
  const { profile, signOut } = useAuth();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSED_KEY) === '1');

  const toggleCollapsed = () =>
    setCollapsed(prev => {
      localStorage.setItem(COLLAPSED_KEY, prev ? '0' : '1');
      return !prev;
    });

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
        title={collapsed ? item.label : undefined}
        className={cn(
          'flex items-center rounded-lg text-sm font-medium transition-colors',
          collapsed ? 'justify-center p-2' : 'gap-3 px-3 py-2',
          active
            ? 'bg-blue-50 text-blue-700'
            : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
        )}
      >
        <item.icon size={18} className="shrink-0" />
        {!collapsed && item.label}
        {!collapsed && active && <ChevronRight size={14} className="ml-auto" />}
      </Link>
    );
  };

  return (
    <div className="min-h-screen flex bg-gray-50">
      {/* Sidebar */}
      <aside
        className={cn(
          'bg-white border-r border-gray-200 flex flex-col shrink-0 transition-[width] duration-200',
          collapsed ? 'w-16' : 'w-64'
        )}
      >
        <div className={cn('border-b border-gray-200', collapsed ? 'p-3' : 'p-5')}>
          <div className={cn('flex items-center', collapsed ? 'flex-col gap-2' : 'gap-3')}>
            <div className="bg-blue-600 text-white p-1.5 rounded-lg">
              <Rocket size={22} />
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-gray-900 leading-tight">Lab WI System</p>
                <p className="text-xs text-gray-500">Reagent Production</p>
              </div>
            )}
            <button
              onClick={toggleCollapsed}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
            >
              {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            </button>
          </div>
        </div>

        <nav className={cn('flex-1 flex flex-col overflow-y-auto', collapsed ? 'p-2' : 'p-3')}>
          <div className="space-y-1">
            {visibleMain.map(renderNavLink)}
          </div>

          {visibleSetup.length > 0 && (
            <div className="pt-4">
              {!collapsed && (
                <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                  Setup
                </p>
              )}
              <div className="space-y-1 pt-1 border-t border-gray-100">
                <div className="pt-2 space-y-1">
                  {visibleSetup.map(renderNavLink)}
                </div>
              </div>
            </div>
          )}

          {/* Default lab + account — sits just below the nav, not pinned to the bottom */}
          <div className="mt-4 pt-4 border-t border-gray-200">
            {!collapsed && (
              <>
                <DefaultLabSelector />
                <div className="mb-3">
                  <p className="text-sm font-medium text-gray-900 truncate">{profile?.full_name || 'User'}</p>
                  <p className="text-xs text-gray-500 capitalize">{profile?.role}</p>
                </div>
              </>
            )}
            <button
              onClick={signOut}
              title={collapsed ? 'Sign Out' : undefined}
              aria-label="Sign Out"
              className={cn(
                'flex items-center text-sm text-gray-600 hover:text-red-600 transition-colors',
                collapsed ? 'justify-center p-2 rounded-lg hover:bg-gray-100 w-full' : 'gap-2 w-full'
              )}
            >
              <LogOut size={16} className="shrink-0" />
              {!collapsed && 'Sign Out'}
            </button>
          </div>
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
