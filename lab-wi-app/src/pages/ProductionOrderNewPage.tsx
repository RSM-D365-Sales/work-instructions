import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { WorkInstruction, Profile } from '../types';
import { ArrowLeft, Save } from 'lucide-react';

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
        .select('*')
        .eq('status', 'approved')
        .order('title');
      if (error) throw error;
      return data as WorkInstruction[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!wiId || !lotNumber.trim()) throw new Error('Work instruction and lot number required');
      if (!requiredBy) throw new Error('Requirement date is required');
      const selectedWI = approvedWIs.find(w => w.id === wiId);

      // Schedule window is optional. If a start is provided, derive end
      // as start + WI.scheduled_minutes (fallback 60). Otherwise leave
      // both NULL so the order shows up in "Unscheduled Orders".
      let startIso: string | null = null;
      let endIso:   string | null = null;
      if (scheduledStart) {
        const minutes = selectedWI?.scheduled_minutes ?? 60;
        startIso = new Date(scheduledStart).toISOString();
        endIso   = new Date(new Date(scheduledStart).getTime() + minutes * 60_000).toISOString();
      }

      const { data, error } = await supabase
        .from('production_orders')
        .insert({
          work_instruction_id: wiId,
          wi_version: selectedWI?.version ?? null,
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
          <label className="block text-sm font-medium text-gray-700 mb-1">Work Instruction *</label>
          <select
            value={wiId}
            onChange={e => setWiId(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select an approved work instruction…</option>
            {approvedWIs.map(wi => (
              <option key={wi.id} value={wi.id}>
                {wi.title} v{wi.version} — {wi.product_name}{wi.target_molarity != null ? ` (${wi.target_molarity} M)` : ''}
              </option>
            ))}
          </select>
          {approvedWIs.length === 0 && (
            <p className="text-xs text-yellow-600 mt-1">No approved work instructions yet. An approver must approve one first.</p>
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
              const wi = approvedWIs.find(w => w.id === wiId);
              const mins = wi?.scheduled_minutes ?? null;
              if (!scheduledStart) return (
                <p className="text-xs text-gray-500 mt-1">
                  Leave blank to schedule later from the <strong>Unscheduled Orders</strong> page.
                </p>
              );
              if (!wi) return (
                <p className="text-xs text-gray-400 mt-1">Pick a work instruction to see its scheduled duration.</p>
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
