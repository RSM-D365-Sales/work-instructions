import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Scale, ScaleConnectionType, ScaleStatus, ScaleConnConfig, EquipmentType } from '../types';
import { Scale as ScaleIcon, Plus, Pencil, Trash2, Wifi, WifiOff, Wrench, CheckCircle2, XCircle, Loader2, RefreshCw, TestTube, Beaker, Boxes } from 'lucide-react';
import { formatDate } from '../lib/utils';

const EQUIPMENT_TYPE_LABELS: Record<EquipmentType, string> = {
  balance:   'Balance',
  ph_meter:  'pH Meter',
  osmometer: 'Osmometer',
  other:     'Other',
};

const EQUIPMENT_TYPE_ICONS: Record<EquipmentType, React.ReactNode> = {
  balance:   <ScaleIcon size={13} />,
  ph_meter:  <TestTube size={13} />,
  osmometer: <Beaker size={13} />,
  other:     <Boxes size={13} />,
};

// ── Constants ────────────────────────────────────────────────────────────────

const CONN_TYPE_LABELS: Record<ScaleConnectionType, string> = {
  http_rest:  'HTTP / REST',
  websocket:  'WebSocket',
  modbus_tcp: 'Modbus TCP',
  opc_ua:     'OPC-UA',
};

const STATUS_STYLES: Record<ScaleStatus, string> = {
  active:      'bg-green-100 text-green-700',
  inactive:    'bg-gray-100 text-gray-500',
  maintenance: 'bg-amber-100 text-amber-700',
};

const STATUS_ICONS: Record<ScaleStatus, React.ReactNode> = {
  active:      <Wifi size={13} />,
  inactive:    <WifiOff size={13} />,
  maintenance: <Wrench size={13} />,
};

const EMPTY_CONFIG: ScaleConnConfig = {};

const BLANK_FORM = {
  name: '',
  barcode: '',
  model: '',
  manufacturer: '',
  serial_number: '',
  location: '',
  notes: '',
  status: 'active' as ScaleStatus,
  equipment_type: 'balance' as EquipmentType,
  conn_a_type: 'http_rest' as ScaleConnectionType,
  conn_a_label: 'Primary',
  conn_a_config: { ...EMPTY_CONFIG },
  conn_b_enabled: false,
  conn_b_type: 'http_rest' as ScaleConnectionType,
  conn_b_label: 'Secondary',
  conn_b_config: { ...EMPTY_CONFIG },
  preferred_conn: 1 as 1 | 2,
};

type FormState = typeof BLANK_FORM;

// ── Connection config fields component ───────────────────────────────────────

function ConnConfigFields({
  label,
  connType,
  config,
  onChange,
}: {
  label: string;
  connType: ScaleConnectionType;
  config: ScaleConnConfig;
  onChange: (c: ScaleConnConfig) => void;
}) {
  const set = (key: keyof ScaleConnConfig, val: string | number) =>
    onChange({ ...config, [key]: val === '' ? undefined : val });

  const input = (
    key: keyof ScaleConnConfig,
    placeholder: string,
    type: 'text' | 'number' | 'password' = 'text',
  ) => (
    <input
      type={type}
      placeholder={placeholder}
      value={(config[key] as string | number | undefined) ?? ''}
      onChange={e => set(key, type === 'number' ? (e.target.value === '' ? '' as unknown as number : Number(e.target.value)) : e.target.value)}
      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
    />
  );

  return (
    <div className="space-y-3 rounded-lg bg-gray-50 border border-gray-200 p-4">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label} config</p>

      {(connType === 'http_rest' || connType === 'websocket') && (
        <>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Endpoint URL *</label>
            {input('url', connType === 'http_rest' ? 'http://192.168.1.50/api/weight' : 'ws://192.168.1.50/weight')}
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Auth Token (optional)</label>
            {input('auth_token', 'Bearer token or API key', 'password')}
          </div>
          {connType === 'http_rest' && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">Polling interval (ms)</label>
              {input('polling_interval_ms', '1000', 'number')}
            </div>
          )}
        </>
      )}

      {connType === 'modbus_tcp' && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Host / IP *</label>
              {input('host', '192.168.1.50')}
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Port *</label>
              {input('port', '502', 'number')}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Unit ID</label>
              {input('unit_id', '1', 'number')}
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Register address</label>
              {input('register_address', '0', 'number')}
            </div>
          </div>
        </>
      )}

      {connType === 'opc_ua' && (
        <>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Endpoint URL *</label>
            {input('endpoint_url', 'opc.tcp://192.168.1.50:4840')}
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Node ID *</label>
            {input('node_id', 'ns=2;s=Scale.Weight')}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Username (optional)</label>
              {input('username', 'admin')}
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Password (optional)</label>
              {input('password', '••••••', 'password')}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Test connection button ────────────────────────────────────────────────────

function TestConnButton({ scale, connSlot }: { scale: Scale; connSlot: 'a' | 'b' }) {
  const [state, setState] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [detail, setDetail] = useState('');

  const connType = connSlot === 'a' ? scale.conn_a_type : scale.conn_b_type;
  const config   = connSlot === 'a' ? scale.conn_a_config : scale.conn_b_config;

  async function test() {
    setState('testing');
    setDetail('');
    try {
      // For HTTP REST we can do a quick fetch from the browser
      if (connType === 'http_rest' && config?.url) {
        const res = await fetch(config.url, {
          headers: config.auth_token ? { Authorization: config.auth_token } : {},
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          setState('ok');
          setDetail(`HTTP ${res.status}`);
        } else {
          setState('fail');
          setDetail(`HTTP ${res.status} ${res.statusText}`);
        }
      } else if (connType === 'websocket' && config?.url) {
        // Open a WS connection and wait for either open or error
        await new Promise<void>((resolve, reject) => {
          const ws = new WebSocket(config.url!);
          const timer = setTimeout(() => { ws.close(); reject(new Error('Timeout')); }, 5000);
          ws.onopen  = () => { clearTimeout(timer); ws.close(); resolve(); };
          ws.onerror = () => { clearTimeout(timer); reject(new Error('Connection refused')); };
        });
        setState('ok');
        setDetail('WebSocket opened successfully');
      } else {
        // Modbus TCP and OPC-UA require server-side proxying — not testable directly from browser
        setState('fail');
        setDetail(`${CONN_TYPE_LABELS[connType!]} connections must be tested from a server-side agent`);
      }
    } catch (err) {
      setState('fail');
      setDetail(err instanceof Error ? err.message : 'Unknown error');
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={test}
        disabled={state === 'testing'}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50"
      >
        {state === 'testing' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
        Test connection
      </button>
      {state === 'ok'   && <span className="flex items-center gap-1 text-xs text-green-600"><CheckCircle2 size={13} /> {detail}</span>}
      {state === 'fail' && <span className="flex items-center gap-1 text-xs text-red-600"><XCircle size={13} /> {detail}</span>}
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────

function ScaleModal({
  initial,
  onClose,
  onSave,
  saving,
  error,
}: {
  initial: FormState;
  onClose: () => void;
  onSave: (f: FormState) => void;
  saving: boolean;
  error: string;
}) {
  const [form, setForm] = useState<FormState>(initial);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm(f => ({ ...f, [k]: v }));

  const editing = (initial.name !== '');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 overflow-y-auto py-8">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 p-6 space-y-6">
        <h2 className="text-lg font-semibold text-gray-900">{editing ? 'Edit Equipment' : 'Add Equipment'}</h2>

        {/* Identity */}
        <section className="space-y-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Identity</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs text-gray-500 mb-1">Name *</label>
              <input
                value={form.name}
                onChange={e => set('name', e.target.value)}
                placeholder="e.g. Bench Scale 1"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Manufacturer</label>
              <input value={form.manufacturer} onChange={e => set('manufacturer', e.target.value)} placeholder="Mettler Toledo" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Model</label>
              <input value={form.model} onChange={e => set('model', e.target.value)} placeholder="XPE205" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Serial number</label>
              <input value={form.serial_number} onChange={e => set('serial_number', e.target.value)} placeholder="B123456789" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Barcode</label>
              <input value={form.barcode} onChange={e => set('barcode', e.target.value)} placeholder="SCL-A1" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Location</label>
              <input value={form.location} onChange={e => set('location', e.target.value)} placeholder="Lab B, Bench 3" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-gray-500 mb-1">Notes</label>
              <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} placeholder="Calibration notes, maintenance schedule…" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Type</label>
              <select value={form.equipment_type} onChange={e => set('equipment_type', e.target.value as EquipmentType)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white">
                {(Object.keys(EQUIPMENT_TYPE_LABELS) as EquipmentType[]).map(t => (
                  <option key={t} value={t}>{EQUIPMENT_TYPE_LABELS[t]}</option>
                ))}
              </select>
              <p className="text-[11px] text-gray-400 mt-1">Balances appear in Weigh steps; pH meters in Adjust pH steps.</p>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Status</label>
              <select value={form.status} onChange={e => set('status', e.target.value as ScaleStatus)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white">
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="maintenance">Maintenance</option>
              </select>
            </div>
          </div>
        </section>

        {/* Connection A */}
        <section className="space-y-3">
          <div className="flex items-center gap-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex-1">Connection A</p>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500">Label</label>
              <input value={form.conn_a_label} onChange={e => set('conn_a_label', e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1 text-xs w-28 focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <select value={form.conn_a_type} onChange={e => { set('conn_a_type', e.target.value as ScaleConnectionType); set('conn_a_config', {}); }} className="border border-gray-300 rounded-lg px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-400">
              {(Object.keys(CONN_TYPE_LABELS) as ScaleConnectionType[]).map(t => (
                <option key={t} value={t}>{CONN_TYPE_LABELS[t]}</option>
              ))}
            </select>
          </div>
          <ConnConfigFields
            label={form.conn_a_label || 'Connection A'}
            connType={form.conn_a_type}
            config={form.conn_a_config}
            onChange={c => set('conn_a_config', c)}
          />
        </section>

        {/* Connection B toggle */}
        <section className="space-y-3">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.conn_b_enabled}
                onChange={e => set('conn_b_enabled', e.target.checked)}
                className="rounded border-gray-300"
              />
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Connection B (optional secondary)</span>
            </label>
            {form.conn_b_enabled && (
              <>
                <div className="flex items-center gap-2 ml-auto">
                  <label className="text-xs text-gray-500">Label</label>
                  <input value={form.conn_b_label} onChange={e => set('conn_b_label', e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1 text-xs w-28 focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
                <select value={form.conn_b_type} onChange={e => { set('conn_b_type', e.target.value as ScaleConnectionType); set('conn_b_config', {}); }} className="border border-gray-300 rounded-lg px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-400">
                  {(Object.keys(CONN_TYPE_LABELS) as ScaleConnectionType[]).map(t => (
                    <option key={t} value={t}>{CONN_TYPE_LABELS[t]}</option>
                  ))}
                </select>
              </>
            )}
          </div>
          {form.conn_b_enabled && (
            <>
              <ConnConfigFields
                label={form.conn_b_label || 'Connection B'}
                connType={form.conn_b_type}
                config={form.conn_b_config}
                onChange={c => set('conn_b_config', c)}
              />
              <div className="flex items-center gap-3">
                <p className="text-xs text-gray-500">Preferred connection:</p>
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="radio" name="preferred" checked={form.preferred_conn === 1} onChange={() => set('preferred_conn', 1)} />
                  {form.conn_a_label || 'Connection A'}
                </label>
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="radio" name="preferred" checked={form.preferred_conn === 2} onChange={() => set('preferred_conn', 2)} />
                  {form.conn_b_label || 'Connection B'}
                </label>
              </div>
            </>
          )}
        </section>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-700">{error}</div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={() => onSave(form)}
            disabled={saving || !form.name.trim()}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Add equipment'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ScalesPage() {
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Scale | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Scale | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [mutError, setMutError] = useState('');

  const { data: scales = [], isLoading } = useQuery<Scale[]>({
    queryKey: ['scales-with-flagger'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('scales')
        .select('*, calibration_flagger:profiles!calibration_flagged_by(id, full_name)')
        .order('name');
      if (error) throw error;
      return data as Scale[];
    },
  });

  // B4: clear a calibration flag, stamping the calibration date.
  const markCalibratedMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('scales')
        .update({
          calibration_flagged_at: null,
          calibration_flagged_by: null,
          calibration_flag_reason: null,
          last_calibrated_at: new Date().toISOString(),
        })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scales'] });
      qc.invalidateQueries({ queryKey: ['scales-with-flagger'] });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (form: FormState) => {
      const payload = {
        name:          form.name.trim(),
        barcode:       form.barcode.trim() || null,
        model:         form.model.trim() || null,
        manufacturer:  form.manufacturer.trim() || null,
        serial_number: form.serial_number.trim() || null,
        location:      form.location.trim() || null,
        notes:         form.notes.trim() || null,
        status:        form.status,
        equipment_type: form.equipment_type,
        conn_a_type:   form.conn_a_type,
        conn_a_label:  form.conn_a_label.trim() || 'Primary',
        conn_a_config: form.conn_a_config,
        conn_b_type:   form.conn_b_enabled ? form.conn_b_type : null,
        conn_b_label:  form.conn_b_label.trim() || 'Secondary',
        conn_b_config: form.conn_b_enabled ? form.conn_b_config : {},
        preferred_conn: form.conn_b_enabled ? form.preferred_conn : 1,
      };

      if (editTarget) {
        const { error } = await supabase.from('scales').update(payload).eq('id', editTarget.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('scales').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scales'] });
      qc.invalidateQueries({ queryKey: ['scales-with-flagger'] });
      setModalOpen(false);
      setEditTarget(null);
      setMutError('');
    },
    onError: (e: unknown) => setMutError(e instanceof Error ? e.message : 'Save failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('scales').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scales'] });
      qc.invalidateQueries({ queryKey: ['scales-with-flagger'] });
      setDeleteTarget(null);
    },
  });

  function openAdd() {
    setEditTarget(null);
    setMutError('');
    setModalOpen(true);
  }

  function openEdit(s: Scale) {
    setEditTarget(s);
    setMutError('');
    setModalOpen(true);
  }

  const getInitialForm = (): FormState => {
    if (!editTarget) return { ...BLANK_FORM, conn_a_config: {}, conn_b_config: {} };
    return {
      name:           editTarget.name,
      barcode:        editTarget.barcode ?? '',
      model:          editTarget.model ?? '',
      manufacturer:   editTarget.manufacturer ?? '',
      serial_number:  editTarget.serial_number ?? '',
      location:       editTarget.location ?? '',
      notes:          editTarget.notes ?? '',
      status:         editTarget.status,
      equipment_type: editTarget.equipment_type ?? 'balance',
      conn_a_type:    editTarget.conn_a_type,
      conn_a_label:   editTarget.conn_a_label,
      conn_a_config:  editTarget.conn_a_config ?? {},
      conn_b_enabled: !!editTarget.conn_b_type,
      conn_b_type:    editTarget.conn_b_type ?? 'http_rest',
      conn_b_label:   editTarget.conn_b_label,
      conn_b_config:  editTarget.conn_b_config ?? {},
      preferred_conn: editTarget.preferred_conn,
    };
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Equipment</h1>
          <p className="text-sm text-gray-500 mt-1">Connected lab instruments — balances, pH meters, and more</p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} /> Add Equipment
        </button>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="text-center py-12 text-gray-400">Loading…</div>
      ) : scales.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
          <ScaleIcon size={32} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 mb-1">No equipment configured yet</p>
          <button onClick={openAdd} className="text-blue-600 text-sm hover:underline">Add the first instrument</button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Type</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Model</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Location</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Connections</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Updated</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {scales.map(scale => (
                <>
                  <tr
                    key={scale.id}
                    className="hover:bg-gray-50 transition-colors cursor-pointer"
                    onClick={() => setExpandedId(expandedId === scale.id ? null : scale.id)}
                  >
                    <td className="px-4 py-3 font-medium text-gray-900">{scale.name}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 text-xs text-gray-600">
                        {EQUIPMENT_TYPE_ICONS[scale.equipment_type ?? 'balance']}
                        {EQUIPMENT_TYPE_LABELS[scale.equipment_type ?? 'balance']}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {[scale.manufacturer, scale.model].filter(Boolean).join(' ') || '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{scale.location ?? '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[scale.status]}`}>
                          {STATUS_ICONS[scale.status]}
                          {scale.status}
                        </span>
                        {scale.calibration_flagged_at && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                            <Wrench size={12} /> calibration due
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-xs">
                          <span className={`font-medium ${scale.preferred_conn === 1 ? 'text-blue-600' : 'text-gray-500'}`}>
                            {scale.conn_a_label}
                          </span>
                          {' '}— {CONN_TYPE_LABELS[scale.conn_a_type]}
                          {scale.preferred_conn === 1 && <span className="ml-1 text-blue-600 text-[10px]">★ preferred</span>}
                        </span>
                        {scale.conn_b_type && (
                          <span className="text-xs">
                            <span className={`font-medium ${scale.preferred_conn === 2 ? 'text-blue-600' : 'text-gray-500'}`}>
                              {scale.conn_b_label}
                            </span>
                            {' '}— {CONN_TYPE_LABELS[scale.conn_b_type]}
                            {scale.preferred_conn === 2 && <span className="ml-1 text-blue-600 text-[10px]">★ preferred</span>}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{formatDate(scale.updated_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 justify-end" onClick={e => e.stopPropagation()}>
                        <button onClick={() => openEdit(scale)} className="text-gray-400 hover:text-blue-600 transition-colors" title="Edit"><Pencil size={15} /></button>
                        <button onClick={() => setDeleteTarget(scale)} className="text-gray-400 hover:text-red-500 transition-colors" title="Delete"><Trash2 size={15} /></button>
                      </div>
                    </td>
                  </tr>

                  {/* Expanded detail row */}
                  {expandedId === scale.id && (
                    <tr key={`${scale.id}-detail`} className="bg-blue-50/40">
                      <td colSpan={8} className="px-6 py-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <ConnDetailPanel label={`${scale.conn_a_label} (${CONN_TYPE_LABELS[scale.conn_a_type]})`} config={scale.conn_a_config} preferred={scale.preferred_conn === 1}>
                            <TestConnButton scale={scale} connSlot="a" />
                          </ConnDetailPanel>
                          {scale.conn_b_type && (
                            <ConnDetailPanel label={`${scale.conn_b_label} (${CONN_TYPE_LABELS[scale.conn_b_type]})`} config={scale.conn_b_config} preferred={scale.preferred_conn === 2}>
                              <TestConnButton scale={scale} connSlot="b" />
                            </ConnDetailPanel>
                          )}
                        </div>
                        {/* B4: calibration flag raised from Quality Trends */}
                        {scale.calibration_flagged_at ? (
                          <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2.5">
                            <Wrench size={15} className="text-amber-600 mt-0.5 shrink-0" />
                            <div className="flex-1 text-xs">
                              <p className="font-semibold text-amber-800">
                                Flagged for calibration · {formatDate(scale.calibration_flagged_at)}
                                {scale.calibration_flagger?.full_name ? ` · by ${scale.calibration_flagger.full_name}` : ''}
                              </p>
                              {scale.calibration_flag_reason && (
                                <p className="text-amber-700 mt-0.5">{scale.calibration_flag_reason}</p>
                              )}
                            </div>
                            <button
                              onClick={e => { e.stopPropagation(); markCalibratedMutation.mutate(scale.id); }}
                              disabled={markCalibratedMutation.isPending}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 text-white text-xs font-medium rounded-lg hover:bg-amber-700 disabled:opacity-50 shrink-0"
                            >
                              <CheckCircle2 size={13} /> Mark calibrated
                            </button>
                          </div>
                        ) : scale.last_calibrated_at ? (
                          <p className="mt-3 text-xs text-gray-400">Last calibrated: {formatDate(scale.last_calibrated_at)}</p>
                        ) : null}
                        {scale.notes && (
                          <p className="mt-3 text-xs text-gray-500 italic">{scale.notes}</p>
                        )}
                        {scale.serial_number && (
                          <p className="mt-1 text-xs text-gray-400">Serial: {scale.serial_number}</p>
                        )}
                        {scale.barcode && (
                          <p className="mt-1 text-xs text-gray-400 font-mono">Barcode: {scale.barcode}</p>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add / Edit modal */}
      {modalOpen && (
        <ScaleModal
          initial={getInitialForm()}
          onClose={() => { setModalOpen(false); setEditTarget(null); }}
          onSave={form => saveMutation.mutate(form)}
          saving={saveMutation.isPending}
          error={mutError}
        />
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100">
                <Trash2 size={20} className="text-red-600" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-gray-900">Delete equipment?</h2>
                <p className="text-sm text-gray-500">{deleteTarget.name}</p>
              </div>
            </div>
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              <strong>This action is irreversible.</strong> The equipment record and all its connection configuration will be permanently deleted.
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">
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

// ── Connection detail panel (used in expanded row) ────────────────────────────

function ConnDetailPanel({
  label,
  config,
  preferred,
  children,
}: {
  label: string;
  config: ScaleConnConfig;
  preferred: boolean;
  children?: React.ReactNode;
}) {
  const rows = Object.entries(config).filter(([, v]) => v !== undefined && v !== '' && v !== null);
  const mask = (k: string, v: unknown) =>
    k === 'auth_token' || k === 'password' ? '••••••••' : String(v);

  return (
    <div className={`rounded-lg border p-4 space-y-2 ${preferred ? 'border-blue-300 bg-white' : 'border-gray-200 bg-gray-50'}`}>
      <div className="flex items-center gap-2 mb-1">
        <p className="text-xs font-semibold text-gray-700">{label}</p>
        {preferred && <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded-full font-medium">preferred</span>}
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-gray-400 italic">No configuration stored</p>
      ) : (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
          {rows.map(([k, v]) => (
            <div key={k} className="col-span-2 flex gap-2">
              <dt className="text-xs text-gray-400 w-36 shrink-0">{k.replace(/_/g, ' ')}</dt>
              <dd className="text-xs text-gray-700 font-mono truncate">{mask(k, v)}</dd>
            </div>
          ))}
        </dl>
      )}
      {children && <div className="pt-1">{children}</div>}
    </div>
  );
}
