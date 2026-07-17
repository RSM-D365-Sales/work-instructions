import { useState } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { cn } from '../lib/utils';

// A pinned, Word-style step navigator shared by the read-only pages (work
// instruction detail, production order execution). Mirrors the authoring
// editor's navigator: a full-height sidebar flush against the app chrome that
// lists every step (number · icon · name), highlights the active one, and
// jumps to it on click. The step list scrolls internally when it outgrows the
// viewport. The editor keeps its own draggable variant; this one is read-only.

export type StepNavStatus = 'completed' | 'active' | 'pending' | 'skipped';

export interface StepNavItem {
  id: string;
  name: string;
  icon?: React.ReactNode;
  status?: StepNavStatus;
}

const STATUS_DOT: Record<StepNavStatus, string> = {
  completed: 'bg-green-500',
  active:    'bg-blue-500',
  skipped:   'bg-gray-300',
  pending:   'bg-gray-200 ring-1 ring-inset ring-gray-300',
};

export default function StepNavPanel({
  items, activeId, onNavigate, storageKey, title = 'Step Navigator',
}: {
  items: StepNavItem[];
  activeId: string | null;
  onNavigate: (id: string) => void;
  /** localStorage key so the hide/show choice persists per page. */
  storageKey: string;
  title?: string;
}) {
  const [hidden, setHidden] = useState(() => localStorage.getItem(storageKey) === '1');

  const toggle = () =>
    setHidden(prev => {
      localStorage.setItem(storageKey, prev ? '0' : '1');
      return !prev;
    });

  return (
    <nav
      className={cn(
        'hidden lg:flex flex-col sticky top-0 h-screen -my-6 -ml-6 shrink-0 bg-white border-r border-gray-200 transition-[width] duration-200',
        hidden ? 'w-11' : 'w-60'
      )}
    >
      <div
        className={cn(
          'flex items-center border-b border-gray-100 shrink-0 py-2.5',
          hidden ? 'justify-center' : 'justify-between pl-3 pr-2'
        )}
      >
        {!hidden && <p className="text-xs font-semibold text-gray-500">{title}</p>}
        <button
          onClick={toggle}
          title={hidden ? 'Show step navigator' : 'Hide step navigator'}
          aria-label={hidden ? 'Show step navigator' : 'Hide step navigator'}
          className="p-1 rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
        >
          {hidden ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
        </button>
      </div>

      {hidden ? (
        items.length > 0 && (
          <p className="mt-2 text-center text-[10px] font-semibold text-gray-400" title={`${items.length} steps`}>
            {items.length}
          </p>
        )
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-0.5">
          {items.length === 0 && (
            <p className="px-2 py-3 text-xs text-gray-400 italic">No steps</p>
          )}
          {items.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onNavigate(s.id)}
              title={s.name || 'Untitled Step'}
              className={cn(
                'w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-left text-xs transition-colors',
                activeId === s.id ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'
              )}
            >
              {s.status && (
                <span className={cn('shrink-0 h-2 w-2 rounded-full', STATUS_DOT[s.status])} />
              )}
              <span className="w-5 shrink-0 text-right font-semibold text-gray-400">{i + 1}</span>
              {s.icon && (
                <span className="shrink-0 text-gray-400 [&_svg]:w-3.5 [&_svg]:h-3.5">{s.icon}</span>
              )}
              <span className="truncate font-medium">
                {s.name || <span className="italic font-normal text-gray-400">Untitled Step</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </nav>
  );
}
