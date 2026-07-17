import { useState, useMemo, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { WorkInstruction, Profile } from '../types';
import { ArrowLeft, Save, Info, GitBranch } from 'lucide-react';
import { wiLineageKey, formatDate } from '../lib/utils';

/** Product-first label for a formula: "FG-PBS-1X · PBS 1X pH 7.4 — <title>".
 *  The title is appended only when it adds something over the product name. */
function formulaLabel(wi: WorkInstruction): string {
  const itemNumber = (wi as any).reagent_item?.item_number as string | undefined;
  const head = [itemNumber, wi.product_name].filter(Boolean).join(' · ');
  return wi.title && wi.title !== wi.product_name ? `${head} — ${wi.title}` : head;
}

export default function ProductionOrderNewPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { profile } = useAuth();
  const [searchParams] = useSearchParams();
  const preselectedWI = searchParams.get('wi') ?? '';

  const [wiId, setWiId] = useState(preselectedWI);
  const [lotNumber, setLotNumber] = useState('');
  const [batchSize, setBatchSize] = useState('');
  const [batchUnit, setBatchUnit] = useState('L');
  const [notes, setNotes] = useState('');
  const [assignedTo, setAssignedTo] = useState<string>('');
  const [scheduledStart, setScheduledStart] = useState<string>(''); // optional — leave blank to schedule later
  const [requiredBy, setRequiredBy] = useState<string>('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Note: assignedTo is intentionally NOT defaulted to the current user.
  // Orders may be created up-front and assigned later by an admin/scheduler.

  const { data: assignableUsers = [] } = useQuery<Profile[]>({
    queryKey: ['assignable-users'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email, role, created_at')
        .order('full_name');
      if (error) throw error;
      return data as Profile[];
    },
  });

  const { data: approvedWIs = [] } = useQuery<WorkInstruction[]>({
    queryKey: ['approved-wis'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('work_instructions')
        .select('*, reagent_item:reagent_items(item_number, product_name)')
        .eq('status', 'approved')
        .order('title');
      if (error) throw error;
      return data as WorkInstruction[];
    },
  });

  // You order a *product*, not a work instruction: collapse every approved WI
  // into its version lineage (item + title) and offer only the newest approved
  // version of each. Approving v2 doesn't demote v1, so without this both show
  // up and an operator can pick a superseded formula. Matches how the planned-
  // order firming and insufficient-stock flows already resolve a WI.
  const currentFormulas = useMemo(() => {
    const byLineage = new Map<string, WorkInstruction>();
    for (const wi of approvedWIs) {
      const key = wiLineageKey(wi);
      const cur = byLineage.get(key);
      if (!cur || wi.version > cur.version) byLineage.set(key, wi);
    }
    return [...byLineage.values()].sort((a, b) => formulaLabel(a).localeCompare(formulaLabel(b)));
  }, [approvedWIs]);

  const selectedWI = currentFormulas.find(w => w.id === wiId) ?? null;

  // A ?wi= deep link (the "Start Production" button on a WI detail page) can
  // point at a superseded version — resolve it forward to the current one and
  // say so rather than silently producing the old formula.
  const linkedWI = preselectedWI ? approvedWIs.find(w => w.id === preselectedWI) ?? null : null;
  const supersededFrom =
    linkedWI && selectedWI && linkedWI.id !== selectedWI.id ? linkedWI.version : null;

  const formulasKey = currentFormulas.map(f => f.id).join(',');
  useEffect(() => {
    if (!linkedWI) return;
    const latest = currentFormulas.find(f => wiLineageKey(f) === wiLineageKey(linkedWI));
    if (latest && latest.id !== wiId) setWiId(latest.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectedWI, formulasKey]);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!wiId || !lotNumber.trim()) throw new Error('Product and lot number required');
      if (!requiredBy) throw new Error('Requirement date is required');
      // Guard the write too, not just the picker: only the current approved
      // version of a formula may be produced.
      if (!selectedWI) throw new Error('Select a current approved formula to produce.');

      // Schedule window is optional. If a start is provided, derive end
      // as start + WI.scheduled_minutes (fallback 60). Otherwise leave
      // both NULL so the order shows up in "Unscheduled Orders".
      let startIso: string | null = null;
      let endIso:   string | null = null;
      if (scheduledStart) {
        const minutes = selectedWI.scheduled_minutes ?? 60;
        startIso = new Date(scheduledStart).toISOString();
        endIso   = new Date(new Date(scheduledStart).getTime() + minutes * 60_000).toISOString();
      }

      const { data, error } = await supabase
        .from('production_orders')
        .insert({
          work_instruction_id: selectedWI.id,
          wi_version: selectedWI.version,
          lot_number: lotNumber.trim(),
          batch_size: batchSize ? parseFloat(batchSize) : null,
          batch_size_unit: batchUnit,
          notes: notes.trim() || null,
          status: 'pending',
          created_by: profile!.id,
          assigned_to: assignedTo || null,
          scheduled_start: startIso,
          scheduled_end:   endIso,
          required_by:     requiredBy || null,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['production-orders'] });
      qc.invalidateQueries({ queryKey: ['gantt-orders'] });
      qc.invalidateQueries({ queryKey: ['unscheduled-orders'] });
      navigate(`/production-orders/${data.id}`);
    },
  });

  async function handleCreate() {
    setSaving(true);
    setError('');
    try {
      await createMutation.mutateAsync();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/production-orders')} className="text-gray-400 hover:text-gray-700">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-xl font-bold text-gray-900">New Production Order</h1>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <p className="text-xs text-gray-500">
          A production order number (<span className="font-mono">MAN######</span>) is assigned automatically on save.
        </p>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Product *</label>
          <select
            value={wiId}
            onChange={e => setWiId(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select a product to produce…</option>
            {currentFormulas.map(wi => (
              <option key={wi.id} value={wi.id}>
                {formulaLabel(wi)}{wi.target_molarity != null ? ` (${wi.target_molarity} M)` : ''}
              </option>
            ))}
          </select>
          {currentFormulas.length === 0 ? (
            <p className="text-xs text-yellow-600 mt-1">No approved work instructions yet. An approver must approve one first.</p>
          ) : (
            <p className="text-xs text-gray-400 mt-1">
              Each product runs against its current approved work instruction — superseded versions can't be produced.
            </p>
          )}

          {/* Which formula this resolves to — the version is chosen for you, but
              you should still be able to see (and open) exactly what will run. */}
          {selectedWI && (
            <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50/60 px-3 py-2 flex items-start gap-2">
              <Info size={14} className="text-blue-600 mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1 text-xs">
                <p className="text-blue-900">
                  Producing <span className="font-semibold">{selectedWI.title} v{selectedWI.version}</span>
                  {selectedWI.approved_at ? ` · approved ${formatDate(selectedWI.approved_at)}` : ''}
                  {selectedWI.scheduled_minutes != null ? ` · ${selectedWI.scheduled_minutes} min` : ''}
                </p>
                <Link
                  to={`/work-instructions/${selectedWI.id}`}
                  className="text-blue-700 font-medium hover:underline"
                >
                  View the work instruction
                </Link>
              </div>
            </div>
          )}

          {/* Deep-linked from a superseded version's "Start Production" button */}
          {supersededFrom != null && selectedWI && (
            <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 flex items-start gap-2">
              <GitBranch size={14} className="text-amber-600 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-800">
                You came from <span className="font-semibold">v{supersededFrom}</span>, which has been superseded —
                this order will run the current approved version, <span className="font-semibold">v{selectedWI.version}</span>.
              </p>
            </div>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Lot Number *</label>
          <input
            value={lotNumber}
            onChange={e => setLotNumber(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="e.g. LOT-2026-001"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Batch Size</label>
            <input
              type="number"
              value={batchSize}
              onChange={e => setBatchSize(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g. 1"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Unit</label>
            <select
              value={batchUnit}
              onChange={e => setBatchUnit(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {['L','mL','kg','g'].map(u => <option key={u}>{u}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Scheduled Start</label>
            <input
              type="datetime-local"
              value={scheduledStart}
              onChange={e => setScheduledStart(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {(() => {
              const mins = selectedWI?.scheduled_minutes ?? null;
              if (!scheduledStart) return (
                <p className="text-xs text-gray-500 mt-1">
                  Leave blank to schedule later from the <strong>Unscheduled Orders</strong> page.
                </p>
              );
              if (!selectedWI) return (
                <p className="text-xs text-gray-400 mt-1">Pick a product to see its scheduled duration.</p>
              );
              if (mins == null) return (
                <p className="text-xs text-yellow-600 mt-1">
                  This work instruction has no scheduled time set — defaulting to 60 minutes.
                </p>
              );
              const end = new Date(new Date(scheduledStart).getTime() + mins * 60_000);
              return (
                <p className="text-xs text-gray-500 mt-1">
                  Blocks <strong>{mins} min</strong> — ends at {end.toLocaleString()}.
                </p>
              );
            })()}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Required By *</label>
            <input
              type="date"
              value={requiredBy}
              required
              min={new Date().toISOString().slice(0, 10)}
              onChange={e => setRequiredBy(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              Date the finished product is needed by. Used to prioritise unscheduled orders.
            </p>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Assign To</label>
          <select
            value={assignedTo}
            onChange={e => setAssignedTo(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">— Unassigned (assign later) —</option>
            {assignableUsers.map(u => (
              <option key={u.id} value={u.id}>
                {u.full_name}{u.email ? ` — ${u.email}` : ''} ({u.role})
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-400 mt-1">Leave unassigned to schedule and assign the order later.</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={2}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Any additional notes"
          />
        </div>
        <button
          onClick={handleCreate}
          disabled={saving}
          className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          <Save size={15} />
          {saving ? 'Creating…' : 'Create Production Order'}
        </button>
      </div>
    </div>
  );
}
