import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { Lab } from '../types';
import { cn } from '../lib/utils';
import {
  FlaskConical, Search, Pencil, Trash2, RefreshCw, X,
  CheckCircle, AlertTriangle, Loader, Plus, Settings2,
  ChevronDown, ChevronUp, Eye, EyeOff,
} from 'lucide-react';

interface D365Config {
  id: string;
  d365_url: string;
  tenant_id: string;
  client_id: string;
  buyer_group: string;
  company: string;
  warehouse_container_group: string;
  enabled: boolean;
  last_sync_at?: string;
  last_sync_status?: string;
  last_sync_count?: number;
  last_sync_error?: string;
}

interface SyncResult {
  success: boolean;
  message?: string;
  error?: string;
  synced?: number;
  debug_query_url?: string;
}

function emptyLab(): Partial<Lab> {
  return {
    warehouse_id: '',
    name: '',
    description: '',
    site_id: '',
    is_active: true,
    notes: '',
  };
}

export default function LabsPage() {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Partial<Lab> | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);

  // ─── Queries ────────────────────────────────────────────────────────────
  const { data: cfg } = useQuery<D365Config | null>({
    queryKey: ['d365-config'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('d365_config')
        .select('*')
        .eq('id', '00000000-0000-0000-0000-000000000001')
        .maybeSingle();
      if (error) throw error;
      return data as D365Config | null;
    },
    enabled: isAdmin,
  });

  const { data: labs = [], isLoading } = useQuery<Lab[]>({
    queryKey: ['labs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('labs')
        .select('*')
        .order('name', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return labs.filter(l => {
      if (!showInactive && !l.is_active) return false;
      if (!q) return true;
      return (
        l.warehouse_id.toLowerCase().includes(q) ||
        l.name.toLowerCase().includes(q) ||
        (l.site_id ?? '').toLowerCase().includes(q) ||
        (l.description ?? '').toLowerCase().includes(q)
      );
    });
  }, [labs, search, showInactive]);

  // ─── Mutations ──────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async (item: Partial<Lab>) => {
      const payload = {
        warehouse_id: item.warehouse_id?.trim(),
        name: item.name?.trim(),
        description: item.description?.trim() || null,
        site_id: item.site_id?.trim() || null,
        is_active: item.is_active ?? true,
        notes: item.notes?.trim() || null,
      };
      if (item.id) {
        const { error } = await supabase.from('labs').update(payload).eq('id', item.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('labs').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['labs'] });
      setEditing(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('labs').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['labs'] }),
  });

  const syncMutation = useMutation({
    mutationFn: async (testOnly: boolean) => {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('Not authenticated');
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-d365-warehouses`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
        },
        body: JSON.stringify({ testOnly }),
      });
      const text = await res.text();
      let data: SyncResult;
      try { data = JSON.parse(text); } catch { data = { success: false, error: text }; }
      if (!res.ok && !data.error) data.error = `HTTP ${res.status}`;
      return data;
    },
    onSuccess: (result) => {
      setSyncResult(result);
      if (result.success) qc.invalidateQueries({ queryKey: ['labs'] });
    },
    onError: (err) => setSyncResult({ success: false, error: (err as Error).message }),
  });

  // ─── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <FlaskConical size={22} className="text-teal-600" />
            Labs
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Lab locations sourced from D365 Finance &amp; Supply Chain warehouses
            (filtered to those with a default container type).
          </p>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setSyncResult(null); syncMutation.mutate(true); }}
              disabled={syncMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-700 disabled:opacity-50"
              title="Verify D365 credentials without syncing"
            >
              Test Connection
            </button>
            <button
              onClick={() => { setSyncResult(null); syncMutation.mutate(false); }}
              disabled={syncMutation.isPending}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              {syncMutation.isPending
                ? <><Loader size={14} className="animate-spin" /> Syncing…</>
                : <><RefreshCw size={14} /> Sync from D365</>}
            </button>
            <button
              onClick={() => setEditing(emptyLab())}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <Plus size={14} /> Add Lab
            </button>
          </div>
        )}
      </div>

      {/* D365 settings panel (admin) */}
      {isAdmin && <D365LabsConfigPanel cfg={cfg ?? null} />}

      {/* Sync result feedback */}
      {syncResult && (
        <div className={cn(
          'rounded-lg px-3 py-2 text-sm flex items-start gap-2',
          syncResult.success
            ? 'bg-green-50 border border-green-200 text-green-800'
            : 'bg-red-50 border border-red-200 text-red-800'
        )}>
          {syncResult.success
            ? <CheckCircle size={15} className="mt-0.5 shrink-0" />
            : <AlertTriangle size={15} className="mt-0.5 shrink-0" />}
          <div className="flex-1">
            <p>{syncResult.message ?? syncResult.error}</p>
            {syncResult.debug_query_url && (
              <p className="mt-1 text-xs font-mono break-all opacity-70">{syncResult.debug_query_url}</p>
            )}
          </div>
          <button onClick={() => setSyncResult(null)} className="opacity-60 hover:opacity-100">
            <X size={14} />
          </button>
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
            placeholder="Search by warehouse ID, name, site…"
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={e => setShowInactive(e.target.checked)}
            className="w-4 h-4 rounded accent-blue-600"
          />
          Show inactive
        </label>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="text-center py-12 text-gray-400">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
          <FlaskConical size={32} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500">
            {labs.length === 0
              ? 'No labs yet. Sync from D365 or add one manually.'
              : 'No labs match your search.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-600">Warehouse ID</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Lab Name</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Site</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Container Type</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Company</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Last D365 Sync</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(lab => (
                <tr key={lab.id} className={cn('hover:bg-blue-50/40', !lab.is_active && 'opacity-50')}>
                  <td className="px-4 py-3 font-mono text-sm font-medium text-gray-900 whitespace-nowrap">
                    {lab.warehouse_id}
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium text-gray-900">{lab.name}</p>
                    {lab.description && (
                      <p className="text-xs text-gray-500 mt-0.5">{lab.description}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{lab.site_id ?? '—'}</td>
                  <td className="px-4 py-3">
                    {lab.default_container_type
                      ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700 font-mono">{lab.default_container_type}</span>
                      : <span className="text-xs text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 font-mono">{lab.d365_company ?? '—'}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {lab.d365_synced_at ? new Date(lab.d365_synced_at).toLocaleString() : <span className="text-gray-400 italic">manual</span>}
                  </td>
                  <td className="px-4 py-3">
                    {lab.is_active
                      ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Active</span>
                      : <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">Inactive</span>}
                  </td>
                  <td className="px-4 py-3">
                    {isAdmin && (
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          onClick={() => setEditing(lab)}
                          title="Edit"
                          className="p-1 text-gray-400 hover:text-blue-600 transition-colors"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => {
                            if (window.confirm(`Delete lab "${lab.name}"? Users who have set this as their default will be cleared.`)) {
                              deleteMutation.mutate(lab.id, {
                                onError: e => alert((e as Error).message),
                              });
                            }
                          }}
                          title="Delete"
                          className="p-1 text-gray-400 hover:text-red-600 transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <LabModal
          item={editing}
          isSaving={saveMutation.isPending}
          onClose={() => setEditing(null)}
          onSave={(d) => saveMutation.mutate(d, {
            onError: e => alert((e as Error).message),
          })}
        />
      )}
    </div>
  );
}

// ─── Edit modal ──────────────────────────────────────────────────────────────
function LabModal({
  item, onClose, onSave, isSaving,
}: {
  item: Partial<Lab>;
  onClose: () => void;
  onSave: (data: Partial<Lab>) => void;
  isSaving: boolean;
}) {
  const [form, setForm] = useState<Partial<Lab>>(item);

  function set(k: keyof Lab, v: unknown) {
    setForm(f => ({ ...f, [k]: v }));
  }

  const fromD365 = !!item.d365_synced_at;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-200 sticky top-0 bg-white">
          <h2 className="text-lg font-semibold text-gray-900">
            {item.id ? 'Edit Lab' : 'Add Lab'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Warehouse ID <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.warehouse_id ?? ''}
              onChange={e => set('warehouse_id', e.target.value)}
              disabled={fromD365}
              placeholder="e.g. LAB-01"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-500"
            />
            {fromD365 && <p className="text-xs text-gray-400 mt-1">Sourced from D365 — cannot be changed.</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Lab Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.name ?? ''}
              onChange={e => set('name', e.target.value)}
              placeholder="e.g. Main Reagent Lab"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <input
              type="text"
              value={form.description ?? ''}
              onChange={e => set('description', e.target.value)}
              placeholder="Short description shown in selectors"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Site ID</label>
            <input
              type="text"
              value={form.site_id ?? ''}
              onChange={e => set('site_id', e.target.value)}
              placeholder="D365 Inventory Site ID"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              rows={3}
              value={form.notes ?? ''}
              onChange={e => set('notes', e.target.value)}
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
            <span className="text-sm text-gray-700">Active (selectable as a default lab)</span>
          </label>
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
            disabled={isSaving || !form.warehouse_id?.trim() || !form.name?.trim()}
            className="px-5 py-2 bg-blue-600 text-white text-sm rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {isSaving ? 'Saving…' : item.id ? 'Save Changes' : 'Add Lab'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── D365 Settings Panel (admin only) ────────────────────────────────────────
// Collapsible panel showing the shared D365 connection settings plus the
// warehouse-specific "Default Container Group" filter that scopes which
// warehouses get pulled into the labs catalog.
function D365LabsConfigPanel({ cfg }: { cfg: D365Config | null }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showUrl, setShowUrl] = useState(false);
  const [form, setForm] = useState<Pick<
    D365Config,
    'd365_url' | 'tenant_id' | 'client_id' | 'company' | 'warehouse_container_group' | 'enabled'
  > | null>(null);

  function startEdit() {
    setForm({
      d365_url: cfg?.d365_url ?? '',
      tenant_id: cfg?.tenant_id ?? '',
      client_id: cfg?.client_id ?? '',
      company: cfg?.company ?? '',
      warehouse_container_group: cfg?.warehouse_container_group ?? '',
      enabled: cfg?.enabled ?? false,
    });
    setEditing(true);
  }

  const saveMutation = useMutation({
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
      setEditing(false);
      setForm(null);
    },
  });

  const isConfigured = !!(cfg?.d365_url && cfg?.tenant_id && cfg?.client_id);

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-gray-50 transition-colors"
      >
        <Settings2 size={16} className="text-indigo-500 shrink-0" />
        <span className="font-medium text-gray-900 text-sm flex-1">D365 Warehouse Sync Settings</span>
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
          {cfg?.warehouse_container_group && (
            <span className="text-xs text-gray-500">
              Container group: <span className="font-mono font-medium text-gray-700">{cfg.warehouse_container_group}</span>
            </span>
          )}
          {open ? <ChevronUp size={15} className="text-gray-400" /> : <ChevronDown size={15} className="text-gray-400" />}
        </div>
      </button>

      {open && (
        <div className="border-t border-gray-100 px-5 py-4 space-y-4">
          <p className="text-xs text-gray-500">
            Connection settings are shared with the Reagent Items sync. Editing them here updates both.
            The <span className="font-medium text-gray-700">Default Container Group</span> field is used only by the warehouse sync —
            blank means "any warehouse that has a default container type assigned in D365".
          </p>

          {!editing ? (
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
                  <dt className="text-xs font-medium text-gray-400 uppercase tracking-wide">Company (Legal Entity)</dt>
                  <dd className="text-gray-800 font-mono text-xs mt-0.5">{cfg?.company || <span className="text-gray-400 italic">environment default</span>}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-xs font-medium text-gray-400 uppercase tracking-wide">Default Container Group</dt>
                  <dd className="text-gray-800 font-mono text-xs mt-0.5">
                    {cfg?.warehouse_container_group
                      || <span className="text-gray-400 italic">any (only warehouses with a default container type)</span>}
                  </dd>
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
              {cfg?.last_sync_status === 'error' && cfg.last_sync_error && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-800">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium">Last D365 sync error</p>
                    <p className="text-xs mt-0.5 font-mono">{cfg.last_sync_error}</p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            form && (
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
                    <label className="block text-xs font-medium text-gray-600 mb-1">Company (Legal Entity)</label>
                    <input
                      type="text"
                      value={form.company}
                      onChange={e => setForm(f => f ? { ...f, company: e.target.value } : f)}
                      placeholder="e.g. USP2 (blank = environment default)"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Default Container Group</label>
                    <input
                      type="text"
                      value={form.warehouse_container_group}
                      onChange={e => setForm(f => f ? { ...f, warehouse_container_group: e.target.value } : f)}
                      placeholder="e.g. LAB (blank = any non-empty)"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <p className="text-xs text-gray-400 mt-1">
                      Filters on <code>InventoryWarehouses.DefaultContainerTypeCode</code>.
                    </p>
                  </div>
                  <div className="flex items-center col-span-2">
                    <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.enabled}
                        onChange={e => setForm(f => f ? { ...f, enabled: e.target.checked } : f)}
                        className="w-4 h-4 rounded accent-blue-600"
                      />
                      Enable D365 sync (shared with reagent sync)
                    </label>
                  </div>
                </div>

                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                  <div>
                    <p className="font-semibold">Client secret is stored separately as a Supabase secret</p>
                    <code className="block bg-amber-100 rounded px-2 py-1 mt-1 font-mono select-all">
                      supabase secrets set D365_CLIENT_SECRET=&lt;your_secret&gt;
                    </code>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => saveMutation.mutate(form)}
                    disabled={saveMutation.isPending || !form.d365_url || !form.tenant_id || !form.client_id}
                    className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    {saveMutation.isPending ? 'Saving…' : 'Save Settings'}
                  </button>
                  <button
                    onClick={() => { setEditing(false); setForm(null); }}
                    className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
