import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { ReagentItem, QCTest, QCResultType } from '../types';
import { cn } from '../lib/utils';
import { QC_PRESETS, formatSpec } from '../lib/qc';
import {
  FlaskConical, Plus, Search, Pencil, Trash2, RefreshCw,
  X, ExternalLink, ChevronDown, ChevronUp, Info, Settings2,
  CheckCircle, AlertTriangle, Loader, Eye, EyeOff, ClipboardCheck,
} from 'lucide-react';

// ─── GHS pictogram labels ─────────────────────────────────────────────────────

// ─── D365 config type ────────────────────────────────────────────────────────
interface D365Config {
  id: string;
  d365_url: string;
  tenant_id: string;
  client_id: string;
  buyer_group: string;
  company: string;
  mes_message_queue: string;
  enabled: boolean;
  last_sync_at?: string;
  last_sync_status?: string;
  last_sync_count?: number;
  last_sync_error?: string;
}
const GHS_LABELS: Record<string, string> = {
  GHS01: 'Explosive',
  GHS02: 'Flammable',
  GHS03: 'Oxidising',
  GHS04: 'Compressed Gas',
  GHS05: 'Corrosive',
  GHS06: 'Toxic',
  GHS07: 'Harmful/Irritant',
  GHS08: 'Health Hazard',
  GHS09: 'Environmental',
};

const GHS_COLORS: Record<string, string> = {
  GHS01: 'bg-red-100 text-red-800',
  GHS02: 'bg-orange-100 text-orange-800',
  GHS03: 'bg-yellow-100 text-yellow-800',
  GHS04: 'bg-blue-100 text-blue-800',
  GHS05: 'bg-purple-100 text-purple-800',
  GHS06: 'bg-red-100 text-red-900',
  GHS07: 'bg-amber-100 text-amber-800',
  GHS08: 'bg-pink-100 text-pink-800',
  GHS09: 'bg-green-100 text-green-800',
};

const PURITY_GRADES = [
  'ACS Grade',
  'HPLC Grade',
  'Reagent Grade',
  'Technical Grade',
  'Laboratory Grade',
  'Analytical Grade',
  'USP Grade',
  'NF Grade',
  'Ultra-High Purity',
  'Trace Metal Basis',
];

const STORAGE_OPTIONS = [
  'Room temperature',
  'Refrigerate 2–8 °C',
  'Freeze –20 °C',
  'Freeze –80 °C',
  'Protect from light',
  'Store under nitrogen',
  'Keep dry',
  'Flammables cabinet',
  'Acid cabinet',
  'Corrosives cabinet',
];

const HAZARD_OPTIONS = [
  'Non-hazardous',
  'Flammable',
  'Corrosive',
  'Toxic',
  'Oxidiser',
  'Irritant',
  'Health Hazard',
  'Compressed Gas',
  'Explosive',
  'Environmental Hazard',
];

const UOM_OPTIONS = ['g', 'kg', 'mg', 'mL', 'L', 'µL', 'mol', 'mmol', 'units', 'each'];

const ITEM_TYPE_OPTIONS: { value: 'FG' | 'RM' | 'PKG'; label: string }[] = [
  { value: 'RM', label: 'RM · Raw Material' },
  { value: 'FG', label: 'FG · Finished Good' },
  { value: 'PKG', label: 'PKG · Packaging' },
];

const ITEM_TYPE_BADGE: Record<string, string> = {
  FG: 'bg-emerald-100 text-emerald-800',
  RM: 'bg-amber-100 text-amber-800',
  PKG: 'bg-purple-100 text-purple-800',
};

const GHS_ALL = Object.keys(GHS_LABELS);

// ─── Empty form state ─────────────────────────────────────────────────────────
function emptyForm(): Partial<ReagentItem> {
  return {
    item_number: '',
    item_type: 'RM',
    product_name: '',
    search_name: '',
    cas_number: '',
    molecular_formula: '',
    molecular_weight: undefined,
    purity_grade: '',
    unit_of_measure: 'g',
    min_order_qty: undefined,
    vendor: '',
    storage_conditions: '',
    hazard_class: '',
    ghs_pictograms: [],
    sds_url: '',
    is_active: true,
    lot_controlled: false,
    notes: '',
    d365_product_id: '',
  };
}

// ─── Form modal ───────────────────────────────────────────────────────────────
function ReagentItemModal({
  item,
  onClose,
  onSave,
  isSaving,
}: {
  item: Partial<ReagentItem>;
  onClose: () => void;
  onSave: (data: Partial<ReagentItem>) => void;
  isSaving: boolean;
}) {
  const [form, setForm] = useState<Partial<ReagentItem>>(item);

  function set(k: keyof ReagentItem, v: unknown) {
    setForm(f => ({ ...f, [k]: v }));
  }

  function toggleGHS(code: string) {
    const current = form.ghs_pictograms ?? [];
    set('ghs_pictograms', current.includes(code)
      ? current.filter(c => c !== code)
      : [...current, code]);
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-200 sticky top-0 bg-white z-10">
          <h2 className="text-lg font-semibold text-gray-900">
            {item.id ? 'Edit Reagent Item' : 'Add Reagent Item'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* D365 fields */}
          <fieldset className="space-y-3">
            <legend className="text-xs font-semibold text-gray-400 uppercase tracking-wider">D365 Identity</legend>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Item Number <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.item_number ?? ''}
                  onChange={e => set('item_number', e.target.value)}
                  placeholder="e.g. NACL-0001"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">D365 Product ID</label>
                <input
                  type="text"
                  value={form.d365_product_id ?? ''}
                  onChange={e => set('d365_product_id', e.target.value)}
                  placeholder="Optional distinct product ID"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Item Type <span className="text-red-500">*</span>
                </label>
                <select
                  value={form.item_type ?? 'RM'}
                  onChange={e => set('item_type', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  {ITEM_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <p className="text-xs text-gray-400 mt-1">Drives FG / RM / PKG filtering on the Inventory screen</p>
              </div>
            </div>
          </fieldset>

          {/* Core chemistry */}
          <fieldset className="space-y-3">
            <legend className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Chemistry</legend>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Product Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.product_name ?? ''}
                onChange={e => set('product_name', e.target.value)}
                placeholder="e.g. Sodium Chloride"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-400 mt-1">Friendly display name — edit freely.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Search Name</label>
              <input
                type="text"
                value={form.search_name ?? ''}
                onChange={e => set('search_name', e.target.value)}
                placeholder="D365 product search name"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-400 mt-1">Raw value from D365 (ProductSearchName).</p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">CAS Number</label>
                <input
                  type="text"
                  value={form.cas_number ?? ''}
                  onChange={e => set('cas_number', e.target.value)}
                  placeholder="e.g. 7647-14-5"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Molecular Formula</label>
                <input
                  type="text"
                  value={form.molecular_formula ?? ''}
                  onChange={e => set('molecular_formula', e.target.value)}
                  placeholder="e.g. NaCl"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">MW (g/mol)</label>
                <input
                  type="number"
                  step="0.0001"
                  value={form.molecular_weight ?? ''}
                  onChange={e => set('molecular_weight', e.target.value === '' ? undefined : parseFloat(e.target.value))}
                  placeholder="e.g. 58.44"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Purity / Grade</label>
              <select
                value={form.purity_grade ?? ''}
                onChange={e => set('purity_grade', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">— select grade —</option>
                {PURITY_GRADES.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
          </fieldset>

          {/* Supply chain */}
          <fieldset className="space-y-3">
            <legend className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Supply Chain (D365)</legend>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Unit of Measure</label>
                <select
                  value={form.unit_of_measure ?? 'g'}
                  onChange={e => set('unit_of_measure', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  {UOM_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Min Order Qty</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.min_order_qty ?? ''}
                  onChange={e => set('min_order_qty', e.target.value === '' ? undefined : parseFloat(e.target.value))}
                  placeholder="e.g. 500"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Vendor / Supplier</label>
                <input
                  type="text"
                  value={form.vendor ?? ''}
                  onChange={e => set('vendor', e.target.value)}
                  placeholder="e.g. Sigma-Aldrich"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </fieldset>

          {/* Safety */}
          <fieldset className="space-y-3">
            <legend className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Safety &amp; Storage</legend>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Storage Conditions</label>
                <select
                  value={form.storage_conditions ?? ''}
                  onChange={e => set('storage_conditions', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="">— select —</option>
                  {STORAGE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Hazard Class</label>
                <select
                  value={form.hazard_class ?? ''}
                  onChange={e => set('hazard_class', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="">— select —</option>
                  {HAZARD_OPTIONS.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            </div>

            {/* GHS pictograms */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">GHS Pictograms</label>
              <div className="flex flex-wrap gap-2">
                {GHS_ALL.map(code => {
                  const selected = (form.ghs_pictograms ?? []).includes(code);
                  return (
                    <button
                      key={code}
                      type="button"
                      onClick={() => toggleGHS(code)}
                      className={cn(
                        'px-2.5 py-1 rounded-full text-xs font-medium border transition-colors',
                        selected
                          ? (GHS_COLORS[code] ?? 'bg-gray-200') + ' border-transparent'
                          : 'border-gray-200 text-gray-500 hover:border-gray-300'
                      )}
                    >
                      {code} · {GHS_LABELS[code]}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">SDS URL</label>
              <input
                type="url"
                value={form.sds_url ?? ''}
                onChange={e => set('sds_url', e.target.value)}
                placeholder="https://…"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </fieldset>

          {/* Notes + status */}
          <fieldset className="space-y-3">
            <legend className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Additional</legend>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <textarea
                rows={3}
                value={form.notes ?? ''}
                onChange={e => set('notes', e.target.value)}
                placeholder="Internal notes, special handling instructions…"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.is_active ?? true}
                onChange={e => set('is_active', e.target.checked)}
                className="w-4 h-4 rounded accent-blue-600"
              />
              <span className="text-sm text-gray-700">Active (visible to authors)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.lot_controlled ?? false}
                onChange={e => set('lot_controlled', e.target.checked)}
                className="w-4 h-4 rounded accent-teal-600"
              />
              <span className="text-sm text-gray-700">Lot / Batch Controlled</span>
              <span className="text-xs text-gray-400">(operator must record lot number at use)</span>
            </label>
          </fieldset>
        </div>

        <div className="flex justify-end gap-3 px-5 py-4 border-t border-gray-200 sticky bottom-0 bg-white">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(form)}
            disabled={isSaving || !form.item_number?.trim() || !form.product_name?.trim()}
            className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white text-sm rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {isSaving ? 'Saving…' : item.id ? 'Save Changes' : 'Add Item'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── QC specification editor ──────────────────────────────────────────────────
type QCRow = Partial<QCTest> & { _key: string };

let qcKeySeq = 0;
const newKey = () => `qc-${Date.now()}-${qcKeySeq++}`;

function QCSpecModal({
  item, canManage, onClose,
}: {
  item: ReagentItem;
  canManage: boolean;
  onClose: () => void;
}) {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [rows, setRows] = useState<QCRow[] | null>(null);
  const [error, setError] = useState('');

  const { data: tests = [], isLoading } = useQuery<QCTest[]>({
    queryKey: ['qc-tests', item.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('qc_tests')
        .select('*')
        .eq('reagent_item_id', item.id)
        .order('test_order');
      if (error) throw error;
      return data as QCTest[];
    },
  });

  // initialise editable rows once the query resolves
  const editRows = rows ?? tests.map(t => ({ ...t, _key: t.id }));

  function update(key: string, patch: Partial<QCTest>) {
    setRows(editRows.map(r => r._key === key ? { ...r, ...patch } : r));
  }
  function remove(key: string) {
    setRows(editRows.filter(r => r._key !== key));
  }
  function addBlank() {
    setRows([...editRows, { _key: newKey(), name: '', unit: '', result_type: 'numeric', is_active: true }]);
  }
  function addPreset(name: string) {
    const preset = QC_PRESETS.find(p => p.name === name);
    if (!preset) return;
    setRows([...editRows, {
      _key: newKey(),
      name: preset.name,
      unit: preset.unit,
      result_type: preset.result_type,
      lower_limit: preset.lower_limit ?? null,
      upper_limit: preset.upper_limit ?? null,
      expected_text: preset.expected_text ?? null,
      method: preset.method ?? null,
      is_active: true,
    }]);
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const current = editRows.filter(r => (r.name ?? '').trim());
      const existingIds = new Set(tests.map(t => t.id));
      const keptIds = new Set(current.filter(r => r.id).map(r => r.id as string));
      const toDelete = [...existingIds].filter(id => !keptIds.has(id));

      if (toDelete.length) {
        const { error } = await supabase.from('qc_tests').delete().in('id', toDelete);
        if (error) throw error;
      }

      for (let i = 0; i < current.length; i++) {
        const r = current[i];
        const isText = r.result_type === 'text';
        const payload = {
          reagent_item_id: item.id,
          test_order: i,
          name: (r.name ?? '').trim(),
          unit: r.unit?.toString().trim() || null,
          result_type: r.result_type ?? 'numeric',
          lower_limit: isText ? null : (r.lower_limit ?? null),
          upper_limit: isText ? null : (r.upper_limit ?? null),
          target: isText ? null : (r.target ?? null),
          expected_text: isText ? (r.expected_text?.trim() || null) : null,
          method: r.method?.toString().trim() || null,
          is_active: r.is_active ?? true,
        };
        if (r.id) {
          const { error } = await supabase.from('qc_tests').update(payload).eq('id', r.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from('qc_tests').insert({ ...payload, created_by: profile!.id });
          if (error) throw error;
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['qc-tests', item.id] });
      onClose();
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Save failed'),
  });

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-200 sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <ClipboardCheck size={18} className="text-emerald-600" />
              QC Specifications
            </h2>
            <p className="text-sm text-gray-500 mt-0.5">{item.item_number} · {item.product_name}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={20} /></button>
        </div>

        <div className="p-5 space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

          <p className="text-sm text-gray-500">
            Define the quality tests run on every lot of this product. Limits are used to judge pass/fail
            during production and printed on the Certificate of Analysis.
          </p>

          {isLoading ? (
            <div className="text-center py-8 text-gray-400">Loading…</div>
          ) : editRows.length === 0 ? (
            <div className="text-center py-8 bg-gray-50 rounded-xl border border-dashed border-gray-200 text-gray-500 text-sm">
              No QC tests defined yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                    <th className="py-2 pr-2 font-medium">Test</th>
                    <th className="py-2 px-2 font-medium">Type</th>
                    <th className="py-2 px-2 font-medium">Lower</th>
                    <th className="py-2 px-2 font-medium">Upper</th>
                    <th className="py-2 px-2 font-medium">Unit</th>
                    <th className="py-2 px-2 font-medium">Expected (text)</th>
                    <th className="py-2 px-2 font-medium">Method</th>
                    <th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {editRows.map(r => {
                    const isText = r.result_type === 'text';
                    return (
                      <tr key={r._key}>
                        <td className="py-1.5 pr-2">
                          <input
                            value={r.name ?? ''}
                            disabled={!canManage}
                            onChange={e => update(r._key, { name: e.target.value })}
                            placeholder="e.g. pH"
                            className="w-32 border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-gray-50"
                          />
                        </td>
                        <td className="py-1.5 px-2">
                          <select
                            value={r.result_type ?? 'numeric'}
                            disabled={!canManage}
                            onChange={e => update(r._key, { result_type: e.target.value as QCResultType })}
                            className="border border-gray-200 rounded px-1.5 py-1 text-sm bg-white disabled:bg-gray-50"
                          >
                            <option value="numeric">numeric</option>
                            <option value="text">text</option>
                          </select>
                        </td>
                        <td className="py-1.5 px-2">
                          <input
                            type="number" step="any"
                            value={r.lower_limit ?? ''}
                            disabled={!canManage || isText}
                            onChange={e => update(r._key, { lower_limit: e.target.value === '' ? null : parseFloat(e.target.value) })}
                            className="w-20 border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-gray-50"
                          />
                        </td>
                        <td className="py-1.5 px-2">
                          <input
                            type="number" step="any"
                            value={r.upper_limit ?? ''}
                            disabled={!canManage || isText}
                            onChange={e => update(r._key, { upper_limit: e.target.value === '' ? null : parseFloat(e.target.value) })}
                            className="w-20 border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-gray-50"
                          />
                        </td>
                        <td className="py-1.5 px-2">
                          <input
                            value={r.unit ?? ''}
                            disabled={!canManage || isText}
                            onChange={e => update(r._key, { unit: e.target.value })}
                            placeholder="mOsm/kg"
                            className="w-24 border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-gray-50"
                          />
                        </td>
                        <td className="py-1.5 px-2">
                          <input
                            value={r.expected_text ?? ''}
                            disabled={!canManage || !isText}
                            onChange={e => update(r._key, { expected_text: e.target.value })}
                            placeholder="Clear, colorless"
                            className="w-36 border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-gray-50"
                          />
                        </td>
                        <td className="py-1.5 px-2">
                          <input
                            value={r.method ?? ''}
                            disabled={!canManage}
                            onChange={e => update(r._key, { method: e.target.value })}
                            placeholder="USP <791>"
                            className="w-28 border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-gray-50"
                          />
                        </td>
                        <td className="py-1.5 pl-2 text-right">
                          {canManage && (
                            <button onClick={() => remove(r._key)} className="text-gray-300 hover:text-red-600">
                              <Trash2 size={14} />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {canManage && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                onClick={addBlank}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-700"
              >
                <Plus size={14} /> Add test
              </button>
              <select
                value=""
                onChange={e => { if (e.target.value) addPreset(e.target.value); e.target.value = ''; }}
                className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white text-gray-600"
              >
                <option value="">+ Add from common tests…</option>
                {QC_PRESETS.map(p => (
                  <option key={p.name} value={p.name}>
                    {p.name}{p.unit ? ` (${p.unit})` : ''} — {formatSpec(p)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 px-5 py-4 border-t border-gray-200 sticky bottom-0 bg-white">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
            {canManage ? 'Cancel' : 'Close'}
          </button>
          {canManage && (
            <button
              onClick={() => { setError(''); saveMutation.mutate(); }}
              disabled={saveMutation.isPending}
              className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white text-sm rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {saveMutation.isPending ? 'Saving…' : 'Save QC Panel'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Row detail expand ────────────────────────────────────────────────────────
function ReagentRow({
  item,
  isAdmin,
  onEdit,
  onDelete,
  onManageQC,
}: {
  item: ReagentItem;
  isAdmin: boolean;
  onEdit: (item: ReagentItem) => void;
  onDelete: (id: string) => void;
  onManageQC: (item: ReagentItem) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr
        className={cn(
          'hover:bg-blue-50/40 transition-colors cursor-pointer',
          !item.is_active && 'opacity-50'
        )}
        onClick={() => setExpanded(e => !e)}
      >
        <td className="px-4 py-3 font-mono text-sm font-medium text-gray-900 whitespace-nowrap">
          {item.item_number}
        </td>
        <td className="px-4 py-3">
          <p className="text-sm font-medium text-gray-900">{item.product_name}</p>
          {item.search_name && (
            <p className="text-xs text-gray-400 font-mono mt-0.5">{item.search_name}</p>
          )}
          {item.purity_grade && (
            <p className="text-xs text-blue-600 mt-0.5">{item.purity_grade}</p>
          )}
          {item.lot_controlled && (
            <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-teal-100 text-teal-700 uppercase tracking-wide">LOT</span>
          )}
        </td>
        <td className="px-4 py-3">
          <span className={cn('px-2 py-0.5 rounded-full text-xs font-semibold', ITEM_TYPE_BADGE[item.item_type] ?? 'bg-gray-100 text-gray-600')}>
            {item.item_type}
          </span>
        </td>
        <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{item.cas_number ?? '—'}</td>
        <td className="px-4 py-3 text-sm text-gray-600 font-mono">{item.molecular_formula ?? '—'}</td>
        <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
          {item.molecular_weight != null ? `${item.molecular_weight} g/mol` : '—'}
        </td>
        <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{item.unit_of_measure}</td>
        <td className="px-4 py-3">
          {item.hazard_class ? (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
              {item.hazard_class}
            </span>
          ) : <span className="text-xs text-gray-400">—</span>}
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-1 justify-end" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => onManageQC(item)}
              className="p-1 text-gray-400 hover:text-emerald-600 transition-colors"
              title="QC specifications"
            >
              <ClipboardCheck size={14} />
            </button>
            {isAdmin && (
              <>
                <button
                  onClick={() => onEdit(item)}
                  className="p-1 text-gray-400 hover:text-blue-600 transition-colors"
                  title="Edit"
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => onDelete(item.id)}
                  className="p-1 text-gray-400 hover:text-red-600 transition-colors"
                  title="Delete"
                >
                  <Trash2 size={14} />
                </button>
              </>
            )}
            <button
              onClick={() => setExpanded(e => !e)}
              className="p-1 text-gray-400 hover:text-gray-700"
              title="Details"
            >
              {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </button>
          </div>
        </td>
      </tr>

      {expanded && (
        <tr className="bg-blue-50/30 border-b border-blue-100">
          <td colSpan={9} className="px-6 py-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              {item.vendor && (
                <div>
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-0.5">Vendor</p>
                  <p className="text-gray-800">{item.vendor}</p>
                </div>
              )}
              {item.min_order_qty != null && (
                <div>
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-0.5">Min Order Qty</p>
                  <p className="text-gray-800">{item.min_order_qty} {item.unit_of_measure}</p>
                </div>
              )}
              {item.storage_conditions && (
                <div>
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-0.5">Storage</p>
                  <p className="text-gray-800">{item.storage_conditions}</p>
                </div>
              )}
              {item.d365_product_id && (
                <div>
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-0.5">D365 Product ID</p>
                  <p className="text-gray-800 font-mono">{item.d365_product_id}</p>
                </div>
              )}
              {item.d365_synced_at && (
                <div>
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-0.5">Last D365 Sync</p>
                  <p className="text-gray-800">{new Date(item.d365_synced_at).toLocaleString()}</p>
                </div>
              )}
              {(item.ghs_pictograms?.length ?? 0) > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">GHS Pictograms</p>
                  <div className="flex flex-wrap gap-1">
                    {(item.ghs_pictograms ?? []).map(code => (
                      <span key={code} className={cn('px-2 py-0.5 rounded-full text-xs font-medium', GHS_COLORS[code] ?? 'bg-gray-100 text-gray-700')}>
                        {code} · {GHS_LABELS[code] ?? code}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {item.sds_url && (
                <div>
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-0.5">Safety Data Sheet</p>
                  <a
                    href={item.sds_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-blue-600 hover:underline text-sm"
                    onClick={e => e.stopPropagation()}
                  >
                    Open SDS <ExternalLink size={12} />
                  </a>
                </div>
              )}
              {item.notes && (
                <div className="md:col-span-3">
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-0.5">Notes</p>
                  <p className="text-gray-700 whitespace-pre-line">{item.notes}</p>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── D365 Config Panel (admin only) ──────────────────────────────────────────
function D365ConfigPanel({
  cfg, onSaved, onSync, isSyncing, syncResult, onClear, isClearing,
}: {
  cfg: D365Config | null;
  onSaved: () => void;
  onSync: (testOnly: boolean) => void;
  isSyncing: boolean;
  syncResult: { success: boolean; message?: string; error?: string; synced?: number; debug_query_url?: string } | null;
  onClear: () => void;
  isClearing: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Omit<D365Config, 'id' | 'last_sync_at' | 'last_sync_status' | 'last_sync_count' | 'last_sync_error'> | null>(null);
  const [showUrl, setShowUrl] = useState(false);
  const qc = useQueryClient();

  function startEdit() {
    setForm({
      d365_url: cfg?.d365_url ?? '',
      tenant_id: cfg?.tenant_id ?? '',
      client_id: cfg?.client_id ?? '',
      buyer_group: cfg?.buyer_group ?? '',
      company: cfg?.company ?? '',
      mes_message_queue: cfg?.mes_message_queue ?? 'JmgMES3P',
      enabled: cfg?.enabled ?? false,
    });
  }

  const saveCfgMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      if (!data) return;
      const { error } = await supabase
        .from('d365_config')
        .update(data)
        .eq('id', '00000000-0000-0000-0000-000000000001');
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['d365-config'] });
      setForm(null);
      onSaved();
    },
  });

  const isConfigured = !!(cfg?.d365_url && cfg?.tenant_id && cfg?.client_id);

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      {/* Header row */}
      <button
        onClick={() => { setOpen(o => !o); if (!open && !form && cfg) setForm(null); }}
        className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-gray-50 transition-colors"
      >
        <Settings2 size={16} className="text-indigo-500 shrink-0" />
        <span className="font-medium text-gray-900 text-sm flex-1">D365 Connection Settings</span>
        <div className="flex items-center gap-3">
          {cfg?.enabled && isConfigured && (
            <span className="flex items-center gap-1 text-xs text-green-700 font-medium">
              <CheckCircle size={12} /> Enabled
            </span>
          )}
          {cfg?.enabled && !isConfigured && (
            <span className="flex items-center gap-1 text-xs text-amber-700 font-medium">
              <AlertTriangle size={12} /> Incomplete config
            </span>
          )}
          {cfg?.last_sync_at && (
            <span className="text-xs text-gray-400">
              Last sync: {new Date(cfg.last_sync_at).toLocaleString()}
              {cfg.last_sync_count != null && ` · ${cfg.last_sync_count} items`}
            </span>
          )}
          {open ? <ChevronUp size={15} className="text-gray-400" /> : <ChevronDown size={15} className="text-gray-400" />}
        </div>
      </button>

      {open && (
        <div className="border-t border-gray-100 px-5 py-4 space-y-4">
          {/* Last sync error */}
          {cfg?.last_sync_status === 'error' && cfg.last_sync_error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-800">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">Last sync failed</p>
                <p className="text-xs mt-0.5 font-mono">{cfg.last_sync_error}</p>
              </div>
            </div>
          )}

          {!form ? (
            // Read-only view
            <div className="space-y-3">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <div>
                  <dt className="text-xs font-medium text-gray-400 uppercase tracking-wide">Environment URL</dt>
                  <dd className="text-gray-800 font-mono text-xs mt-0.5 truncate">{cfg?.d365_url || <span className="text-gray-400 italic">not set</span>}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-400 uppercase tracking-wide">Tenant ID</dt>
                  <dd className="text-gray-800 font-mono text-xs mt-0.5">{cfg?.tenant_id || <span className="text-gray-400 italic">not set</span>}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-400 uppercase tracking-wide">Client ID</dt>
                  <dd className="text-gray-800 font-mono text-xs mt-0.5">{cfg?.client_id || <span className="text-gray-400 italic">not set</span>}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-400 uppercase tracking-wide">Buyer Group Filter</dt>
                  <dd className="text-gray-800 mt-0.5">{cfg?.buyer_group || <span className="text-gray-400 italic">all items</span>}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-400 uppercase tracking-wide">Company (Legal Entity)</dt>
                  <dd className="text-gray-800 font-mono text-xs mt-0.5">{cfg?.company || <span className="text-gray-400 italic">environment default</span>}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-400 uppercase tracking-wide">MES Message Queue</dt>
                  <dd className="text-gray-800 font-mono text-xs mt-0.5">{cfg?.mes_message_queue || <span className="text-gray-400 italic">not set</span>}</dd>
                </div>
              </dl>
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={startEdit}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-700"
                >
                  <Pencil size={13} /> Edit Settings
                </button>
              </div>
            </div>
          ) : (
            // Edit form
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    D365 Environment URL <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showUrl ? 'text' : 'password'}
                      value={form.d365_url}
                      onChange={e => setForm(f => f ? { ...f, d365_url: e.target.value } : f)}
                      placeholder="https://myorg.sandbox.operations.dynamics.com"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowUrl(s => !s)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showUrl ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Tenant ID <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={form.tenant_id}
                    onChange={e => setForm(f => f ? { ...f, tenant_id: e.target.value } : f)}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Client ID <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={form.client_id}
                    onChange={e => setForm(f => f ? { ...f, client_id: e.target.value } : f)}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Buyer Group Filter</label>
                  <input
                    type="text"
                    value={form.buyer_group}
                    onChange={e => setForm(f => f ? { ...f, buyer_group: e.target.value } : f)}
                    placeholder="e.g. REAGENT (blank = all)"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Company (Legal Entity)</label>
                  <input
                    type="text"
                    value={form.company}
                    onChange={e => setForm(f => f ? { ...f, company: e.target.value } : f)}
                    placeholder="e.g. USP2 (blank = environment default)"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs text-gray-400 mt-1">D365 legal entity code — sets <code>?company=</code> on the OData request and <code>_companyId</code> on the MES start message</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">MES Message Queue</label>
                  <input
                    type="text"
                    value={form.mes_message_queue}
                    onChange={e => setForm(f => f ? { ...f, mes_message_queue: e.target.value } : f)}
                    placeholder="e.g. JmgMES3P"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs text-gray-400 mt-1">SysMessage queue for the <code>ProdProductionOrderStart</code> message (<code>_messageQueue</code>)</p>
                </div>
                <div className="flex items-center">
                  <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.enabled}
                      onChange={e => setForm(f => f ? { ...f, enabled: e.target.checked } : f)}
                      className="w-4 h-4 rounded accent-blue-600"
                    />
                    Enable D365 sync
                  </label>
                </div>
              </div>

              {/* Client secret note */}
              <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold">Client secret is stored separately as a Supabase secret</p>
                  <p className="mt-0.5">Run once in your terminal:</p>
                  <code className="block bg-amber-100 rounded px-2 py-1 mt-1 font-mono select-all">
                    supabase secrets set D365_CLIENT_SECRET=&lt;your_secret&gt;
                  </code>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => saveCfgMutation.mutate(form)}
                  disabled={saveCfgMutation.isPending || !form.d365_url || !form.tenant_id || !form.client_id}
                  className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {saveCfgMutation.isPending ? 'Saving…' : 'Save Settings'}
                </button>
                <button
                  onClick={() => setForm(null)}
                  className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Sync result feedback */}
          {syncResult && (
            <div className={cn(
              'rounded-lg px-3 py-2 text-sm space-y-1.5',
              syncResult.success
                ? 'bg-green-50 border border-green-200 text-green-800'
                : 'bg-red-50 border border-red-200 text-red-800'
            )}>
              <div className="flex items-start gap-2">
                {syncResult.success
                  ? <CheckCircle size={15} className="mt-0.5 shrink-0" />
                  : <AlertTriangle size={15} className="mt-0.5 shrink-0" />}
                <p>{syncResult.message ?? syncResult.error}</p>
              </div>
              {syncResult.debug_query_url && (
                <div className="text-xs opacity-75">
                  <p className="font-medium mb-0.5">OData query URL (for debugging):</p>
                  <code className="block break-all font-mono bg-black/5 rounded px-2 py-1 select-all">{syncResult.debug_query_url}</code>
                </div>
              )}
            </div>
          )}

          {/* Sync action buttons */}
          {isConfigured && cfg?.enabled && !form && (
            <div className="flex flex-wrap gap-2 pt-1 items-center">
              <button
                onClick={() => onSync(true)}
                disabled={isSyncing || isClearing}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700 disabled:opacity-50"
              >
                {isSyncing ? <Loader size={13} className="animate-spin" /> : <CheckCircle size={13} />}
                Test Connection
              </button>
              <button
                onClick={() => onSync(false)}
                disabled={isSyncing || isClearing}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                {isSyncing ? <Loader size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                {isSyncing ? 'Syncing…' : 'Sync Items from D365'}
              </button>
              <button
                onClick={onClear}
                disabled={isSyncing || isClearing}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-red-200 text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-50 ml-auto"
              >
                {isClearing ? <Loader size={13} className="animate-spin" /> : <Trash2 size={13} />}
                {isClearing ? 'Clearing…' : 'Clear All Items'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function ReagentItemsPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const isAdmin = profile?.role === 'admin';

  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [modalItem, setModalItem] = useState<Partial<ReagentItem> | null>(null);
  const [qcItem, setQcItem] = useState<ReagentItem | null>(null);
  const [syncResult, setSyncResult] = useState<{ success: boolean; message?: string; error?: string; synced?: number; debug_query_url?: string } | null>(null);
  const canManageQC = profile?.role === 'admin' || profile?.role === 'author' || profile?.role === 'approver';

  const { data: items = [], isLoading } = useQuery<ReagentItem[]>({
    queryKey: ['reagent-items'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reagent_items')
        .select('*')
        .order('item_number');
      if (error) throw error;
      return data as ReagentItem[];
    },
  });

  const { data: d365Config = null } = useQuery<D365Config | null>({
    queryKey: ['d365-config'],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase.from('d365_config').select('*').single();
      if (error) return null;
      return data as D365Config;
    },
  });

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return items.filter(item => {
      if (!showInactive && !item.is_active) return false;
      if (!q) return true;
      return (
        item.item_number.toLowerCase().includes(q) ||
        item.product_name.toLowerCase().includes(q) ||
        (item.search_name ?? '').toLowerCase().includes(q) ||
        (item.cas_number ?? '').toLowerCase().includes(q) ||
        (item.molecular_formula ?? '').toLowerCase().includes(q) ||
        (item.vendor ?? '').toLowerCase().includes(q) ||
        (item.purity_grade ?? '').toLowerCase().includes(q)
      );
    });
  }, [items, search, showInactive]);

  const saveMutation = useMutation({
    mutationFn: async (form: Partial<ReagentItem>) => {
      const payload = {
        item_number: form.item_number,
        d365_product_id: form.d365_product_id || null,
        item_type: form.item_type ?? 'RM',
        product_name: form.product_name,
        search_name: form.search_name || null,
        cas_number: form.cas_number || null,
        molecular_formula: form.molecular_formula || null,
        molecular_weight: form.molecular_weight ?? null,
        purity_grade: form.purity_grade || null,
        unit_of_measure: form.unit_of_measure ?? 'g',
        min_order_qty: form.min_order_qty ?? null,
        vendor: form.vendor || null,
        storage_conditions: form.storage_conditions || null,
        hazard_class: form.hazard_class || null,
        ghs_pictograms: form.ghs_pictograms?.length ? form.ghs_pictograms : null,
        sds_url: form.sds_url || null,
        is_active: form.is_active ?? true,
        lot_controlled: form.lot_controlled ?? false,
        notes: form.notes || null,
        created_by: profile!.id,
        updated_by: profile!.id,
      };

      if (form.id) {
        const { error } = await supabase
          .from('reagent_items')
          .update({ ...payload, updated_by: profile!.id })
          .eq('id', form.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('reagent_items')
          .insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reagent-items'] });
      setModalItem(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('reagent_items').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reagent-items'] }),
  });

  const syncMutation = useMutation({
    mutationFn: async (testOnly: boolean) => {
      setSyncResult(null);
      const { data, error } = await supabase.functions.invoke('sync-d365-reagents', {
        body: { testOnly },
      });
      // When the function returns non-2xx, supabase puts the response body in `data`
      // and a generic error in `error`. Extract the real message from data first.
      if (error) {
        const realMessage = (data as any)?.error ?? error.message;
        throw new Error(realMessage);
      }
      return data as { success: boolean; message?: string; error?: string; synced?: number; debug_query_url?: string };
    },
    onSuccess: (result) => {
      setSyncResult(result);
      if (result.success) {
        qc.invalidateQueries({ queryKey: ['reagent-items'] });
        qc.invalidateQueries({ queryKey: ['d365-config'] });
      }
    },
    onError: (err: Error) => {
      setSyncResult({ success: false, error: err.message });
    },
  });

  const clearMutation = useMutation({
    mutationFn: async () => {
      if (!window.confirm('Delete ALL reagent items from the local database? They can be restored by syncing from D365. This cannot be undone.')) {
        throw new Error('cancelled');
      }
      const { error } = await supabase.from('reagent_items').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reagent-items'] }),
    onError: (err: Error) => { if (err.message !== 'cancelled') alert(`Clear failed: ${err.message}`); },
  });

  function handleDelete(id: string) {
    if (!window.confirm('Delete this reagent item? This cannot be undone.')) return;
    deleteMutation.mutate(id);
  }

  const activeCount = items.filter(i => i.is_active).length;
  const inactiveCount = items.length - activeCount;
  const syncEnabled = !!(d365Config?.enabled && d365Config?.d365_url && d365Config?.tenant_id && d365Config?.client_id);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reagent Items</h1>
          <p className="text-sm text-gray-500 mt-1">
            Item master synced from D365 Finance &amp; Supply Chain ·{' '}
            <span className="text-gray-700 font-medium">{activeCount} active</span>
            {inactiveCount > 0 && `, ${inactiveCount} inactive`}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => syncMutation.mutate(false)}
            disabled={!syncEnabled || syncMutation.isPending}
            title={syncEnabled ? 'Pull items from D365' : 'Configure D365 connection below to enable sync'}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 text-sm border rounded-lg transition-colors',
              syncEnabled
                ? 'border-indigo-300 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-60'
                : 'border-gray-200 text-gray-400 bg-gray-50 cursor-not-allowed opacity-60'
            )}
          >
            {syncMutation.isPending
              ? <Loader size={14} className="animate-spin" />
              : <RefreshCw size={14} />}
            Sync from D365
          </button>
          {isAdmin && (
            <button
              onClick={() => setModalItem(emptyForm())}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus size={16} />
              Add Item
            </button>
          )}
        </div>
      </div>

      {/* D365 connection settings (admin only) */}
      {isAdmin && (
        <D365ConfigPanel
          cfg={d365Config}
          onSaved={() => qc.invalidateQueries({ queryKey: ['d365-config'] })}
          onSync={testOnly => syncMutation.mutate(testOnly)}
          isSyncing={syncMutation.isPending}
          syncResult={syncResult}
          onClear={() => clearMutation.mutate()}
          isClearing={clearMutation.isPending}
        />
      )}

      {/* D365 info banner (authors only — replaced by settings panel for admins) */}
      {!isAdmin && (
        <div className="flex items-start gap-3 bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3 text-sm text-indigo-800">
          <Info size={16} className="mt-0.5 shrink-0 text-indigo-500" />
          <p>
            This catalog is synced from D365 Finance &amp; Supply Chain.
            Item number, unit of measure, and vendor data come from the D365 item master.
            Use this page to look up CAS numbers, molecular weights, and safety data while authoring work instructions.
          </p>
        </div>
      )}

      {/* Search + filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by item #, name, CAS, formula, vendor…"
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X size={14} />
            </button>
          )}
        </div>
        {isAdmin && inactiveCount > 0 && (
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={e => setShowInactive(e.target.checked)}
              className="w-4 h-4 rounded accent-blue-600"
            />
            Show inactive
          </label>
        )}
        {search && (
          <p className="text-sm text-gray-500">{filtered.length} result{filtered.length !== 1 ? 's' : ''}</p>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="text-center py-12 text-gray-400">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
          <FlaskConical size={36} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 mb-1">
            {items.length === 0 ? 'No reagent items yet' : 'No items match your search'}
          </p>
          {isAdmin && items.length === 0 && (
            <button
              onClick={() => setModalItem(emptyForm())}
              className="mt-3 text-blue-600 text-sm hover:underline"
            >
              Add the first item
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Item #</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Product Name</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Type</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">CAS Number</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Formula</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Mol. Weight</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">UoM</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Hazard</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(item => (
                <ReagentRow
                  key={item.id}
                  item={item}
                  isAdmin={isAdmin}
                  onEdit={setModalItem}
                  onDelete={handleDelete}
                  onManageQC={setQcItem}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add/Edit modal */}
      {modalItem && (
        <ReagentItemModal
          item={modalItem}
          onClose={() => setModalItem(null)}
          onSave={form => saveMutation.mutate(form)}
          isSaving={saveMutation.isPending}
        />
      )}

      {/* QC specification modal */}
      {qcItem && (
        <QCSpecModal
          item={qcItem}
          canManage={canManageQC}
          onClose={() => setQcItem(null)}
        />
      )}
    </div>
  );
}
