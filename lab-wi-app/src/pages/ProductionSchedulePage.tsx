import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, ArrowLeft, CalendarClock, Clock } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { cn } from '../lib/utils';
import ProductionGantt from '../components/ProductionGantt';
import {
  useGanttOrders, deriveSpan, startOfDay, addDays, STATUS_DOT_CLASS,
  type GanttOrderRow,
} from '../lib/ganttData';

/* -------------------------------------------------------------------------- */

interface DayItem {
  order: GanttOrderRow;
  start: Date;
  end: Date;
}

interface PersonDay {
  personId: string;
  personName: string;
  personRole: string;
  items: DayItem[];
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('');
}

/* -------------------------------------------------------------------------- */

export default function ProductionSchedulePage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  // Shared range state: the gantt toolbar (presets, Today, prev/next) drives
  // this, and the day-by-day breakdown below follows the same window.
  const [windowDays, setWindowDays] = useState(7);
  const [anchor, setAnchor] = useState<Date>(() => addDays(startOfDay(new Date()), -1));

  const rangeStart = useMemo(() => startOfDay(anchor), [anchor]);
  const rangeEnd   = useMemo(() => addDays(rangeStart, windowDays), [rangeStart, windowDays]);

  // Same query key as the gantt above → one fetch feeds both views.
  const { data: orders = [] } = useGanttOrders(rangeStart, rangeEnd, windowDays);

  /* Break the window down day by day: for each day, who is working on what,
   * in start-time order. Only orders with a real schedule (or an actual run)
   * appear — unscheduled orders live in the Unscheduled Orders queue. */
  const days = useMemo(() => {
    const out: { day: Date; people: PersonDay[]; total: number }[] = [];
    for (let i = 0; i < windowDays; i++) {
      const day = addDays(rangeStart, i);
      const dayEnd = addDays(day, 1);
      const byPerson = new Map<string, PersonDay>();

      for (const o of orders) {
        const span = deriveSpan(o);
        if (!span) continue;
        if (span.end <= day || span.start >= dayEnd) continue;

        const owner = o.assignee ?? o.creator;
        const key = owner?.id ?? 'unassigned';
        let entry = byPerson.get(key);
        if (!entry) {
          entry = {
            personId: key,
            personName: owner?.full_name ?? 'Unassigned',
            personRole: owner?.role ?? '',
            items: [],
          };
          byPerson.set(key, entry);
        }
        entry.items.push({ order: o, start: span.start, end: span.end });
      }

      const people = [...byPerson.values()].sort((a, b) => a.personName.localeCompare(b.personName));
      people.forEach(p => p.items.sort((a, b) => a.start.getTime() - b.start.getTime()));
      out.push({ day, people, total: people.reduce((n, p) => n + p.items.length, 0) });
    }
    return out;
  }, [orders, rangeStart, windowDays]);

  const today = startOfDay(new Date()).getTime();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to="/" className="text-gray-400 hover:text-gray-700">
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <CalendarDays size={22} className="text-blue-600" />
            Production Schedule
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {isAdmin ? 'Every technician’s scheduled work' : 'Your scheduled work'} — by day and by hour.
            Unscheduled orders are in{' '}
            <Link to="/unscheduled-orders" className="text-blue-600 hover:underline">Unscheduled Orders</Link>.
          </p>
        </div>
      </div>

      {/* Timeline — its toolbar (1/3/7/14/30-day presets, Today, prev/next)
          drives the breakdown below too. */}
      <ProductionGantt
        windowDays={windowDays}
        anchor={anchor}
        onWindowDaysChange={d => {
          setWindowDays(d);
          if (d === 1) setAnchor(startOfDay(new Date()));
        }}
        onAnchorChange={setAnchor}
      />

      {/* Day-by-day assignments */}
      <div className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
          Assignments by day
        </h2>

        {days.map(({ day, people, total }) => {
          const isToday = day.getTime() === today;
          return (
            <div key={day.toISOString()} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className={cn(
                'px-4 py-2.5 border-b border-gray-100 flex items-center justify-between',
                isToday ? 'bg-blue-50' : 'bg-gray-50'
              )}>
                <p className={cn(
                  'text-sm font-semibold',
                  isToday ? 'text-blue-800' : 'text-gray-700'
                )}>
                  {day.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
                  {isToday && <span className="ml-2 text-xs font-medium text-blue-600">today</span>}
                </p>
                <span className="text-xs text-gray-400">
                  {total === 0 ? 'No scheduled work' : `${total} order${total === 1 ? '' : 's'} · ${people.length} ${people.length === 1 ? 'person' : 'people'}`}
                </span>
              </div>

              {people.length > 0 && (
                <div className="divide-y divide-gray-50">
                  {people.map(p => (
                    <div key={p.personId} className="px-4 py-3 flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4">
                      <div className="flex items-center gap-2 sm:w-48 shrink-0">
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white text-xs font-semibold flex items-center justify-center shrink-0">
                          {initials(p.personName)}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{p.personName}</p>
                          <p className="text-[11px] text-gray-500 capitalize">{p.personRole}</p>
                        </div>
                      </div>
                      <div className="flex-1 flex flex-wrap gap-1.5">
                        {p.items.map(({ order: o, start, end }) => (
                          <Link
                            key={o.id + start.toISOString()}
                            to={`/production-orders/${o.id}`}
                            title={`${o.lot_number} · ${o.work_instruction?.product_name ?? ''}\n${o.status.replace('_', ' ')}\n${start.toLocaleString()} → ${end.toLocaleString()}`}
                            className="inline-flex items-center gap-1.5 pl-2 pr-2.5 py-1 rounded-lg border border-gray-200 bg-gray-50/60 hover:bg-blue-50 hover:border-blue-200 transition-colors text-xs"
                          >
                            <span className={cn('w-2 h-2 rounded-full shrink-0', STATUS_DOT_CLASS[o.status])} />
                            <span className="inline-flex items-center gap-1 text-gray-500 whitespace-nowrap">
                              <Clock size={11} />
                              {fmtTime(start)}–{fmtTime(end)}
                            </span>
                            <span className="font-medium text-gray-800 whitespace-nowrap">{o.lot_number}</span>
                            <span className="text-gray-500 truncate max-w-[14rem]">
                              {o.work_instruction?.product_name ?? ''}
                            </span>
                          </Link>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {days.every(d => d.total === 0) && (
          <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
            <CalendarClock size={28} className="text-gray-300 mx-auto mb-3" />
            <p className="text-sm font-medium text-gray-900">Nothing scheduled in this range</p>
            <p className="text-xs text-gray-500 mt-1">
              Schedule orders from the{' '}
              <Link to="/unscheduled-orders" className="text-blue-600 hover:underline">Unscheduled Orders</Link> queue,
              or firm &amp; schedule from{' '}
              <Link to="/planned-orders" className="text-blue-600 hover:underline">Planned Production Orders</Link>.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
