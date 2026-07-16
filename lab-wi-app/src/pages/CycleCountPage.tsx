import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ListChecks, ArrowLeft, Building2, CheckCircle, AlertTriangle, RefreshCw, Boxes,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { cn } from '../lib/utils';
import type { InventoryBatch, Lab, CycleCount } from '../types';

const num = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });

export default function CycleCountPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();

  // Operators and lab scientists count their own lab; admins/authors/approvers pick any.
  const lockedToOwnLab = profile?.role === 'operator' || profile?.role === 'lab';
  const [pickedLab, setPickedLab] = useState('');
  // Uncommitted "Counted" entries per batch id (blank = counted as expected).
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ adjustments: number; net: number } | null>(null);

  const { data: labs = [] } = useQuery<Lab[]>({
    queryKey: ['labs-active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('labs').select('*').eq('is_active', true).order('name');
      if (error) throw error;
      return data as Lab[];
    },
  });

  const selectedLab = lockedToOwnLab
    ? (profile?.default_lab_id ?? '')
    : (pickedLab || profile?.default_lab_id || '');
  const selectedLabName = labs.find(l => l.id === selectedLab)?.name ?? 'this lab';

  const { data: batches = [], isLoading } = useQuery<InventoryBatch[]>({
    queryKey: ['inventory-batches', selectedLab],
    enabled: !!selectedLab,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_batches')
        .select('*, reagent_item:reagent_items(id, item_number, product_name, item_type, unit_of_measure)')
        .eq('lab_id', selectedLab)
        .order('batch_number');
      if (error) throw error;
      return data as InventoryBatch[];
    },
  });

  // Group batches under their item, items sorted by item number.
  const groups = useMemo(() => {
    const byItem = new Map<string, { itemNumber: string; productName: string; uom: string; batches: InventoryBatch[] }>();
    for (const b of batches) {
      const item = b.reagent_item;
      if (!item) continue;
      let g = byItem.get(item.id);
      if (!g) {
        g = { itemNumber: item.item_number, productName: item.product_name, uom: item.unit_of_measure, batches: [] };
        byItem.set(item.id, g);
      }
      g.batches.push(b);
    }
    return [...byItem.values()].sort((a, b) => a.itemNumber.localeCompare(b.itemNumber));
  }, [batches]);

  /** The effective counted quantity for a batch (blank draft = as expected). */
  function countedOf(b: InventoryBatch): number {
    const d = drafts[b.id];
    if (d === undefined || d.trim() === '') return b.quantity;
    const n = Number(d);
    return Number.isFinite(n) && n >= 0 ? n : b.quantity;
  }

  const changes = useMemo(
    () => batches.filter(b => countedOf(b) !== b.quantity),
    // drafts drives countedOf — include it so the memo tracks typing.
    [batches, drafts]  // eslint-disable-line react-hooks/exhaustive-deps
  );
  const netVariance = useMemo(
    () => changes.reduce((s, b) => s + (countedOf(b) - b.quantity), 0),
    [changes, drafts]  // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Recent posted counts for this lab (the audit trail / demo history).
  const { data: recentCounts = [] } = useQuery<CycleCount[]>({
    queryKey: ['cycle-counts', selectedLab],
    enabled: !!selectedLab,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cycle_counts')
        .select('*, counter:profiles!cycle_counts_counted_by_fkey(id, full_name)')
        .eq('lab_id', selectedLab)
        .order('created_at', { ascending: false })
        .limit(5);
      if (error) throw error;
      return data as unknown as CycleCount[];
    },
  });

  /* Post: record the count (header + a line per batch), adjust the changed
   * batch quantities, then roll the new sums up to inventory_on_hand and
   * stamp d365_synced_at — mimicking the future push to D365. */
  const postMutation = useMutation({
    mutationFn: async () => {
      const lines = batches.map(b => ({ batch: b, counted: countedOf(b) }));
      const changed = lines.filter(l => l.counted !== l.batch.quantity);
      const net = changed.reduce((s, l) => s + (l.counted - l.batch.quantity), 0);
      const nowIso = new Date().toISOString();

      const { data: cc, error: hdrErr } = await supabase
        .from('cycle_counts')
        .insert({
          lab_id: selectedLab,
          counted_by: profile!.id,
          total_lines: lines.length,
          total_variance: net,
          d365_sync_status: 'sent',
          d365_synced_at: nowIso,
        })
        .select('id')
        .single();
      if (hdrErr) throw hdrErr;

      const { error: lineErr } = await supabase.from('cycle_count_lines').insert(
        lines.map(l => ({
          cycle_count_id: cc.id,
          inventory_batch_id: l.batch.id,
          reagent_item_id: l.batch.reagent_item_id,
          batch_number: l.batch.batch_number,
          expected_quantity: l.batch.quantity,
          counted_quantity: l.counted,
        }))
      );
      if (lineErr) throw lineErr;

      await Promise.all(changed.map(async l => {
        const { error } = await supabase
          .from('inventory_batches')
          .update({ quantity: l.counted })
          .eq('id', l.batch.id);
        if (error) throw error;
      }));

      const changedItems = [...new Set(changed.map(l => l.batch.reagent_item_id))];
      await Promise.all(changedItems.map(async itemId => {
        const sum = lines
          .filter(l => l.batch.reagent_item_id === itemId)
          .reduce((s, l) => s + l.counted, 0);
        const { error } = await supabase
          .from('inventory_on_hand')
          .update({ physical_inventory: sum, d365_synced_at: nowIso })
          .eq('reagent_item_id', itemId)
          .eq('lab_id', selectedLab);
        if (error) throw error;
      }));

      return { adjustments: changed.length, net };
    },
    onSuccess: res => {
      qc.invalidateQueries({ queryKey: ['inventory-batches'] });
      qc.invalidateQueries({ queryKey: ['inventory-on-hand'] });
      qc.invalidateQueries({ queryKey: ['cycle-counts'] });
      setDrafts({});
      setResult(res);
    },
  });

  function handlePost() {
    if (!selectedLab || batches.length === 0 || postMutation.isPending) return;
    const msg = changes.length === 0
      ? `No variances found — post the count for ${selectedLabName} as verified?`
      : `Post the count for ${selectedLabName}? ${changes.length} of ${batches.length} batches will be adjusted ` +
        `(net ${netVariance >= 0 ? '+' : ''}${num(netVariance)}), and the change syncs to D365.`;
    if (!window.confirm(msg)) return;
    setResult(null);
    postMutation.mutate();
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to="/" className="text-gray-400 hover:text-gray-700">
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ListChecks size={22} className="text-blue-600" />
            Cycle Count
          </h1>
          <p className="text-sm text-gray-500 mt-0.5 flex items-center gap-1.5">
            Count on-hand by batch, post the variances, and the adjustment
            <RefreshCw size={12} className="text-indigo-400" /> syncs to D365.
          </p>
        </div>
        <button
          onClick={handlePost}
          disabled={!selectedLab || batches.length === 0 || postMutation.isPending}
          className="ml-auto inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors"
        >
          <CheckCircle size={15} />
          {postMutation.isPending
            ? 'Posting…'
            : changes.length > 0
              ? `Post count (${changes.length} adjustment${changes.length === 1 ? '' : 's'})`
              : 'Post count'}
        </button>
      </div>

      {/* Lab picker + count stats */}
      <div className="flex flex-wrap items-center gap-3">
        {lockedToOwnLab ? (
          <span className="inline-flex items-center gap-1.5 px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-600">
            <Building2 size={15} className="text-gray-400" />
            {selectedLab ? selectedLabName : 'No default lab set'}
          </span>
        ) : (
          <div className="relative">
            <Building2 size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <select
              value={selectedLab}
              onChange={e => { setPickedLab(e.target.value); setDrafts({}); setResult(null); }}
              className="pl-9 pr-8 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select a lab…</option>
              {labs.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
        )}
        {selectedLab && (
          <p className="text-sm text-gray-500">
            {groups.length} item{groups.length === 1 ? '' : 's'} · {batches.length} batch{batches.length === 1 ? '' : 'es'}
            {changes.length > 0 && (
              <span className={cn('ml-2 font-medium', netVariance < 0 ? 'text-red-600' : 'text-emerald-700')}>
                {changes.length} variance{changes.length === 1 ? '' : 's'}, net {netVariance >= 0 ? '+' : ''}{num(netVariance)}
              </span>
            )}
          </p>
        )}
      </div>

      {/* Post result */}
      {result && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
          <CheckCircle size={16} />
          <span>
            Count posted for {selectedLabName} — {result.adjustments === 0
              ? 'no variances; inventory verified.'
              : `${result.adjustments} batch${result.adjustments === 1 ? '' : 'es'} adjusted (net ${result.net >= 0 ? '+' : ''}${num(result.net)}).`}
            {' '}Synced to D365.
          </span>
          <button onClick={() => setResult(null)} className="ml-auto text-xs underline opacity-70 hover:opacity-100">
            Dismiss
          </button>
        </div>
      )}
      {postMutation.isError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          <AlertTriangle size={16} />
          {postMutation.error instanceof Error ? postMutation.error.message : 'Posting failed — try again.'}
        </div>
      )}

      {/* Count sheet */}
      {!selectedLab ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
          <Building2 size={32} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500">
            {lockedToOwnLab
              ? 'Set your default lab in the sidebar to start a cycle count.'
              : 'Select a lab to start a cycle count.'}
          </p>
        </div>
      ) : isLoading ? (
        <div className="text-center py-12 text-gray-400">Loading…</div>
      ) : batches.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
          <Boxes size={32} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500">No batches on hand for {selectedLabName}.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-gray-600">
                  <th className="text-left px-4 py-3 font-medium">Batch #</th>
                  <th className="text-left px-4 py-3 font-medium whitespace-nowrap">Received</th>
                  <th className="text-right px-4 py-3 font-medium whitespace-nowrap">On-hand</th>
                  <th className="text-right px-4 py-3 font-medium whitespace-nowrap">Counted</th>
                  <th className="text-right px-4 py-3 font-medium whitespace-nowrap">Variance</th>
                  <th className="text-left px-3 py-3 font-medium">UoM</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(g => (
                  <GroupRows
                    key={g.itemNumber}
                    group={g}
                    drafts={drafts}
                    countedOf={countedOf}
                    onDraft={(id, v) => { setDrafts(prev => ({ ...prev, [id]: v })); setResult(null); }}
                    disabled={postMutation.isPending}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent counts */}
      {selectedLab && recentCounts.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Recent counts — {selectedLabName}
            </p>
          </div>
          <div className="divide-y divide-gray-50">
            {recentCounts.map(c => (
              <div key={c.id} className="px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="text-gray-800 font-medium">{new Date(c.created_at).toLocaleString()}</span>
                <span className="text-gray-500">{c.counter?.full_name ?? '—'}</span>
                <span className="text-gray-500">{c.total_lines} line{c.total_lines === 1 ? '' : 's'}</span>
                <span className={cn(
                  'font-medium',
                  c.total_variance === 0 ? 'text-gray-400' : c.total_variance < 0 ? 'text-red-600' : 'text-emerald-700'
                )}>
                  net {c.total_variance >= 0 ? '+' : ''}{num(c.total_variance)}
                </span>
                <span className="ml-auto inline-flex items-center gap-1 text-xs text-indigo-500">
                  <RefreshCw size={11} /> Synced to D365
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── One item group: a header row + a row per batch ─────────────────────── */

function GroupRows({
  group, drafts, countedOf, onDraft, disabled,
}: {
  group: { itemNumber: string; productName: string; uom: string; batches: InventoryBatch[] };
  drafts: Record<string, string>;
  countedOf: (b: InventoryBatch) => number;
  onDraft: (batchId: string, value: string) => void;
  disabled: boolean;
}) {
  const expected = group.batches.reduce((s, b) => s + b.quantity, 0);
  const counted = group.batches.reduce((s, b) => s + countedOf(b), 0);
  return (
    <>
      <tr className="bg-gray-50/70 border-t border-gray-100">
        <td colSpan={4} className="px-4 py-2">
          <span className="font-mono font-medium text-gray-900">{group.itemNumber}</span>
          <span className="ml-2 text-gray-700">{group.productName}</span>
          <span className="ml-2 text-xs text-gray-400">
            {group.batches.length} batch{group.batches.length === 1 ? '' : 'es'} · {num(expected)} on hand
          </span>
        </td>
        <td className={cn(
          'px-4 py-2 text-right text-xs font-medium tabular-nums',
          counted === expected ? 'text-gray-400' : counted < expected ? 'text-red-600' : 'text-emerald-700'
        )}>
          {counted === expected ? '—' : `${counted - expected >= 0 ? '+' : ''}${num(counted - expected)}`}
        </td>
        <td />
      </tr>
      {group.batches.map(b => {
        const c = countedOf(b);
        const variance = c - b.quantity;
        return (
          <tr key={b.id} className="border-t border-gray-50 hover:bg-blue-50/30">
            <td className="px-4 py-2 pl-8 font-mono text-xs text-gray-700">{b.batch_number}</td>
            <td className="px-4 py-2 text-gray-500 text-xs whitespace-nowrap">
              {b.received_at ? new Date(b.received_at).toLocaleDateString() : '—'}
            </td>
            <td className="px-4 py-2 text-right tabular-nums text-gray-800">{num(b.quantity)}</td>
            <td className="px-4 py-2 text-right">
              <input
                type="number"
                min={0}
                value={drafts[b.id] ?? ''}
                placeholder={num(b.quantity)}
                disabled={disabled}
                onChange={e => onDraft(b.id, e.target.value)}
                className={cn(
                  'w-24 border rounded-md px-2 py-1 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-50',
                  variance !== 0 ? 'border-amber-400 bg-amber-50' : 'border-gray-200'
                )}
              />
            </td>
            <td className={cn(
              'px-4 py-2 text-right tabular-nums font-medium',
              variance === 0 ? 'text-gray-300' : variance < 0 ? 'text-red-600' : 'text-emerald-700'
            )}>
              {variance === 0 ? '—' : `${variance > 0 ? '+' : ''}${num(variance)}`}
            </td>
            <td className="px-3 py-2 text-gray-400 text-xs">{group.uom}</td>
          </tr>
        );
      })}
    </>
  );
}
