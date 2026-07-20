import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { cn } from '../lib/utils';
import type { WishlistItem } from '../types';
import { Lightbulb, Plus, Trash2, LayoutGrid, ListChecks } from 'lucide-react';

const SECTIONS = ['Work Instructions', 'Production', 'Scheduling', 'Login & Security', 'General'];

const CATEGORIES = [
  { key: 'feature',  label: 'Feature',  cls: 'bg-blue-100 text-blue-700' },
  { key: 'bug',      label: 'Bug',      cls: 'bg-red-100 text-red-700' },
  { key: 'idea',     label: 'Idea',     cls: 'bg-purple-100 text-purple-700' },
  { key: 'question', label: 'Question', cls: 'bg-teal-100 text-teal-700' },
  { key: 'like',     label: 'Like',     cls: 'bg-emerald-100 text-emerald-700' },
] as const;

const PRIORITIES = [
  { key: 'critical', label: 'Critical', dot: 'bg-red-500',    head: 'text-red-700' },
  { key: 'high',     label: 'High',     dot: 'bg-orange-500', head: 'text-orange-700' },
  { key: 'medium',   label: 'Medium',   dot: 'bg-amber-500',  head: 'text-amber-700' },
  { key: 'low',      label: 'Low',      dot: 'bg-gray-400',   head: 'text-gray-600' },
] as const;

const STATUSES = [
  { key: 'new',         label: 'New',         cls: 'bg-gray-100 text-gray-600' },
  { key: 'planned',     label: 'Planned',     cls: 'bg-blue-100 text-blue-700' },
  { key: 'in_progress', label: 'In Progress', cls: 'bg-amber-100 text-amber-700' },
  { key: 'completed',   label: 'Completed',   cls: 'bg-green-100 text-green-700' },
  { key: 'declined',    label: 'Declined',    cls: 'bg-gray-100 text-gray-400' },
] as const;

const catMeta = (k: string) => CATEGORIES.find(c => c.key === k) ?? CATEGORIES[0];
const priMeta = (k: string) => PRIORITIES.find(p => p.key === k) ?? PRIORITIES[2];
const statusMeta = (k: string) => STATUSES.find(s => s.key === k) ?? STATUSES[0];

export default function WishlistPage() {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const [tab, setTab] = useState<'board' | 'tracker'>('board');
  const [sectionFilter, setSectionFilter] = useState('');

  const [title, setTitle] = useState('');
  const [section, setSection] = useState('General');
  const [category, setCategory] = useState('feature');
  const [priority, setPriority] = useState('medium');

  const { data: items = [] } = useQuery<WishlistItem[]>({
    queryKey: ['wishlist'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('wishlist_items')
        .select('*, creator:profiles!created_by(full_name)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as WishlistItem[];
    },
  });

  // Live board — any add/triage/status change reflects on every screen.
  useEffect(() => {
    const ch = supabase
      .channel('wishlist-board')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wishlist_items' }, () => {
        qc.invalidateQueries({ queryKey: ['wishlist'] });
      })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [qc]);

  const addItem = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('wishlist_items').insert({
        title: title.trim(), section, category, priority, status: 'new', created_by: profile!.id,
      });
      if (error) throw error;
    },
    onSuccess: () => { setTitle(''); qc.invalidateQueries({ queryKey: ['wishlist'] }); },
  });

  const patch = useMutation({
    mutationFn: async ({ id, changes }: { id: string; changes: Partial<WishlistItem> }) => {
      const { error } = await supabase.from('wishlist_items')
        .update({ ...changes, updated_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wishlist'] }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('wishlist_items').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wishlist'] }),
  });

  const visible = useMemo(
    () => (sectionFilter ? items.filter(i => i.section === sectionFilter) : items),
    [items, sectionFilter],
  );

  const counts = useMemo(() => {
    const c = { total: items.length, new: 0, planned: 0, in_progress: 0, completed: 0 };
    for (const i of items) if (i.status in c) (c as Record<string, number>)[i.status]++;
    return c;
  }, [items]);

  function onPatch(id: string, changes: Partial<WishlistItem>) { patch.mutate({ id, changes }); }
  const canDelete = (i: WishlistItem) => profile?.role === 'admin' || i.created_by === profile?.id;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2.5">
          <Lightbulb className="text-amber-500" size={24} />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Session Wishlist</h1>
            <p className="text-sm text-gray-500">Capture ideas, gaps &amp; requests live — reviewed each evening to plan the next build.</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75 animate-ping" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
          </span>
          Live
        </span>
      </div>

      {/* Quick add */}
      <form
        onSubmit={e => { e.preventDefault(); if (title.trim()) addItem.mutate(); }}
        className="bg-white rounded-xl border border-gray-200 p-3 flex flex-wrap items-center gap-2"
      >
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Add a wishlist item — what would make this better?"
          className="flex-1 min-w-[220px] border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
        />
        <select value={section} onChange={e => setSection(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-2 text-sm">
          {SECTIONS.map(s => <option key={s}>{s}</option>)}
        </select>
        <select value={category} onChange={e => setCategory(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-2 text-sm">
          {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <select value={priority} onChange={e => setPriority(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-2 text-sm">
          {PRIORITIES.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
        <button
          type="submit"
          disabled={!title.trim() || addItem.isPending}
          className="flex items-center gap-1.5 bg-amber-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-amber-600 disabled:opacity-50"
        >
          <Plus size={16} /> Add
        </button>
      </form>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Tile label="Total" value={counts.total} />
        <Tile label="New" value={counts.new} cls="text-gray-600" />
        <Tile label="Planned" value={counts.planned} cls="text-blue-600" />
        <Tile label="In Progress" value={counts.in_progress} cls="text-amber-600" />
        <Tile label="Completed" value={counts.completed} cls="text-green-600" />
      </div>

      {/* Tabs + section filter */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-sm">
          <button onClick={() => setTab('board')} className={cn('flex items-center gap-1.5 px-4 py-2 font-medium', tab === 'board' ? 'bg-amber-500 text-white' : 'text-gray-600 hover:bg-gray-50')}>
            <LayoutGrid size={15} /> Priority Board
          </button>
          <button onClick={() => setTab('tracker')} className={cn('flex items-center gap-1.5 px-4 py-2 font-medium border-l border-gray-200', tab === 'tracker' ? 'bg-amber-500 text-white' : 'text-gray-600 hover:bg-gray-50')}>
            <ListChecks size={15} /> Dev Tracker
          </button>
        </div>
        <select value={sectionFilter} onChange={e => setSectionFilter(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm">
          <option value="">All sections</option>
          {SECTIONS.map(s => <option key={s}>{s}</option>)}
        </select>
      </div>

      {/* Board grouped by priority — outstanding work only (completed/declined live in the tracker) */}
      {tab === 'board' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {PRIORITIES.map(p => {
            const cards = visible.filter(i => i.priority === p.key && i.status !== 'completed' && i.status !== 'declined');
            return (
              <Column key={p.key} title={p.label} dot={p.dot} headCls={p.head} count={cards.length}>
                {cards.map(i => <Card key={i.id} item={i} onPatch={onPatch} onRemove={remove.mutate} canDelete={canDelete(i)} />)}
                {cards.length === 0 && <EmptyCol />}
              </Column>
            );
          })}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {(['planned', 'in_progress', 'completed', 'declined'] as const).map(sk => {
              const meta = statusMeta(sk);
              const cards = visible.filter(i => i.status === sk);
              return (
                <Column key={sk} title={meta.label} badgeCls={meta.cls} count={cards.length}>
                  {cards.map(i => <Card key={i.id} item={i} onPatch={onPatch} onRemove={remove.mutate} canDelete={canDelete(i)} showPriority />)}
                  {cards.length === 0 && <EmptyCol />}
                </Column>
              );
            })}
          </div>
          {counts.new > 0 && (
            <p className="text-xs text-gray-400">
              {counts.new} new item{counts.new === 1 ? '' : 's'} not yet triaged — set a status on the Priority Board to move {counts.new === 1 ? 'it' : 'them'} into the pipeline.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/* ── Pieces ─────────────────────────────────────────────────────────────── */

function Tile({ label, value, cls }: { label: string; value: number; cls?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">{label}</p>
      <p className={cn('text-2xl font-bold mt-0.5', cls ?? 'text-gray-900')}>{value}</p>
    </div>
  );
}

function Column({
  title, dot, headCls, badgeCls, count, children,
}: {
  title: string;
  dot?: string;
  headCls?: string;
  badgeCls?: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-gray-50/70 rounded-xl border border-gray-200 p-3">
      <div className="flex items-center justify-between px-1 mb-2">
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          {dot && <span className={cn('h-2.5 w-2.5 rounded-full', dot)} />}
          {badgeCls
            ? <span className={cn('px-2 py-0.5 rounded-full text-xs', badgeCls)}>{title}</span>
            : <span className={headCls}>{title}</span>}
        </div>
        <span className="text-xs text-gray-400 font-medium">{count}</span>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function EmptyCol() {
  return <p className="text-xs text-gray-300 italic text-center py-4">Nothing here</p>;
}

function Card({
  item, onPatch, onRemove, canDelete, showPriority,
}: {
  item: WishlistItem;
  onPatch: (id: string, changes: Partial<WishlistItem>) => void;
  onRemove: (id: string) => void;
  canDelete: boolean;
  showPriority?: boolean;
}) {
  const cat = catMeta(item.category);
  const pri = priMeta(item.priority);
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3 space-y-2 shadow-sm">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded', cat.cls)}>{cat.label}</span>
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{item.section}</span>
        {showPriority && (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-white border border-gray-200 text-gray-500">
            <span className={cn('h-1.5 w-1.5 rounded-full', pri.dot)} /> {pri.label}
          </span>
        )}
      </div>

      <p className="text-sm text-gray-800 leading-snug">{item.title}</p>

      <div className="flex items-center justify-between gap-2 pt-0.5">
        <span className="text-[11px] text-gray-400 truncate">{item.creator?.full_name ?? '—'}</span>
        <div className="flex items-center gap-1 shrink-0">
          <select
            value={item.priority}
            onChange={e => onPatch(item.id, { priority: e.target.value as WishlistItem['priority'] })}
            title="Priority"
            className="text-[11px] border border-gray-200 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-amber-400"
          >
            {PRIORITIES.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
          <select
            value={item.status}
            onChange={e => onPatch(item.id, { status: e.target.value as WishlistItem['status'] })}
            title="Status"
            className="text-[11px] border border-gray-200 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-amber-400"
          >
            {STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          {canDelete && (
            <button onClick={() => onRemove(item.id)} title="Delete" className="text-gray-300 hover:text-red-500">
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
