import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { createNotification } from '../lib/notifications';
import type { ReagentItem, Lab, Profile } from '../types';
import { ArrowLeft, Save, AlertTriangle, Send, Mail, MessageSquare, X, CheckCircle, Truck, Loader2, Plus, Trash2 } from 'lucide-react';

interface LineDraft {
  key: string;            // local UI key only
  reagentItemId: string;
  quantity: string;
}

function newLine(): LineDraft {
  return { key: Math.random().toString(36).slice(2), reagentItemId: '', quantity: '' };
}

export default function ReagentOrderNewPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { profile } = useAuth();

  const [lines, setLines] = useState<LineDraft[]>([newLine()]);
  const [labId, setLabId] = useState('');
  const [requestedForDate, setRequestedForDate] = useState('');
  const [notes, setNotes] = useState('');
  const [highPriority, setHighPriority] = useState(false);
  const [insufficientStock, setInsufficientStock] = useState(false);
  const [requesterId, setRequesterId] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [transferState, setTransferState] = useState<
    | { phase: 'idle' }
    | { phase: 'creating' }
    | { phase: 'success'; transferOrderNumber: string; sourceWarehouse: string; destinationWarehouse: string; shipDate: string; receiveDate: string; lineCount: number }
    | { phase: 'failed'; error: string }
    | { phase: 'skipped'; reason: string }
  >({ phase: 'idle' });
  const [priorityModal, setPriorityModal] = useState<null | {
    orderNumber: string;
    itemCount: number;
    summary: string;
    labName: string;
    requesterName: string;
  }>(null);

  // Default creator/requester to current user, default lab to user's default_lab_id
  useEffect(() => {
    if (profile) {
      if (!requesterId) setRequesterId(profile.id);
      if (!labId && profile.default_lab_id) setLabId(profile.default_lab_id);
    }
  }, [profile, requesterId, labId]);

  const { data: reagents = [] } = useQuery<ReagentItem[]>({
    queryKey: ['reagent-items-active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reagent_items')
        .select('*')
        .eq('is_active', true)
        .order('product_name');
      if (error) throw error;
      return data as ReagentItem[];
    },
  });

  const { data: labs = [] } = useQuery<Lab[]>({
    queryKey: ['labs-active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('labs')
        .select('*')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data as Lab[];
    },
  });

  const { data: users = [] } = useQuery<Profile[]>({
    queryKey: ['profiles-all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email, role, created_at')
        .order('full_name');
      if (error) throw error;
      return data as Profile[];
    },
  });

  const selectedLab = useMemo(
    () => labs.find(l => l.id === labId),
    [labs, labId]
  );

  const selectedRequester = useMemo(
    () => users.find(u => u.id === requesterId),
    [users, requesterId]
  );

  const reagentsById = useMemo(() => {
    const m = new Map<string, ReagentItem>();
    for (const r of reagents) m.set(r.id, r);
    return m;
  }, [reagents]);

  // Reagent orders are nearly always for Finished Goods, so list FG items first
  // (already name-sorted from the query), with everything else grouped after.
  const fgReagents = useMemo(() => reagents.filter(r => r.item_type === 'FG'), [reagents]);
  const otherReagents = useMemo(() => reagents.filter(r => r.item_type !== 'FG'), [reagents]);

  function updateLine(key: string, patch: Partial<LineDraft>) {
    setLines(prev => prev.map(l => (l.key === key ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines(prev => [...prev, newLine()]);
  }
  function removeLine(key: string) {
    setLines(prev => (prev.length === 1 ? prev : prev.filter(l => l.key !== key)));
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!labId) throw new Error('Please select a lab');
      if (!requestedForDate) throw new Error('Please choose a requested-for date');
      if (!requesterId) throw new Error('Requester is required');
      if (lines.length === 0) throw new Error('Add at least one reagent line');

      const cleaned = lines.map((l, idx) => {
        if (!l.reagentItemId) throw new Error(`Line ${idx + 1}: select a reagent product`);
        const qty = parseFloat(l.quantity);
        if (!l.quantity || isNaN(qty) || qty <= 0) {
          throw new Error(`Line ${idx + 1}: quantity must be greater than 0`);
        }
        const reagent = reagentsById.get(l.reagentItemId);
        return {
          line_number: idx + 1,
          reagent_item_id: l.reagentItemId,
          quantity: qty,
          unit: reagent?.unit_of_measure ?? 'ea',
        };
      });

      // Reject duplicate reagents (one D365 line per item).
      const seen = new Set<string>();
      for (const c of cleaned) {
        if (seen.has(c.reagent_item_id)) {
          throw new Error('Each reagent can only appear once on an order. Combine the quantities.');
        }
        seen.add(c.reagent_item_id);
      }

      // 1) Insert the parent order (legacy single-item columns left NULL).
      const { data: order, error: orderErr } = await supabase
        .from('reagent_orders')
        .insert({
          lab_id: labId,
          requested_for_date: requestedForDate,
          notes: notes.trim() || null,
          high_priority: highPriority,
          insufficient_stock: insufficientStock,
          created_by: profile!.id,
          requested_by: requesterId,
          status: 'pending',
        })
        .select('id, order_number')
        .single();
      if (orderErr || !order) throw new Error(orderErr?.message || 'Database insert failed');

      // 2) Insert the line items.
      const { error: itemsErr } = await supabase
        .from('reagent_order_items')
        .insert(cleaned.map(c => ({ order_id: order.id, ...c })));
      if (itemsErr) {
        // Best-effort cleanup so we don't leave an empty parent order.
        await supabase.from('reagent_orders').delete().eq('id', order.id);
        throw new Error(itemsErr.message || 'Failed to insert order line items');
      }

      return { id: order.id, order_number: order.order_number, lineCount: cleaned.length };
    },
  });

  async function createTransferOrder(orderId: string) {
    setTransferState({ phase: 'creating' });
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('Not authenticated');
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-d365-transfer-order`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
        },
        body: JSON.stringify({ order_id: orderId }),
      });
      const body = await res.json().catch(() => ({}));
      if (body?.skipped) {
        setTransferState({ phase: 'skipped', reason: body?.error ?? 'D365 integration disabled' });
        return;
      }
      if (!res.ok || !body?.success) {
        setTransferState({ phase: 'failed', error: body?.error ?? `HTTP ${res.status}` });
        return;
      }
      setTransferState({
        phase: 'success',
        transferOrderNumber: body.transfer_order_number,
        sourceWarehouse: body.source_warehouse,
        destinationWarehouse: body.destination_warehouse,
        shipDate: body.ship_date,
        receiveDate: body.receive_date,
        lineCount: body.line_count ?? 1,
      });
    } catch (e) {
      setTransferState({ phase: 'failed', error: e instanceof Error ? e.message : 'Unknown error' });
    } finally {
      qc.invalidateQueries({ queryKey: ['reagent-orders'] });
    }
  }

  async function handleSubmit() {
    setSaving(true);
    setError('');
    try {
      const result = await createMutation.mutateAsync();
      qc.invalidateQueries({ queryKey: ['reagent-orders'] });

      // Kick off the D365 transfer-order push (non-blocking for the UI flow)
      void createTransferOrder(result.id);

      if (highPriority) {
        const summaryParts = lines.map(l => {
          const r = reagentsById.get(l.reagentItemId);
          return `${l.quantity} ${r?.unit_of_measure ?? ''} ${r?.product_name ?? ''}`.trim();
        });
        setPriorityModal({
          orderNumber: result.order_number,
          itemCount: result.lineCount,
          summary: summaryParts.join(', '),
          labName: selectedLab?.name ?? '',
          requesterName: selectedRequester?.full_name ?? '',
        });
        // E3: persist the notification so it lands in the admin inbox (the
        // modal above stays as the simulated email/Teams delivery view).
        void createNotification({
          type: 'high_priority_order',
          severity: 'warning',
          title: `High priority reagent order ${result.order_number}`,
          body: `${selectedRequester?.full_name ?? 'A requester'} (${selectedLab?.name ?? 'unknown lab'}) submitted an urgent request with ${result.lineCount} item${result.lineCount === 1 ? '' : 's'}: ${summaryParts.join(', ')}.`,
          channels: ['in_app', 'email', 'teams'],
          link: `/reagent-orders/${result.id}`,
          reagent_order_id: result.id,
          metadata: {
            order_number: result.order_number,
            lab: selectedLab?.name ?? null,
            requester: selectedRequester?.full_name ?? null,
          },
        });
      }
      // Stay on the page so the user can see the transfer order result.
      // They can navigate away via the modal button or the back arrow.
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create order');
    } finally {
      setSaving(false);
    }
  }

  // Min date = today
  const today = new Date().toISOString().split('T')[0];

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/reagent-orders')} className="text-gray-400 hover:text-gray-700">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-xl font-bold text-gray-900">New Reagent Order</h1>
          <p className="text-sm text-gray-500">Request a reagent product from the REAGENT lab</p>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        {/* Line items */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-gray-700">Reagent Items *</label>
            <button
              type="button"
              onClick={addLine}
              className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
            >
              <Plus size={14} /> Add item
            </button>
          </div>
          <div className="space-y-2">
            {lines.map((line, idx) => {
              const r = reagentsById.get(line.reagentItemId);
              return (
                <div key={line.key} className="flex items-start gap-2">
                  <div className="flex-1">
                    <select
                      value={line.reagentItemId}
                      onChange={e => updateLine(line.key, { reagentItemId: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Select a reagent…</option>
                      {fgReagents.length > 0 && (
                        <optgroup label="Finished Goods">
                          {fgReagents.map(rg => (
                            <option key={rg.id} value={rg.id}>
                              {rg.item_number} — {rg.product_name} ({rg.unit_of_measure})
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {otherReagents.length > 0 && (
                        <optgroup label="Other items">
                          {otherReagents.map(rg => (
                            <option key={rg.id} value={rg.id}>
                              {rg.item_number} — {rg.product_name} ({rg.unit_of_measure})
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  </div>
                  <div className="w-40">
                    <div className="flex">
                      <input
                        type="number"
                        step="any"
                        min="0"
                        value={line.quantity}
                        onChange={e => updateLine(line.key, { quantity: e.target.value })}
                        className="flex-1 w-0 border border-gray-300 rounded-l-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Qty"
                      />
                      <span className="inline-flex items-center px-2 bg-gray-50 border border-l-0 border-gray-300 rounded-r-lg text-xs text-gray-600">
                        {r?.unit_of_measure ?? 'unit'}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeLine(line.key)}
                    disabled={lines.length === 1}
                    title={lines.length === 1 ? 'At least one line is required' : `Remove line ${idx + 1}`}
                    className="mt-1.5 text-gray-400 hover:text-red-600 disabled:opacity-30 disabled:hover:text-gray-400"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Each item becomes a separate line on the same D365 transfer order.
          </p>
        </div>

        {/* Lab */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Ordering Lab *</label>
          <select
            value={labId}
            onChange={e => setLabId(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select a lab…</option>
            {labs.map(l => (
              <option key={l.id} value={l.id}>
                {l.name} ({l.warehouse_id})
              </option>
            ))}
          </select>
        </div>

        {/* Creator + Requester */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Created By</label>
            <input
              value={profile?.full_name ?? ''}
              disabled
              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-600"
            />
            <p className="text-xs text-gray-400 mt-1">Automatically set to the signed-in user.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Requester (on behalf of) *</label>
            <select
              value={requesterId}
              onChange={e => setRequesterId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {users.map(u => (
                <option key={u.id} value={u.id}>
                  {u.full_name}{u.email ? ` — ${u.email}` : ''} ({u.role})
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-1">Defaults to you; change if ordering on behalf of someone else.</p>
          </div>
        </div>

        {/* Date */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Requested For Date *</label>
          <input
            type="date"
            value={requestedForDate}
            min={today}
            onChange={e => setRequestedForDate(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Notes */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Any additional context or special instructions…"
          />
        </div>

        {/* High priority */}
        <label
          className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
            highPriority ? 'border-red-300 bg-red-50' : 'border-gray-200 hover:bg-gray-50'
          }`}
        >
          <input
            type="checkbox"
            checked={highPriority}
            onChange={e => setHighPriority(e.target.checked)}
            className="mt-0.5 h-4 w-4 text-red-600 rounded border-gray-300 focus:ring-red-500"
          />
          <div className="flex-1">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
              <AlertTriangle size={14} className={highPriority ? 'text-red-600' : 'text-gray-400'} />
              High Priority Request
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              When enabled, an email and Microsoft Teams message will be sent to the{' '}
              <span className="font-medium">High Priority Requests</span> user group.
            </p>
          </div>
        </label>

        {/* Insufficient stock (demo flag) */}
        <label
          className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
            insufficientStock ? 'border-amber-300 bg-amber-50' : 'border-gray-200 hover:bg-gray-50'
          }`}
        >
          <input
            type="checkbox"
            checked={insufficientStock}
            onChange={e => setInsufficientStock(e.target.checked)}
            className="mt-0.5 h-4 w-4 text-amber-600 rounded border-gray-300 focus:ring-amber-500"
          />
          <div className="flex-1">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
              <AlertTriangle size={14} className={insufficientStock ? 'text-amber-600' : 'text-gray-400'} />
              Show insufficient stock
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              Flags this order as having insufficient on-hand stock. It will appear on the{' '}
              <span className="font-medium">Insufficient Stock</span> dashboard tile for planners, who can
              raise a production order directly from it.
            </p>
          </div>
        </label>

        <button
          onClick={handleSubmit}
          disabled={saving || transferState.phase !== 'idle'}
          className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          <Save size={15} />
          {saving ? 'Submitting…' : transferState.phase !== 'idle' ? 'Order Submitted' : 'Submit Order'}
        </button>
      </div>

      {/* D365 transfer order status card */}
      {transferState.phase !== 'idle' && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Truck size={18} className="text-blue-600" />
            <h2 className="text-sm font-semibold text-gray-900">D365 Transfer Order</h2>
          </div>

          {transferState.phase === 'creating' && (
            <div className="flex items-center gap-2 text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-lg p-3">
              <Loader2 size={16} className="animate-spin" />
              Creating transfer order in Dynamics 365…
            </div>
          )}

          {transferState.phase === 'success' && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg p-3">
                <CheckCircle size={16} />
                Transfer order <span className="font-mono font-semibold">{transferState.transferOrderNumber}</span> created with {transferState.lineCount} line{transferState.lineCount === 1 ? '' : 's'}.
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs text-gray-700">
                <div className="bg-gray-50 rounded p-2">
                  <div className="text-gray-500">From Warehouse</div>
                  <div className="font-medium">{transferState.sourceWarehouse}</div>
                </div>
                <div className="bg-gray-50 rounded p-2">
                  <div className="text-gray-500">To Warehouse</div>
                  <div className="font-medium">{transferState.destinationWarehouse}</div>
                </div>
                <div className="bg-gray-50 rounded p-2">
                  <div className="text-gray-500">Ship Date</div>
                  <div className="font-medium">{transferState.shipDate.split('T')[0]}</div>
                </div>
                <div className="bg-gray-50 rounded p-2">
                  <div className="text-gray-500">Receive Date</div>
                  <div className="font-medium">{transferState.receiveDate.split('T')[0]}</div>
                </div>
              </div>
              <button
                onClick={() => navigate('/reagent-orders')}
                className="w-full mt-2 bg-gray-900 text-white py-2 rounded-lg text-sm font-medium hover:bg-gray-800"
              >
                View All Orders
              </button>
            </div>
          )}

          {transferState.phase === 'failed' && (
            <div className="space-y-2">
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
                <div className="font-medium mb-1">Transfer order creation failed</div>
                <div className="text-xs whitespace-pre-wrap break-words">{transferState.error}</div>
              </div>
              <p className="text-xs text-gray-500">
                The reagent order was saved. The transfer order can be retried by an administrator from D365.
              </p>
              <button
                onClick={() => navigate('/reagent-orders')}
                className="w-full bg-gray-900 text-white py-2 rounded-lg text-sm font-medium hover:bg-gray-800"
              >
                Continue
              </button>
            </div>
          )}

          {transferState.phase === 'skipped' && (
            <div className="space-y-2">
              <div className="text-sm text-yellow-800 bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                D365 integration is disabled — transfer order was not created. ({transferState.reason})
              </div>
              <button
                onClick={() => navigate('/reagent-orders')}
                className="w-full bg-gray-900 text-white py-2 rounded-lg text-sm font-medium hover:bg-gray-800"
              >
                Continue
              </button>
            </div>
          )}
        </div>
      )}

      {/* High-priority mock notification modal */}
      {priorityModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full overflow-hidden">
            <div className="bg-red-600 text-white p-4 flex items-center gap-3">
              <AlertTriangle size={22} />
              <div className="flex-1">
                <h2 className="font-bold">High Priority Notification Sent</h2>
                <p className="text-xs text-red-100">Order {priorityModal.orderNumber} flagged as urgent</p>
              </div>
              <button onClick={() => { setPriorityModal(null); navigate('/reagent-orders'); }} className="text-white/80 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg p-2.5">
                <CheckCircle size={16} />
                Notifications dispatched to the <span className="font-semibold">High Priority Requests</span> group.
              </div>

              {/* Mock email */}
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-200 text-xs text-gray-600">
                  <Mail size={14} className="text-blue-600" />
                  <span className="font-medium">Email</span>
                  <span className="ml-auto text-gray-400">To: high-priority-requests@arup.local</span>
                </div>
                <div className="p-3 text-sm">
                  <p className="font-semibold text-gray-900 mb-1">
                    🚨 HIGH PRIORITY: New reagent order {priorityModal.orderNumber}
                  </p>
                  <p className="text-gray-700">
                    <span className="font-medium">{priorityModal.requesterName}</span> ({priorityModal.labName}) has
                    submitted an urgent request with <span className="font-medium">{priorityModal.itemCount}</span> item{priorityModal.itemCount === 1 ? '' : 's'}:{' '}
                    <span className="font-medium">{priorityModal.summary}</span>.
                  </p>
                  <p className="text-gray-700 mt-1">
                    Please action immediately in the Lab WI System &rarr; Reagent Orders.
                  </p>
                </div>
              </div>

              {/* Mock Teams */}
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-200 text-xs text-gray-600">
                  <MessageSquare size={14} className="text-purple-600" />
                  <span className="font-medium">Microsoft Teams</span>
                  <span className="ml-auto text-gray-400">Channel: High Priority Requests</span>
                </div>
                <div className="p-3 text-sm bg-purple-50/40">
                  <p className="text-gray-800">
                    <span className="font-semibold">@HighPriorityRequests</span> 🚨 New urgent reagent order{' '}
                    <span className="font-mono text-purple-700">{priorityModal.orderNumber}</span> from{' '}
                    <span className="font-medium">{priorityModal.labName}</span> —{' '}
                    {priorityModal.itemCount} item{priorityModal.itemCount === 1 ? '' : 's'}: {priorityModal.summary}. Requester:{' '}
                    {priorityModal.requesterName}.
                  </p>
                </div>
              </div>

              <button
                onClick={() => { setPriorityModal(null); navigate('/reagent-orders'); }}
                className="w-full flex items-center justify-center gap-2 bg-gray-900 text-white py-2 rounded-lg text-sm font-medium hover:bg-gray-800"
              >
                <Send size={14} />
                Acknowledge & View Orders
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
