import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { WorkInstruction } from '../types';
import { Plus, ChevronRight, Trash2, CalendarDays } from 'lucide-react';
import { formatDate, wiLineageKey } from '../lib/utils';
import ListFilters, { toOptions, inDateRange } from '../components/ListFilters';

const STATUS_STYLES: Record<string, string> = {
  draft:          'bg-gray-100 text-gray-600',
  pending_review: 'bg-yellow-100 text-yellow-700',
  approved:       'bg-green-100 text-green-700',
  rejected:       'bg-red-100 text-red-700',
};

export default function WorkInstructionsListPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<WorkInstruction | null>(null);
  const [filterItem, setFilterItem] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('work_instructions').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['work-instructions'] });
      setDeleteTarget(null);
    },
  });

  const { data: wis = [], isLoading } = useQuery({
    queryKey: ['work-instructions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('work_instructions')
        .select('*, creator:profiles!created_by(full_name, role), reagent:reagent_items!reagent_item_id(item_number)')
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return data as WorkInstruction[];
    },
  });

  // Collapse each WI lineage to its current + in-progress versions. We keep the
  // latest *approved* version plus any newer ones still being worked on (draft /
  // pending review / rejected); older superseded versions drop off. Once a newer
  // version is approved it becomes the threshold and the previous one drops off.
  // Full history is still reachable from each WI's detail page.
  const latestWis = useMemo(() => {
    const groups = new Map<string, WorkInstruction[]>();
    for (const w of wis) {
      const key = wiLineageKey(w);
      const arr = groups.get(key);
      if (arr) arr.push(w); else groups.set(key, [w]);
    }
    const visible: WorkInstruction[] = [];
    for (const versions of groups.values()) {
      const approvedVersions = versions.filter(v => v.status === 'approved').map(v => v.version);
      // Latest approved version number; if none approved yet, show every version.
      const threshold = approvedVersions.length ? Math.max(...approvedVersions) : -Infinity;
      for (const v of versions) {
        if (v.version >= threshold) visible.push(v);
      }
    }
    return visible.sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    );
  }, [wis]);

  const itemOptions = useMemo(() => toOptions(latestWis.map(w => w.product_name)), [latestWis]);
  const filtersActive = !!(filterItem || dateFrom || dateTo);
  const filteredWis = useMemo(
    () => latestWis.filter(w =>
      (!filterItem || (w.product_name ?? '') === filterItem) &&
      inDateRange(w.updated_at, dateFrom, dateTo)
    ),
    [latestWis, filterItem, dateFrom, dateTo]
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Work Instructions</h1>
          <p className="text-sm text-gray-500 mt-1">Production procedures for reagent manufacturing</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/work-instructions/workshop-agenda"
            className="flex items-center gap-2 border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            <CalendarDays size={16} />
            Workshop Agenda
          </Link>
          {(profile?.role === 'author' || profile?.role === 'admin') && (
            <Link
              to="/work-instructions/new"
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              <Plus size={16} />
              New WI
            </Link>
          )}
        </div>
      </div>

      {!isLoading && wis.length > 0 && (
        <ListFilters
          itemOptions={itemOptions}
          item={filterItem}
          onItem={setFilterItem}
          dateLabel="Updated"
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateFrom={setDateFrom}
          onDateTo={setDateTo}
          active={filtersActive}
          onClear={() => { setFilterItem(''); setDateFrom(''); setDateTo(''); }}
        />
      )}

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">Loading…</div>
      ) : wis.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
          <p className="text-gray-500 mb-2">No work instructions yet</p>
          {(profile?.role === 'author' || profile?.role === 'admin') && (
            <Link to="/work-instructions/new" className="text-blue-600 text-sm hover:underline">
              Create the first one
            </Link>
          )}
        </div>
      ) : filteredWis.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
          <p className="text-gray-500">No work instructions match the current filters.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-600">Title</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Item #</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Product</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Version</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Author</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Updated</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredWis.map(wi => (
                <tr key={wi.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">{wi.title}</td>
                  <td className="px-4 py-3">
                    {(wi as any).reagent?.item_number
                      ? <span className="font-mono text-xs text-gray-700">{(wi as any).reagent.item_number}</span>
                      : <span className="text-xs text-amber-600" title="Not linked to an item-master record — D365 production orders for this product won't match.">unlinked</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {wi.product_name}
                    {wi.target_molarity != null && (
                      <span className="text-xs text-gray-400 ml-1">({wi.target_molarity} M)</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">v{wi.version}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[wi.status]}`}>
                      {wi.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{(wi as any).creator?.full_name ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-400">{formatDate(wi.updated_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 justify-end">
                      {profile?.role === 'admin' && (
                        <button
                          onClick={() => setDeleteTarget(wi)}
                          className="text-gray-300 hover:text-red-500 transition-colors"
                          title="Delete work instruction"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                      <Link to={`/work-instructions/${wi.id}`} className="text-blue-600 hover:text-blue-800">
                        <ChevronRight size={18} />
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100">
                <Trash2 size={20} className="text-red-600" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-gray-900">Delete work instruction?</h2>
                <p className="text-sm text-gray-500">{deleteTarget.title} — v{deleteTarget.version}</p>
              </div>
            </div>
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              <strong>This action is irreversible.</strong> The work instruction, all of its steps, and the full approval history will be permanently deleted and cannot be recovered.
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteMutation.mutate(deleteTarget.id)}
                disabled={deleteMutation.isPending}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {deleteMutation.isPending ? 'Deleting…' : 'Permanently Delete'}
              </button>
            </div>
            {deleteMutation.isError && (
              <p className="text-xs text-red-600">{(deleteMutation.error as Error).message}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
