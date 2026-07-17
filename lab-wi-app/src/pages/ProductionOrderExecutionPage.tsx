import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { ProductionOrder, WIStep, POStep, StepType, Scale, Profile, QCTest, QCResult, POStatus, ParameterSchema, ParameterFieldDef } from '../types';
import { calculateTolerance, cn } from '../lib/utils';
import { evaluateQC, formatSpec } from '../lib/qc';
import { createNotification } from '../lib/notifications';
import OrderMaterialsSummary from '../components/OrderMaterialsSummary';
import {
  ArrowLeft, CheckCircle, Circle, ChevronRight, Scale as ScaleIcon, Timer,
  FlaskConical, ArrowRightLeft, Thermometer, Snowflake, TestTube, Eye, Settings,
  AlertTriangle, CheckCheck, PlayCircle, Ban, Trash2, Loader2, Wifi, WifiOff,
  Wrench, Beaker, Printer, UserCog, CalendarClock, Check, StickyNote, Milestone,
  ClipboardCheck, FileText, XCircle, Send, ScanLine, MessageSquare, X, SlidersHorizontal,
  Paperclip, ExternalLink,
} from 'lucide-react';

const STEP_ICONS: Record<StepType, React.ReactNode> = {
  gather_inputs:    <FlaskConical size={16} />,
  gather_equipment: <Wrench size={16} />,
  gather_reagents:  <Beaker size={16} />,
  weigh:            <ScaleIcon size={16} />,
  mix:              <Timer size={16} />,
  transfer:         <ArrowRightLeft size={16} />,
  ph_adjust:        <TestTube size={16} />,
  heat:             <Thermometer size={16} />,
  cool:             <Snowflake size={16} />,
  observe:          <Eye size={16} />,
  notes:            <StickyNote size={16} />,
  production_break: <Milestone size={16} />,
  print_labels:     <Printer size={16} />,
  attachment:       <Paperclip size={16} />,
  possible_deviation: <AlertTriangle size={16} />,
  user_defined:     <SlidersHorizontal size={16} />,
  custom:           <Settings size={16} />,
};

// ─── Scale connect helper ────────────────────────────────────────────────────
// Demo scales aren't physically wired up. The operator scans the scale's
// name / barcode / serial to "connect"; the matched value is compared here.
function scanMatchesScale(scanned: string, scale: Scale | null | undefined): boolean {
  if (!scale) return false;
  const v = scanned.trim().toLowerCase();
  if (!v) return false;
  return [scale.name, scale.barcode, scale.serial_number]
    .filter(Boolean)
    .some(code => code!.toLowerCase() === v);
}

// ─── Individual step execution widgets ───────────────────────────────────────

function WeighStepWidget({
  params, values, onChange, locked,
}: {
  params: Record<string, unknown>;
  values: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
  locked: boolean;
}) {
  const target = params.target_weight as number;
  const unit = params.unit as string ?? 'g';
  const tolerance = params.tolerance_pct as number ?? 2;
  const materialName = params.material_name as string ?? 'Material';
  const lotControlled = (params.lot_controlled as boolean) ?? false;

  const [scanInput, setScanInput] = useState('');
  const [scanError, setScanError] = useState('');

  // The operator picks the bench balance at run time — load active balances.
  const { data: scales = [] } = useQuery<Scale[]>({
    queryKey: ['equipment', 'balance'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('scales').select('*').eq('status', 'active').eq('equipment_type', 'balance').order('name');
      if (error) throw error;
      return data as Scale[];
    },
  });

  // The chosen scale is recorded on the step result, so it persists/locks.
  const connectedScale = scales.find(s => s.id === (values.scale_id as string | undefined)) ?? null;
  const connected = !!connectedScale;
  const scaleName = connectedScale?.name ?? (values.scale_name as string | undefined);
  const canEnter = connected;

  const measured = values.measured_weight as number | undefined;
  const result = measured != null ? calculateTolerance(measured, target, tolerance) : null;

  function connectScale(s: Scale) {
    onChange({ ...values, scale_id: s.id, scale_name: s.name });
    setScanInput('');
    setScanError('');
  }
  function disconnectScale() {
    onChange({ ...values, scale_id: undefined, scale_name: undefined });
  }
  function tryScan() {
    const match = scales.find(s => scanMatchesScale(scanInput, s));
    if (match) connectScale(match);
    else setScanError('No active scale matches that scan. Try the scale name, barcode, or serial.');
  }

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
        <p className="text-sm font-medium text-blue-900">
          Weigh out <strong>{materialName}</strong>
        </p>
        <p className="text-sm text-blue-700 mt-1">
          Target: <strong>{target} {unit}</strong> &plusmn; {tolerance}%
          {' '}(allowed range: <strong>{(target * (1 - tolerance / 100)).toFixed(3)}</strong> – <strong>{(target * (1 + tolerance / 100)).toFixed(3)} {unit}</strong>)
        </p>
        <p className="text-xs text-blue-600 mt-1.5 flex items-center gap-1">
          <ScaleIcon size={12} />
          {connected
            ? <>Weighing on <strong className="ml-0.5">{scaleName}</strong></>
            : <>Scan or select the scale at your bench to begin.</>}
        </p>
      </div>

      {/* Select / scan the bench scale (required before entering a weight) */}
      {!connected && !locked && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 space-y-3">
          <label className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
            <ScanLine size={14} className="text-gray-500" />
            Connect your bench scale
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              autoFocus
              value={scanInput}
              onChange={e => setScanInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); tryScan(); } }}
              placeholder="Scan scale name / barcode (e.g. SCL-A1)"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={tryScan}
              disabled={!scanInput.trim()}
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
            >
              <WifiOff size={15} /> Connect
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">or choose</span>
            <select
              value=""
              onChange={e => { const s = scales.find(x => x.id === e.target.value); if (s) connectScale(s); }}
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select a scale at your bench…</option>
              {scales.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name}{s.barcode ? ` · ${s.barcode}` : ''}{s.location ? ` — ${s.location}` : ''}
                </option>
              ))}
            </select>
          </div>
          {scanError
            ? <p className="text-xs text-red-600">{scanError}</p>
            : <p className="text-xs text-gray-500">Scan the balance’s barcode, or pick it from the list, to start the live capture.</p>}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
          {connected ? 'Live Reading' : 'Scale Reading'} ({unit})
          {connected && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-green-700">
              <Wifi size={12} />
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75 animate-ping" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
              </span>
              Connected · {scaleName}
            </span>
          )}
          {connected && !locked && (
            <button onClick={disconnectScale} className="ml-auto text-[11px] text-gray-400 hover:text-gray-700 underline">
              change scale
            </button>
          )}
        </label>
        <input
          type="number"
          step="0.001"
          value={measured ?? ''}
          onChange={e => {
            const v = parseFloat(e.target.value);
            const r = isNaN(v) ? null : calculateTolerance(v, target, tolerance);
            onChange({
              ...values,
              measured_weight: isNaN(v) ? undefined : v,
              unit,
              in_tolerance: r?.inTolerance ?? undefined,
              deviation_pct: r?.deviationPct ?? undefined,
            });
          }}
          disabled={locked || !canEnter}
          placeholder={canEnter ? `Live weight from ${scaleName ?? 'scale'} (${unit})` : 'Connect a scale to enable live capture'}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
        />
        {connected && (
          <p className="text-xs text-gray-400 mt-1">Reading streamed from <strong>{scaleName}</strong> in real time.</p>
        )}
      </div>

      {result != null && measured != null && (
        <div className={cn(
          'flex items-center gap-3 p-3 rounded-xl text-sm font-medium',
          result.inTolerance
            ? 'bg-green-50 border border-green-200 text-green-800'
            : 'bg-red-50 border border-red-200 text-red-800'
        )}>
          {result.inTolerance ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}
          <div>
            <p>
              {result.inTolerance ? 'In tolerance' : 'OUT OF TOLERANCE'}
              {' '}— measured {measured} {unit} ({result.deviationPct}% deviation)
            </p>
            {!result.inTolerance && (
              <p className="text-xs mt-0.5 font-normal opacity-80">Do not proceed — re-weigh the material</p>
            )}
          </div>
        </div>
      )}

      {lotControlled && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Lot / Batch Number <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={(values.lot_number as string) ?? ''}
            onChange={e => onChange({ ...values, lot_number: e.target.value })}
            disabled={locked}
            placeholder="Enter the lot or batch number from the container label"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-gray-50"
          />
          {!(values.lot_number as string) && (
            <p className="text-xs text-amber-600 mt-1">This reagent is lot / batch controlled — lot number is required.</p>
          )}
        </div>
      )}
    </div>
  );
}

function MixStepWidget({
  params, values, onChange, locked,
}: {
  params: Record<string, unknown>;
  values: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
  locked: boolean;
}) {
  const targetMin = params.duration_minutes as number ?? 10;
  const speed = params.speed as string ?? 'medium';
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const [startTime, setStartTime] = useState<number | null>(null);

  useEffect(() => {
    if (!running) return;
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime!) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [running, startTime]);

  const targetSec = targetMin * 60;
  const pct = Math.min(100, Math.round((elapsed / targetSec) * 100));
  const done = elapsed >= targetSec;

  function startTimer() {
    setStartTime(Date.now() - elapsed * 1000);
    setRunning(true);
  }

  function stopTimer() {
    setRunning(false);
    const mins = Math.round((elapsed / 60) * 10) / 10;
    onChange({ ...values, actual_duration_minutes: mins, completed: done });
  }

  const mStr = `${Math.floor(elapsed / 60).toString().padStart(2, '0')}:${(elapsed % 60).toString().padStart(2, '0')}`;

  return (
    <div className="space-y-4">
      <div className="bg-cyan-50 border border-cyan-100 rounded-xl p-4">
        <p className="text-sm font-medium text-cyan-900">
          Mix at <strong>{speed}</strong> speed for <strong>{targetMin} minutes</strong>
        </p>
      </div>

      <div className="text-center space-y-3">
        <div className="text-4xl font-mono font-bold text-gray-800">{mStr}</div>
        <div className="w-full bg-gray-200 rounded-full h-2.5">
          <div
            className={cn('h-2.5 rounded-full transition-all', done ? 'bg-green-500' : 'bg-blue-500')}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="text-xs text-gray-500">{pct}% of {targetMin} min</p>
        <div className="flex justify-center gap-3">
          {!running && !done && (
            <button
              onClick={startTimer}
              disabled={locked}
              className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50"
            >
              <PlayCircle size={15} /> Start Timer
            </button>
          )}
          {running && (
            <button
              onClick={stopTimer}
              className="flex items-center gap-2 px-5 py-2 bg-yellow-500 text-white rounded-lg text-sm"
            >
              Stop
            </button>
          )}
          {done && !running && (
            <div className="flex items-center gap-2 text-green-700 font-medium text-sm">
              <CheckCircle size={18} /> Mix complete
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ObserveStepWidget({
  params, values, onChange, locked,
}: {
  params: Record<string, unknown>;
  values: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
  locked: boolean;
}) {
  return (
    <div className="space-y-3">
      {(params.prompt as string | undefined) && (
        <div className="bg-purple-50 border border-purple-100 rounded-xl p-3 text-sm text-purple-800">
          {params.prompt as string}
        </div>
      )}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Observation</label>
        <textarea
          rows={3}
          value={(values.observation as string) ?? ''}
          onChange={e => onChange({ ...values, observation: e.target.value })}
          disabled={locked}
          placeholder="Describe what you observe…"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
        />
      </div>
    </div>
  );
}

function NotesStepWidget({
  params, values, onChange, locked,
}: {
  params: Record<string, unknown>;
  values: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
  locked: boolean;
}) {
  return (
    <div className="space-y-3">
      {(params.prompt as string | undefined) && (
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-sm text-amber-800">
          {params.prompt as string}
        </div>
      )}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
        <textarea
          rows={5}
          value={(values.notes_content as string) ?? ''}
          onChange={e => onChange({ ...values, notes_content: e.target.value })}
          disabled={locked}
          placeholder="Capture any notes about the order up to this step…"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
        />
      </div>
    </div>
  );
}

function ProductionBreakWidget({
  params,
}: {
  params: Record<string, unknown>;
}) {
  const label = (params.label as string | undefined)?.trim() || 'New part of the run';
  const description = (params.description as string | undefined)?.trim();
  return (
    <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 flex items-start gap-3">
      <div className="mt-0.5 text-rose-600">
        <Milestone size={20} />
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-rose-500">Production Break</p>
        <p className="text-sm font-semibold text-rose-900">{label}</p>
        {description && <p className="text-sm text-rose-700 mt-1">{description}</p>}
      </div>
    </div>
  );
}

function GatherInputsWidget({
  params, values, onChange, locked,
}: {
  params: Record<string, unknown>;
  values: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
  locked: boolean;
}) {
  const inputs = params.inputs as { material_name: string; quantity: number; unit: string }[] ?? [];
  const checked = (values.checked ?? []) as string[];

  function toggle(name: string) {
    const next = checked.includes(name) ? checked.filter(c => c !== name) : [...checked, name];
    onChange({ ...values, checked: next });
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-gray-600 mb-2">Collect and verify all inputs before proceeding:</p>
      {inputs.map((inp, i) => (
        <label key={i} className={cn(
          'flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors',
          checked.includes(inp.material_name)
            ? 'border-green-300 bg-green-50'
            : 'border-gray-200 bg-white hover:border-gray-300'
        )}>
          <input
            type="checkbox"
            checked={checked.includes(inp.material_name)}
            onChange={() => !locked && toggle(inp.material_name)}
            disabled={locked}
            className="w-4 h-4 rounded accent-green-600"
          />
          <span className="text-sm font-medium text-gray-800">{inp.material_name}</span>
          <span className="text-sm text-gray-500 ml-auto">{inp.quantity} {inp.unit}</span>
        </label>
      ))}
    </div>
  );
}

function GatherEquipmentWidget({
  params, values, onChange, locked,
}: {
  params: Record<string, unknown>;
  values: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
  locked: boolean;
}) {
  const equipment = params.equipment as { name: string; notes: string }[] ?? [];
  const checked = (values.checked ?? []) as string[];

  function toggle(name: string) {
    const next = checked.includes(name) ? checked.filter(c => c !== name) : [...checked, name];
    onChange({ ...values, checked: next });
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-gray-600 mb-2">Collect and verify all required equipment:</p>
      {equipment.map((item, i) => (
        <label key={i} className={cn(
          'flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors',
          checked.includes(item.name)
            ? 'border-green-300 bg-green-50'
            : 'border-gray-200 bg-white hover:border-gray-300'
        )}>
          <input
            type="checkbox"
            checked={checked.includes(item.name)}
            onChange={() => !locked && toggle(item.name)}
            disabled={locked}
            className="w-4 h-4 rounded accent-green-600"
          />
          <span className="text-sm font-medium text-gray-800">{item.name}</span>
          {item.notes && <span className="text-xs text-gray-400 ml-auto">{item.notes}</span>}
        </label>
      ))}
    </div>
  );
}

function GatherReagentsWidget({
  params, values, onChange, locked,
}: {
  params: Record<string, unknown>;
  values: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
  locked: boolean;
}) {
  const reagents = params.reagents as { item_number: string; product_name: string; quantity: number; unit: string; lot_controlled?: boolean }[] ?? [];
  const checked = (values.checked ?? []) as string[];
  const lotNumbers = (values.lot_numbers ?? {}) as Record<string, string>;

  function key(r: typeof reagents[0]) { return r.item_number || r.product_name; }

  function toggle(k: string) {
    const next = checked.includes(k) ? checked.filter(c => c !== k) : [...checked, k];
    onChange({ ...values, checked: next });
  }

  function setLotNumber(k: string, lot: string) {
    onChange({ ...values, lot_numbers: { ...lotNumbers, [k]: lot } });
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-gray-600 mb-2">Collect and verify all reagents from the catalog:</p>
      {reagents.map((r, i) => {
        const k = key(r);
        const isChecked = checked.includes(k);
        const needsLot = r.lot_controlled ?? false;
        const lotValue = lotNumbers[k] ?? '';
        return (
          <div key={i} className={cn(
            'rounded-xl border transition-colors',
            isChecked ? 'border-green-300 bg-green-50' : 'border-gray-200 bg-white'
          )}>
            <label className="flex items-center gap-3 p-3 cursor-pointer">
              <input
                type="checkbox"
                checked={isChecked}
                onChange={() => !locked && toggle(k)}
                disabled={locked}
                className="w-4 h-4 rounded accent-green-600"
              />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium text-gray-800">{r.product_name}</span>
                {r.item_number && <span className="text-xs text-gray-400 ml-2">#{r.item_number}</span>}
                {needsLot && (
                  <span className="ml-2 inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-teal-100 text-teal-700 uppercase tracking-wide">LOT</span>
                )}
              </div>
              <span className="text-sm text-gray-500 shrink-0">{r.quantity} {r.unit}</span>
            </label>
            {needsLot && (
              <div className="px-3 pb-3">
                <input
                  type="text"
                  value={lotValue}
                  onChange={e => !locked && setLotNumber(k, e.target.value)}
                  disabled={locked}
                  placeholder="Enter lot / batch number from container label"
                  className={cn(
                    'w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-gray-50',
                    lotValue ? 'border-teal-300' : 'border-amber-300'
                  )}
                />
                {!lotValue && (
                  <p className="text-xs text-amber-600 mt-1">Lot / batch number required for this reagent.</p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PrintLabelsWidget({
  params, values, onChange, locked,
}: {
  params: Record<string, unknown>;
  values: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
  locked: boolean;
}) {
  const printed = (values.printed ?? false) as boolean;
  return (
    <div className="space-y-3">
      <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 space-y-1">
        <p className="text-sm text-gray-700">
          <span className="font-medium">Template:</span> {(params.label_template as string) || '—'}
        </p>
        <p className="text-sm text-gray-700">
          <span className="font-medium">Quantity:</span> {(params.quantity as number) ?? 1}
        </p>
        {!!params.notes && (
          <p className="text-sm text-gray-500">{params.notes as string}</p>
        )}
      </div>
      <label className={cn(
        'flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors',
        printed ? 'border-green-300 bg-green-50' : 'border-gray-200 bg-white hover:border-gray-300'
      )}>
        <input
          type="checkbox"
          checked={printed}
          onChange={() => !locked && onChange({ ...values, printed: !printed })}
          disabled={locked}
          className="w-4 h-4 rounded accent-green-600"
        />
        <span className="text-sm font-medium text-gray-800">Labels printed and applied</span>
      </label>
    </div>
  );
}

// ─── Attachment step ─────────────────────────────────────────────────────────
// The operator attaches documents (PDF, image, spreadsheet, …) to the order
// via the paperclip button. Files upload to the 'po-attachments' storage
// bucket under {orderId}/{wiStepId}/…; the list is kept on actual_values so
// completed steps can be reopened later to view every document.

interface AttachedFile {
  name: string;
  path: string;
  size: number;
  content_type: string;
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function attachmentUrl(path: string): string {
  return supabase.storage.from('po-attachments').getPublicUrl(path).data.publicUrl;
}

function AttachmentStepWidget({
  params, values, onChange, locked, orderId, wiStepId,
}: {
  params: Record<string, unknown>;
  values: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
  locked: boolean;
  orderId: string;
  wiStepId: string;
}) {
  const files = (values.files ?? []) as AttachedFile[];
  const required = (params.required as boolean) ?? true;
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setError('');
    setUploading(true);
    try {
      const added: AttachedFile[] = [];
      for (const file of Array.from(list)) {
        const safeName = file.name.replace(/[^\w.-]+/g, '_');
        const path = `${orderId}/${wiStepId}/${Date.now()}-${safeName}`;
        const { error: upErr } = await supabase.storage
          .from('po-attachments')
          .upload(path, file, { contentType: file.type || undefined });
        if (upErr) throw upErr;
        added.push({ name: file.name, path, size: file.size, content_type: file.type });
      }
      onChange({ ...values, files: [...files, ...added] });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Upload failed — try again.');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function removeFile(f: AttachedFile) {
    // Best effort — the authoritative record is the files list on the step.
    await supabase.storage.from('po-attachments').remove([f.path]);
    onChange({ ...values, files: files.filter(x => x.path !== f.path) });
  }

  return (
    <div className="space-y-3">
      <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 space-y-1">
        <p className="text-sm text-gray-700">
          {((params.prompt as string) || 'Attach the supporting documents for this production order.')}
        </p>
        <p className="text-xs text-gray-500">
          PDF, images, spreadsheets, … up to 25 MB each.
          {required && ' At least one attachment is required to complete this step.'}
        </p>
      </div>

      {/* Attached files */}
      {files.length > 0 && (
        <ul className="space-y-1.5">
          {files.map(f => (
            <li
              key={f.path}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm"
            >
              <FileText size={15} className="text-gray-400 shrink-0" />
              <span className="font-medium text-gray-800 truncate">{f.name}</span>
              <span className="text-xs text-gray-400 shrink-0">{formatFileSize(f.size)}</span>
              <a
                href={attachmentUrl(f.path)}
                target="_blank"
                rel="noreferrer"
                className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline shrink-0"
              >
                View <ExternalLink size={11} />
              </a>
              {!locked && (
                <button
                  onClick={() => removeFile(f)}
                  title="Remove attachment"
                  className="text-gray-300 hover:text-red-500 shrink-0"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Paperclip attach button */}
      {!locked && (
        <>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={e => handleFiles(e.target.files)}
          />
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-blue-200 bg-blue-50 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50 transition-colors"
          >
            {uploading ? <Loader2 size={15} className="animate-spin" /> : <Paperclip size={15} />}
            {uploading ? 'Uploading…' : files.length > 0 ? 'Attach another file' : 'Attach a file'}
          </button>
        </>
      )}
      {locked && files.length === 0 && (
        <p className="text-xs text-gray-400 italic">No documents were attached.</p>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

function GenericStepWidget({
  params, stepType,
}: {
  params: Record<string, unknown>;
  stepType: StepType;
}) {
  const lines: string[] = [];
  if (stepType === 'heat') {
    lines.push(`Heat to ${params.target_temp_c}°C for ${params.duration_minutes} minutes`);
  } else if (stepType === 'cool') {
    lines.push(`Cool to ${params.target_temp_c}°C`);
    if (params.method) lines.push(`Method: ${params.method}`);
  } else if (stepType === 'ph_adjust') {
    lines.push(`Target pH: ${params.target_ph} ± ${params.tolerance}`);
    lines.push(`Add ${params.reagent} dropwise with constant stirring`);
  } else if (stepType === 'transfer') {
    lines.push(`Transfer from ${params.from_vessel} to ${params.to_vessel}`);
    if (params.volume_mL) lines.push(`Volume: ${params.volume_mL} mL`);
  } else {
    lines.push((params.instruction_text as string) ?? 'Follow the step instructions');
  }

  return (
    <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 space-y-1">
      {lines.map((l, i) => <p key={i} className="text-sm text-gray-700">{l}</p>)}
    </div>
  );
}

// Renders the values an author configured on a user-defined library step,
// using the parameter schema snapshotted into the step at authoring time.
function UserDefinedStepWidget({ params }: { params: Record<string, unknown> }) {
  const schema = (params._param_schema ?? {}) as ParameterSchema;
  const rows = Object.entries(schema)
    .filter((entry): entry is [string, ParameterFieldDef] => !('items' in entry[1]))
    .map(([key, def]) => {
      const v = params[key];
      const display = def.type === 'boolean'
        ? (v === true ? 'Yes' : v === false ? 'No' : null)
        : (v !== undefined && v !== null && v !== '' ? String(v) : null);
      return { key, label: def.label ?? key, display };
    })
    .filter(r => r.display !== null);

  if (rows.length === 0) {
    return (
      <div className="bg-gray-50 border border-gray-100 rounded-xl p-4">
        <p className="text-sm text-gray-500">Follow the step instructions above.</p>
      </div>
    );
  }

  return (
    <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 space-y-1.5">
      {rows.map(r => (
        <p key={r.key} className="text-sm text-emerald-900">
          <span className="font-medium">{r.label}:</span> {r.display}
        </p>
      ))}
    </div>
  );
}

function PhAdjustStepWidget({
  params, values, onChange, locked,
}: {
  params: Record<string, unknown>;
  values: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
  locked: boolean;
}) {
  const target = (params.target_ph as number) ?? 7;
  const tolerance = (params.tolerance as number) ?? 0.1;
  const reagent = (params.reagent as string)?.trim();
  const lo = target - tolerance;
  const hi = target + tolerance;

  const [scanInput, setScanInput] = useState('');
  const [scanError, setScanError] = useState('');

  // The operator scans/selects the bench pH meter (equipment_type = 'ph_meter').
  const { data: meters = [] } = useQuery<Scale[]>({
    queryKey: ['equipment', 'ph_meter'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('scales').select('*').eq('status', 'active').eq('equipment_type', 'ph_meter').order('name');
      if (error) throw error;
      return data as Scale[];
    },
  });

  const connectedMeter = meters.find(m => m.id === (values.meter_id as string | undefined)) ?? null;
  const connected = !!connectedMeter;
  const meterName = connectedMeter?.name ?? (values.meter_name as string | undefined);

  const measured = values.measured_ph as number | undefined;
  const inTol = measured != null ? Math.abs(measured - target) <= tolerance : null;

  function connectMeter(m: Scale) {
    onChange({ ...values, meter_id: m.id, meter_name: m.name });
    setScanInput('');
    setScanError('');
  }
  function tryScan() {
    const match = meters.find(m => scanMatchesScale(scanInput, m));
    if (match) connectMeter(match);
    else setScanError('No active pH meter matches that scan. Try the meter name, barcode, or serial.');
  }

  return (
    <div className="space-y-4">
      <div className="bg-lime-50 border border-lime-100 rounded-xl p-4 space-y-1">
        <p className="text-sm font-medium text-lime-900">
          Target pH: <strong>{target} ± {tolerance}</strong>
          {' '}(allowed range: <strong>{lo.toFixed(2)} – {hi.toFixed(2)}</strong>)
        </p>
        {reagent && <p className="text-sm text-lime-800">Add {reagent} dropwise with constant stirring, then measure.</p>}
        <p className="text-xs text-lime-700 mt-1 flex items-center gap-1">
          <TestTube size={12} />
          {connected
            ? <>Reading on <strong className="ml-0.5">{meterName}</strong></>
            : <>Scan or select the pH meter at your bench to begin.</>}
        </p>
      </div>

      {/* Select / scan the pH meter (required before entering a reading) */}
      {!connected && !locked && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 space-y-3">
          <label className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
            <ScanLine size={14} className="text-gray-500" />
            Connect your pH meter
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              autoFocus
              value={scanInput}
              onChange={e => setScanInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); tryScan(); } }}
              placeholder="Scan meter name / barcode (e.g. pH Meter 01)"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={tryScan}
              disabled={!scanInput.trim()}
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
            >
              <WifiOff size={15} /> Connect
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">or choose</span>
            <select
              value=""
              onChange={e => { const m = meters.find(x => x.id === e.target.value); if (m) connectMeter(m); }}
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select a pH meter at your bench…</option>
              {meters.map(m => (
                <option key={m.id} value={m.id}>
                  {m.name}{m.barcode ? ` · ${m.barcode}` : ''}{m.location ? ` — ${m.location}` : ''}
                </option>
              ))}
            </select>
          </div>
          {scanError
            ? <p className="text-xs text-red-600">{scanError}</p>
            : meters.length === 0
              ? <p className="text-xs text-amber-700">No active pH meters registered. Add one on the Equipment page (type: pH meter).</p>
              : <p className="text-xs text-gray-500">Scan the meter’s barcode, or pick it from the list, to start the reading.</p>}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
          {connected ? 'Live pH Reading' : 'pH Reading'}
          {connected && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-green-700">
              <Wifi size={12} />
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75 animate-ping" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
              </span>
              Connected · {meterName}
            </span>
          )}
          {connected && !locked && (
            <button
              onClick={() => onChange({ ...values, meter_id: undefined, meter_name: undefined })}
              className="ml-auto text-[11px] text-gray-400 hover:text-gray-700 underline"
            >
              change meter
            </button>
          )}
        </label>
        <input
          type="number"
          step="0.01"
          value={measured ?? ''}
          onChange={e => {
            const v = parseFloat(e.target.value);
            onChange({
              ...values,
              measured_ph: isNaN(v) ? undefined : v,
              in_tolerance: isNaN(v) ? undefined : Math.abs(v - target) <= tolerance,
            });
          }}
          disabled={locked || !connected}
          placeholder={connected ? `Live pH from ${meterName ?? 'meter'}` : 'Connect a pH meter to enable the reading'}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
        />
      </div>

      {inTol != null && measured != null && (
        <div className={cn(
          'flex items-center gap-3 p-3 rounded-xl text-sm font-medium',
          inTol
            ? 'bg-green-50 border border-green-200 text-green-800'
            : 'bg-red-50 border border-red-200 text-red-800'
        )}>
          {inTol ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}
          <div>
            <p>
              {inTol ? 'In range' : 'OUT OF RANGE'} — measured pH {measured} (target {target} ± {tolerance})
            </p>
            {!inTol && (
              <p className="text-xs mt-0.5 font-normal opacity-80">
                Continue adjusting toward {target}, or contact a Reagent Lab Supervisor.
              </p>
            )}
          </div>
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">pH Adjustment Notes (optional)</label>
        <textarea
          rows={2}
          value={(values.ph_notes as string) ?? ''}
          onChange={e => onChange({ ...values, ph_notes: e.target.value })}
          disabled={locked}
          placeholder="e.g. volume of reagent added, observations…"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
        />
      </div>
    </div>
  );
}

// ─── Possible Deviation: capture impacted qty + notify supervisor via Teams ──
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

function PossibleDeviationWidget({
  params, values, onChange, locked, orderId, orderNumber, technicianName,
}: {
  params: Record<string, unknown>;
  values: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
  locked: boolean;
  orderId: string;
  orderNumber: string;
  technicianName: string;
}) {
  const unit = (params.unit as string) ?? 'L';
  const prompt = (params.prompt as string | undefined)?.trim();
  const impacted = values.impacted_quantity as number | undefined;
  const notified = (values.notified_supervisor as boolean) ?? false;
  const notifiedAt = values.notified_at as string | undefined;
  const [showTeams, setShowTeams] = useState(false);

  function notifySupervisor() {
    onChange({ ...values, notified_supervisor: true, notified_at: new Date().toISOString(), unit });
    setShowTeams(true);
    // E3: persist the notification so it lands in the admin inbox (the Teams
    // modal above stays as the simulated delivery view of the same message).
    void createNotification({
      type: 'possible_deviation',
      severity: 'critical',
      title: `Production Order ${orderNumber} — technician requests assistance`,
      body: `${technicianName || 'A technician'} flagged a possible deviation during production${
        impacted != null ? `. Impacted quantity: ${impacted} ${unit}` : ''
      }.`,
      channels: ['in_app', 'teams'],
      link: `/production-orders/${orderId}`,
      production_order_id: orderId,
      metadata: { impacted_quantity: impacted ?? null, unit, technician: technicianName || null },
    });
  }

  return (
    <div className="space-y-4">
      <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
        <AlertTriangle size={20} className="text-red-600 mt-0.5 shrink-0" />
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-red-500">Possible Deviation</p>
          <p className="text-sm text-red-800 mt-0.5">
            {prompt || 'Record the impacted quantity and notify your supervisor if assistance is required.'}
          </p>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Impacted Quantity <span className="text-red-500">*</span>
        </label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            step="any"
            value={impacted ?? ''}
            onChange={e => {
              const v = parseFloat(e.target.value);
              onChange({ ...values, impacted_quantity: isNaN(v) ? undefined : v, unit });
            }}
            disabled={locked}
            placeholder="e.g. 2.5"
            className="w-40 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 disabled:bg-gray-50"
          />
          <span className="text-sm text-gray-500">{unit}</span>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={notifySupervisor}
          disabled={locked}
          className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-sm font-semibold rounded-lg hover:bg-red-700 disabled:opacity-50"
        >
          <AlertTriangle size={15} /> Notify Supervisor
        </button>
        {notified && (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
            <CheckCircle size={14} />
            Supervisor notified via Teams{notifiedAt ? ` · ${new Date(notifiedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
          </span>
        )}
      </div>
      {notified && !locked && (
        <button onClick={() => setShowTeams(true)} className="text-xs text-gray-400 hover:text-gray-600 underline">
          View the Teams message that was sent
        </button>
      )}

      {showTeams && (
        <TeamsBroadcastModal
          orderNumber={orderNumber}
          technicianName={technicianName}
          impacted={impacted}
          unit={unit}
          onClose={() => setShowTeams(false)}
        />
      )}
    </div>
  );
}

function TeamsBroadcastModal({
  orderNumber, technicianName, impacted, unit, onClose,
}: {
  orderNumber: string;
  technicianName: string;
  impacted: number | undefined;
  unit: string;
  onClose: () => void;
}) {
  const now = new Date();
  const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Teams title bar */}
        <div className="flex items-center justify-between px-4 py-3" style={{ backgroundColor: '#5059C9' }}>
          <div className="flex items-center gap-2 text-white">
            <MessageSquare size={18} />
            <span className="font-semibold text-sm">Microsoft Teams</span>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white"><X size={18} /></button>
        </div>

        <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50">
          <p className="text-[11px] uppercase tracking-wide text-gray-400">Posted to channel</p>
          <p className="text-sm font-medium text-gray-800">Lab Production Floor › Supervisors</p>
        </div>

        {/* Message */}
        <div className="p-4 flex gap-3">
          <div className="h-9 w-9 rounded-full bg-indigo-500 text-white flex items-center justify-center text-sm font-semibold shrink-0">
            {initials(technicianName || 'Technician')}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm">
              <span className="font-semibold text-gray-900">{technicianName || 'Technician'}</span>
              <span className="text-xs text-gray-400 ml-2">{time}</span>
            </p>
            <div className="mt-2 border border-red-200 rounded-lg overflow-hidden">
              <div className="bg-red-600 h-1" />
              <div className="p-3 space-y-1.5">
                <p className="flex items-start gap-1.5 text-sm font-semibold text-red-700">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                  Production Order {orderNumber || '—'} — Technician requests assistance
                </p>
                <p className="text-sm text-gray-700">A possible deviation has been flagged during production.</p>
                {impacted != null && (
                  <p className="text-sm text-gray-600">Impacted quantity: <strong>{impacted} {unit}</strong></p>
                )}
                <p className="text-xs text-gray-400 pt-0.5">@Production Supervisors — please assist at the bench.</p>
              </div>
            </div>
          </div>
        </div>

        <div className="px-4 py-3 border-t border-gray-100 bg-gray-50 flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700 font-medium">
            <CheckCircle size={14} /> Message delivered
          </span>
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-lg bg-gray-800 text-white hover:bg-gray-900">Close</button>
        </div>
      </div>
    </div>
  );
}

// ─── Step execution card ──────────────────────────────────────────────────────
interface StepCardProps {
  wiStep: WIStep;
  poStep: POStep | undefined;
  index: number;
  isActive: boolean;
  orderId: string;
  orderNumber: string;
  technicianName: string;
  onActivate: () => void;
  onComplete: (actualValues: Record<string, unknown>, notes: string) => void;
  onSkip: () => void;
  onReopen: () => void;
}

function StepCard({ wiStep, poStep, index, isActive, orderId, orderNumber, technicianName, onActivate, onComplete, onSkip, onReopen }: StepCardProps) {
  const params = wiStep.parameters as Record<string, unknown>;
  const stepType = (params._step_type ?? 'custom') as StepType;
  const [values, setValues] = useState<Record<string, unknown>>(poStep?.actual_values ?? {});
  const [stepNotes, setStepNotes] = useState(poStep?.notes ?? '');

  const status = poStep?.status ?? 'pending';
  const isDone = status === 'completed' || status === 'skipped';
  const locked = isDone;

  function canComplete(): boolean {
    if (stepType === 'weigh') {
      const lotOk = !(params.lot_controlled as boolean) || !!(values.lot_number as string)?.trim();
      const scaleOk = !!(values.scale_id as string | undefined);
      return scaleOk && (values.measured_weight != null) && (values.in_tolerance === true) && lotOk;
    }
    if (stepType === 'gather_inputs') {
      const inputs = params.inputs as { material_name: string }[] ?? [];
      const checked = (values.checked ?? []) as string[];
      return inputs.every(i => checked.includes(i.material_name));
    }
    if (stepType === 'gather_equipment') {
      const equipment = params.equipment as { name: string }[] ?? [];
      const checked = (values.checked ?? []) as string[];
      return equipment.every(e => checked.includes(e.name));
    }
    if (stepType === 'gather_reagents') {
      const reagents = params.reagents as { item_number: string; product_name: string; lot_controlled?: boolean }[] ?? [];
      const checked = (values.checked ?? []) as string[];
      const lotNumbers = (values.lot_numbers ?? {}) as Record<string, string>;
      const allChecked = reagents.every(r => checked.includes(r.item_number || r.product_name));
      const lotOk = reagents
        .filter(r => r.lot_controlled)
        .every(r => !!(lotNumbers[r.item_number || r.product_name])?.trim());
      return allChecked && lotOk;
    }
    if (stepType === 'print_labels') {
      return (values.printed ?? false) === true;
    }
    if (stepType === 'attachment') {
      const required = (params.required as boolean) ?? true;
      const files = (values.files ?? []) as unknown[];
      return !required || files.length > 0;
    }
    if (stepType === 'possible_deviation') {
      return values.impacted_quantity != null;
    }
    if (stepType === 'ph_adjust') {
      // Require the meter that was used and an in-range reading — mirrors the
      // weigh step's scale + in-tolerance gate.
      const meterOk = !!(values.meter_id as string | undefined);
      return meterOk && (values.measured_ph != null) && (values.in_tolerance === true);
    }
    return true;
  }

  return (
    <div
      className={cn(
        'rounded-xl border transition-all',
        isActive ? 'border-blue-300 shadow-md' : isDone ? 'border-gray-100 bg-gray-50' : 'border-gray-200 bg-white',
      )}
    >
      {/* Step header */}
      <div
        className={cn(
          'flex items-center gap-3 px-4 py-3 cursor-pointer',
          !isDone && !isActive && 'hover:bg-gray-50'
        )}
        onClick={() => isDone ? onActivate() : onActivate()}
      >
        <div className={cn(
          'flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold shrink-0',
          isDone ? 'bg-green-100 text-green-700' : isActive ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500'
        )}>
          {isDone ? <CheckCircle size={16} /> : index + 1}
        </div>
        <span className="text-gray-400 shrink-0">{STEP_ICONS[stepType]}</span>
        <span className="flex-1 font-medium text-gray-900 text-sm">{wiStep.name}</span>
        {status === 'skipped' && <span className="text-xs text-gray-400">Skipped</span>}
        {status === 'completed' && <span className="text-xs text-green-600 font-medium">Completed</span>}
        {!isDone && !isActive && <ChevronRight size={15} className="text-gray-300" />}
      </div>

      {/* Expanded content */}
      {isActive && (
        <div className="px-4 pb-4 space-y-4 border-t border-gray-100 pt-4">
          {wiStep.description && (
            <p className="text-sm text-gray-600">{wiStep.description}</p>
          )}

          {/* Step-specific widget */}
          {stepType === 'weigh' && (
            <WeighStepWidget params={params} values={values} onChange={setValues} locked={locked} />
          )}
          {stepType === 'mix' && (
            <MixStepWidget params={params} values={values} onChange={setValues} locked={locked} />
          )}
          {stepType === 'observe' && (
            <ObserveStepWidget params={params} values={values} onChange={setValues} locked={locked} />
          )}
          {stepType === 'notes' && (
            <NotesStepWidget params={params} values={values} onChange={setValues} locked={locked} />
          )}
          {stepType === 'production_break' && (
            <ProductionBreakWidget params={params} />
          )}
          {stepType === 'ph_adjust' && (
            <PhAdjustStepWidget params={params} values={values} onChange={setValues} locked={locked} />
          )}
          {stepType === 'gather_inputs' && (
            <GatherInputsWidget params={params} values={values} onChange={setValues} locked={locked} />
          )}
          {stepType === 'gather_equipment' && (
            <GatherEquipmentWidget params={params} values={values} onChange={setValues} locked={locked} />
          )}
          {stepType === 'gather_reagents' && (
            <GatherReagentsWidget params={params} values={values} onChange={setValues} locked={locked} />
          )}
          {stepType === 'print_labels' && (
            <PrintLabelsWidget params={params} values={values} onChange={setValues} locked={locked} />
          )}
          {stepType === 'attachment' && (
            <AttachmentStepWidget
              params={params}
              values={values}
              onChange={setValues}
              locked={locked}
              orderId={orderId}
              wiStepId={wiStep.id}
            />
          )}
          {stepType === 'possible_deviation' && (
            <PossibleDeviationWidget
              params={params}
              values={values}
              onChange={setValues}
              locked={locked}
              orderId={orderId}
              orderNumber={orderNumber}
              technicianName={technicianName}
            />
          )}
          {stepType === 'user_defined' && (
            <UserDefinedStepWidget params={params} />
          )}
          {['heat','cool','transfer','custom'].includes(stepType) && (
            <GenericStepWidget params={params} stepType={stepType} />
          )}

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Step Notes (optional)</label>
            <textarea
              rows={2}
              value={stepNotes}
              onChange={e => setStepNotes(e.target.value)}
              disabled={locked}
              placeholder="Any observations or deviations…"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-50"
            />
          </div>

          {!locked && (
            <div className="flex gap-2">
              <button
                onClick={() => onComplete(values, stepNotes)}
                disabled={!canComplete()}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <CheckCheck size={15} />
                Complete Step
              </button>
              <button
                onClick={onSkip}
                className="px-4 py-2 text-sm text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                Skip
              </button>
            </div>
          )}
          {locked && (
            <button
              onClick={onReopen}
              className="px-4 py-2 text-sm text-amber-700 border border-amber-200 bg-amber-50 rounded-lg hover:bg-amber-100"
            >
              ↩ Reopen Step
            </button>
          )}

          {stepType === 'weigh' && values.measured_weight != null && !values.in_tolerance && (
            <p className="text-xs text-red-600 font-medium">
              ⚠ Weight is out of tolerance — you cannot complete this step until the measurement is within range.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Quality Control capture card ─────────────────────────────────────────────
interface QCInput { num: string; text: string; pass: '' | 'Pass' | 'Fail'; instrument: string; comment: string }

function QualityControlCard({
  productionOrderId, reagentItemId, locked, onCertificate, onResultsSaved,
}: {
  productionOrderId: string;
  reagentItemId: string;
  locked: boolean;
  onCertificate: () => void;
  /** Fired after QC results are saved, so the parent can advance the order out of "Awaiting QC". */
  onResultsSaved?: () => void;
}) {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [inputs, setInputs] = useState<Record<string, QCInput>>({});
  const seededFor = useRef<string | null>(null);

  // Equipment suggestions for the instrument field (B4: consistent instrument
  // names make the by-instrument quality pivot usable).
  const { data: qcInstruments = [] } = useQuery<Scale[]>({
    queryKey: ['active-scales'],
    queryFn: async () => {
      const { data, error } = await supabase.from('scales').select('*').eq('status', 'active').order('name');
      if (error) throw error;
      return data as Scale[];
    },
  });

  const { data: tests = [], isLoading: testsLoading } = useQuery<QCTest[]>({
    queryKey: ['qc-tests', reagentItemId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('qc_tests')
        .select('*')
        .eq('reagent_item_id', reagentItemId)
        .eq('is_active', true)
        .order('test_order');
      if (error) throw error;
      return data as QCTest[];
    },
  });

  const { data: results = [], isLoading: resultsLoading } = useQuery<QCResult[]>({
    queryKey: ['qc-results', productionOrderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('qc_results')
        .select('*')
        .eq('production_order_id', productionOrderId)
        .order('test_order');
      if (error) throw error;
      return data as QCResult[];
    },
  });

  // Seed editable inputs from saved results once per order (after both load).
  useEffect(() => {
    if (seededFor.current === productionOrderId) return;
    if (testsLoading || resultsLoading) return;
    const seed: Record<string, QCInput> = {};
    for (const t of tests) {
      const r = results.find(x => x.qc_test_id === t.id);
      let pass: '' | 'Pass' | 'Fail' = '';
      if (t.result_type === 'passfail' && r) {
        pass = r.result_text === 'Fail' || r.passed === false ? 'Fail'
             : r.result_text === 'Pass' || r.passed === true ? 'Pass' : '';
      }
      seed[t.id] = {
        num: r?.result_numeric != null ? String(r.result_numeric) : '',
        text: r?.result_text ?? '',
        pass,
        instrument: r?.instrument ?? '',
        comment: r?.comment ?? '',
      };
    }
    setInputs(seed);
    seededFor.current = productionOrderId;
  }, [tests, results, testsLoading, resultsLoading, productionOrderId]);

  function setField(testId: string, patch: Partial<QCInput>) {
    setInputs(prev => ({ ...prev, [testId]: { ...(prev[testId] ?? { num: '', text: '', pass: '', instrument: '', comment: '' }), ...patch } }));
  }

  const liveStatus = (t: QCTest): boolean | null => {
    const inp = inputs[t.id];
    if (!inp) return null;
    const num = inp.num === '' ? null : parseFloat(inp.num);
    const textVal = t.result_type === 'passfail' ? inp.pass : inp.text;
    return evaluateQC(t, num, textVal);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      for (let i = 0; i < tests.length; i++) {
        const t = tests[i];
        const inp = inputs[t.id] ?? { num: '', text: '', pass: '' as const, instrument: '', comment: '' };
        const num = inp.num === '' ? null : parseFloat(inp.num);
        const textVal = t.result_type === 'passfail' ? inp.pass : inp.text;
        const passed = evaluateQC(t, num, textVal);
        const hasValue = (
          t.result_type === 'numeric' ? num != null
          : t.result_type === 'passfail' ? !!inp.pass
          : !!inp.text.trim()
        );
        const payload = {
          production_order_id: productionOrderId,
          qc_test_id: t.id,
          test_order: i,
          name: t.name,
          unit: t.unit ?? null,
          result_type: t.result_type,
          lower_limit: t.lower_limit ?? null,
          upper_limit: t.upper_limit ?? null,
          target: t.target ?? null,
          expected_text: t.expected_text ?? null,
          method: t.method ?? null,
          result_numeric: t.result_type === 'numeric' ? num : null,
          result_text: t.result_type === 'passfail' ? (inp.pass || null)
                     : t.result_type === 'text' ? (inp.text.trim() || null)
                     : null,
          passed,
          instrument: inp.instrument.trim() || null,
          comment: inp.comment.trim() || null,
          tested_by: hasValue ? profile!.id : null,
          tested_at: hasValue ? new Date().toISOString() : null,
        };
        const existing = results.find(r => r.qc_test_id === t.id);
        if (existing) {
          const { error } = await supabase.from('qc_results').update(payload).eq('id', existing.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from('qc_results').insert(payload);
          if (error) throw error;
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['qc-results', productionOrderId] });
      onResultsSaved?.();
    },
  });

  if (testsLoading) return null;
  if (tests.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center gap-2 text-gray-700">
          <ClipboardCheck size={18} className="text-emerald-600" />
          <h2 className="font-semibold">Quality Control</h2>
        </div>
        <p className="text-sm text-gray-400 mt-2">
          No QC specifications are defined for this product. Add them on the Reagent Items page to capture release testing here.
        </p>
      </div>
    );
  }

  const evaluated = tests.map(liveStatus);
  const anyFail = evaluated.some(s => s === false);
  const allMeasured = tests.every(t => {
    const inp = inputs[t.id];
    if (!inp) return false;
    if (t.result_type === 'numeric') return inp.num !== '';
    if (t.result_type === 'passfail') return inp.pass !== '';
    return inp.text.trim() !== '';
  });
  const allPass = allMeasured && evaluated.every(s => s !== false);
  const hasSavedResults = results.some(r => r.result_numeric != null || (r.result_text ?? '') !== '');

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Shared suggestions for every test's instrument input */}
      <datalist id="qc-instrument-options">
        {qcInstruments.map(s => <option key={s.id} value={s.name} />)}
      </datalist>
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 bg-gray-50">
        <div className="flex items-center gap-2 text-gray-800">
          <ClipboardCheck size={18} className="text-emerald-600" />
          <h2 className="font-semibold">Quality Control</h2>
        </div>
        {allMeasured && (
          <span className={cn(
            'flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full',
            anyFail ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
          )}>
            {anyFail ? <><XCircle size={13} /> Out of spec</> : <><CheckCircle size={13} /> All in spec</>}
          </span>
        )}
      </div>

      <div className="divide-y divide-gray-50">
        {tests.map(t => {
          const inp = inputs[t.id] ?? { num: '', text: '', pass: '' as const, instrument: '', comment: '' };
          const status = liveStatus(t);
          return (
            <div key={t.id} className="px-5 py-3">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900">{t.name}</span>
                    {t.method && <span className="text-xs text-gray-400">· {t.method}</span>}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">Spec: {formatSpec(t)}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {t.result_type === 'numeric' ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number" step="any" inputMode="decimal"
                        value={inp.num}
                        disabled={locked}
                        onChange={e => setField(t.id, { num: e.target.value })}
                        placeholder="value"
                        className="w-24 border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                      />
                      {t.unit && <span className="text-xs text-gray-400 w-14">{t.unit}</span>}
                    </div>
                  ) : t.result_type === 'passfail' ? (
                    <label className="flex items-center gap-2 w-44 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={inp.pass === 'Pass'}
                        disabled={locked}
                        onChange={e => setField(t.id, { pass: e.target.checked ? 'Pass' : 'Fail' })}
                        className="w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 disabled:opacity-50"
                      />
                      <span className="text-sm text-gray-600">
                        {inp.pass === 'Pass' ? 'Pass — conforms' : inp.pass === 'Fail' ? 'Fail — does not conform' : 'Mark Pass'}
                      </span>
                    </label>
                  ) : (
                    <input
                      value={inp.text}
                      disabled={locked}
                      onChange={e => setField(t.id, { text: e.target.value })}
                      placeholder={t.expected_text ?? 'observation'}
                      className="w-44 border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                    />
                  )}
                  <span className="w-16 text-right">
                    {status === true && <span className="text-xs font-semibold text-green-600">PASS</span>}
                    {status === false && <span className="text-xs font-semibold text-red-600">FAIL</span>}
                    {status === null && <span className="text-xs text-gray-300">—</span>}
                  </span>
                </div>
              </div>
              <div className="flex gap-2 mt-2">
                <input
                  value={inp.instrument}
                  disabled={locked}
                  onChange={e => setField(t.id, { instrument: e.target.value })}
                  placeholder="Instrument / equipment ID (optional)"
                  list="qc-instrument-options"
                  className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-gray-50"
                />
                <input
                  value={inp.comment}
                  disabled={locked}
                  onChange={e => setField(t.id, { comment: e.target.value })}
                  placeholder="Comment (optional)"
                  className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-gray-50"
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-2 px-5 py-3.5 border-t border-gray-100 bg-gray-50">
        <p className="text-xs text-gray-400">
          {allPass ? 'All results within specification.' : anyFail ? 'One or more results are out of specification.' : 'Enter measured values to evaluate against spec.'}
        </p>
        <div className="flex items-center gap-2">
          {!locked && (
            <button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {saveMutation.isPending ? 'Saving…' : 'Save QC Results'}
            </button>
          )}
          <button
            onClick={onCertificate}
            disabled={!hasSavedResults}
            title={hasSavedResults ? 'Open certificate' : 'Save QC results first'}
            className="flex items-center gap-1.5 px-4 py-2 border border-emerald-300 text-emerald-700 bg-emerald-50 text-sm rounded-lg font-medium hover:bg-emerald-100 disabled:opacity-50"
          >
            <FileText size={15} /> Certificate
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function ProductionOrderExecutionPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { profile } = useAuth();
  const [activeStepIdx, setActiveStepIdx] = useState<number | null>(null);
  const [d365Start, setD365Start] = useState<
    | { phase: 'idle' }
    | { phase: 'sending' }
    | { phase: 'sent'; queue: string }
    | { phase: 'failed'; error: string }
    | { phase: 'skipped'; reason: string }
  >({ phase: 'idle' });

  // Post a ProdProductionOrderStart message to the D365 SysMessage framework.
  // Best-effort: the order is already started locally; D365 failure is surfaced
  // but does not block production.
  async function sendD365Start(orderId: string) {
    setD365Start({ phase: 'sending' });
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('Not authenticated');
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/start-d365-production-order`;
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
        setD365Start({ phase: 'skipped', reason: body?.error ?? 'D365 integration disabled' });
        return;
      }
      if (!res.ok || !body?.success) {
        setD365Start({ phase: 'failed', error: body?.error ?? `HTTP ${res.status}` });
        return;
      }
      setD365Start({ phase: 'sent', queue: body.message_queue ?? '' });
    } catch (e) {
      setD365Start({ phase: 'failed', error: e instanceof Error ? e.message : 'Unknown error' });
    } finally {
      qc.invalidateQueries({ queryKey: ['production-order', id] });
    }
  }

  const { data: order } = useQuery<ProductionOrder>({
    queryKey: ['production-order', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('production_orders')
        .select('*, work_instruction:work_instructions(title, product_name, target_molarity, version, reagent_item_id, reagent_item:reagent_items(id, item_number, product_name, unit_of_measure)), assignee:profiles!assigned_to(full_name, email)')
        .eq('id', id!)
        .single();
      if (error) throw error;
      return data as ProductionOrder;
    },
  });

  const { data: wiSteps = [] } = useQuery<WIStep[]>({
    queryKey: ['wi-steps-for-order', id],
    enabled: !!order,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('wi_steps')
        .select('*')
        .eq('work_instruction_id', order!.work_instruction_id)
        .order('step_order');
      if (error) throw error;
      return data as WIStep[];
    },
  });

  const { data: poSteps = [], refetch: refetchPOSteps } = useQuery<POStep[]>({
    queryKey: ['po-steps', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('po_steps')
        .select('*')
        .eq('production_order_id', id!)
        .order('step_order');
      if (error) throw error;
      return data as POStep[];
    },
  });

  const startOrderMutation = useMutation({
    mutationFn: async () => {
      // Update order status to in_progress
      const { error: e1 } = await supabase
        .from('production_orders')
        .update({ status: 'in_progress', started_at: new Date().toISOString() })
        .eq('id', id!);
      if (e1) throw e1;

      // Create po_step records for each wi step
      const stepsPayload = wiSteps.map((s, i) => ({
        production_order_id: id!,
        wi_step_id: s.id,
        step_order: i + 1,
        status: 'pending',
        actual_values: {},
        operator_id: profile!.id,
      }));
      const { error: e2 } = await supabase.from('po_steps').insert(stepsPayload);
      if (e2) throw e2;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['production-order', id] });
      qc.invalidateQueries({ queryKey: ['po-steps', id] });
      setActiveStepIdx(0);
      // Notify D365 to start the production order — only for orders that
      // originated in D365 (manual orders have no D365 order to start).
      if (order?.d365_prod_id) void sendD365Start(id!);
    },
  });

  // When all production steps are finished, decide whether the batch is fully
  // done ('completed') or still needs release testing ('awaiting_qc'). Returns
  // null while any production step is still outstanding.
  async function resolveProductionDoneStatus(): Promise<POStatus | null> {
    const { data: freshSteps } = await supabase
      .from('po_steps').select('status').eq('production_order_id', id!);
    const steps = freshSteps ?? [];
    if (steps.length === 0 || !steps.every(s => s.status === 'completed' || s.status === 'skipped')) {
      return null; // production not finished yet
    }
    const reagentItemId = (order?.work_instruction as any)?.reagent_item_id as string | undefined;
    if (reagentItemId) {
      const { data: qcTests } = await supabase
        .from('qc_tests').select('id').eq('reagent_item_id', reagentItemId).eq('is_active', true);
      if (qcTests && qcTests.length > 0) {
        const { data: qcRes } = await supabase
          .from('qc_results').select('qc_test_id, result_numeric, result_text')
          .eq('production_order_id', id!);
        const savedIds = new Set(
          (qcRes ?? [])
            .filter(r => r.result_numeric != null || (r.result_text ?? '') !== '')
            .map(r => r.qc_test_id),
        );
        if (!qcTests.every(t => savedIds.has(t.id))) return 'awaiting_qc';
      }
    }
    return 'completed';
  }

  // Advance the order to its resolved done-status (no-op while steps remain or
  // when nothing changes). Used after QC results are saved.
  const reconcileDoneStatus = useMutation({
    mutationFn: async () => {
      const target = await resolveProductionDoneStatus();
      if (!target || target === order?.status || order?.status === 'cancelled') return;
      await supabase
        .from('production_orders')
        .update({ status: target, completed_at: order?.completed_at ?? new Date().toISOString() })
        .eq('id', id!);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['production-order', id] }),
  });

  const completeStepMutation = useMutation({
    mutationFn: async ({
      wiStepId, actualValues, notes, skip,
    }: {
      wiStepId: string;
      actualValues: Record<string, unknown>;
      notes: string;
      skip: boolean;
    }) => {
      const poStep = poSteps.find(s => s.wi_step_id === wiStepId);
      if (!poStep) throw new Error('PO step not found');

      const { error } = await supabase
        .from('po_steps')
        .update({
          status: skip ? 'skipped' : 'completed',
          actual_values: actualValues,
          notes: notes || null,
          operator_id: profile!.id,
          started_at: poStep.started_at ?? new Date().toISOString(),
          completed_at: new Date().toISOString(),
        })
        .eq('id', poStep.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await refetchPOSteps();
      // Advance to next pending step
      const nextIdx = wiSteps.findIndex((s, i) => {
        const ps = poSteps.find(p => p.wi_step_id === s.id);
        return i > activeStepIdx! && (!ps || ps.status === 'pending');
      });
      setActiveStepIdx(nextIdx >= 0 ? nextIdx : null);

      // Production finished? Resolve to 'completed', or 'awaiting_qc' when QC
      // release results are still outstanding.
      const doneStatus = await resolveProductionDoneStatus();
      if (doneStatus) {
        await supabase
          .from('production_orders')
          .update({ status: doneStatus, completed_at: order?.completed_at ?? new Date().toISOString() })
          .eq('id', id!);
        qc.invalidateQueries({ queryKey: ['production-order', id] });
      }
    },
  });

  const reopenStepMutation = useMutation({
    mutationFn: async (wiStepId: string) => {
      const poStep = poSteps.find(s => s.wi_step_id === wiStepId);
      if (!poStep) return;
      await supabase.from('po_steps').update({
        status: 'pending',
        actual_values: {},
        notes: null,
        completed_at: null,
      }).eq('id', poStep.id);
      // If order was completed, revert it to in_progress
      if (order?.status === 'completed') {
        await supabase.from('production_orders').update({ status: 'in_progress', completed_at: null }).eq('id', id!);
      }
      qc.invalidateQueries({ queryKey: ['production-order', id] });
      qc.invalidateQueries({ queryKey: ['po-steps', id] });
    },
  });

  const cancelOrderMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('production_orders')
        .update({ status: 'cancelled' })
        .eq('id', id!);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['production-orders'] });
      qc.invalidateQueries({ queryKey: ['production-order', id] });
    },
  });

  const deleteOrderMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('production_orders')
        .delete()
        .eq('id', id!);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['production-orders'] });
      navigate('/production-orders');
    },
  });

  const wi = order?.work_instruction as any;
  const isStarted = order?.status === 'in_progress' || order?.status === 'awaiting_qc' || order?.status === 'completed';
  const isCompleted = order?.status === 'completed';
  const isAdmin = profile?.role === 'admin';
  const isCreator = order?.created_by === profile?.id;
  const canCancel = (isAdmin || isCreator) && (order?.status === 'pending' || order?.status === 'in_progress');
  const canDelete = isAdmin || (isCreator && (order?.status === 'pending' || order?.status === 'cancelled'));
  const canReassign = (isAdmin || isCreator) && order?.status !== 'completed' && order?.status !== 'cancelled';

  const completedCount = poSteps.filter(s => s.status === 'completed' || s.status === 'skipped').length;
  const progress = wiSteps.length > 0 ? Math.round((completedCount / wiSteps.length) * 100) : 0;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <button onClick={() => navigate('/production-orders')} className="mt-1 text-gray-400 hover:text-gray-700">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900">
            {order?.lot_number ?? 'Loading…'}
          </h1>
          <p className="text-sm text-gray-500">
            {wi?.product_name}{wi?.target_molarity != null ? ` — ${wi.target_molarity} M` : ''}
            {order?.batch_size != null && ` · ${order.batch_size} ${order.batch_size_unit}`}
            {order?.wi_version != null && (
              <span className="ml-2 text-xs text-indigo-500 font-medium">WI v{order.wi_version}</span>
            )}
          </p>
          {order && (
            <>
              <AssigneeEditor order={order} canEdit={canReassign} />
              <RequiredByEditor order={order} canEdit={isAdmin || isCreator || order.assigned_to === profile?.id} />
              <ScheduleEditor order={order} canEdit={isAdmin || isCreator || order.assigned_to === profile?.id} />
            </>
          )}
        </div>
        <span className={cn(
          'text-xs font-medium px-2.5 py-1 rounded-full mt-1',
          order?.status === 'completed' ? 'bg-green-100 text-green-700' :
          order?.status === 'awaiting_qc' ? 'bg-amber-100 text-amber-700' :
          order?.status === 'in_progress' ? 'bg-blue-100 text-blue-700' :
          'bg-gray-100 text-gray-600'
        )}>
          {order?.status === 'awaiting_qc' ? 'Awaiting QC' : order?.status?.replace('_', ' ')}
        </span>
      </div>

      {/* Cancel / Delete actions */}
      {(canCancel || canDelete) && (
        <div className="flex items-center justify-end gap-2">
          {canCancel && (
            <button
              onClick={() => {
                if (!window.confirm('Cancel this production order? It will be marked as cancelled.')) return;
                cancelOrderMutation.mutate();
              }}
              disabled={cancelOrderMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-orange-700 border border-orange-200 bg-orange-50 rounded-lg hover:bg-orange-100 disabled:opacity-50"
            >
              <Ban size={14} /> Cancel Order
            </button>
          )}
          {canDelete && (
            <button
              onClick={() => {
                if (!window.confirm('Permanently delete this order and all its step data? This cannot be undone.')) return;
                deleteOrderMutation.mutate();
              }}
              disabled={deleteOrderMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-700 border border-red-200 bg-red-50 rounded-lg hover:bg-red-100 disabled:opacity-50"
            >
              <Trash2 size={14} /> Delete
            </button>
          )}
        </div>
      )}

      {/* Progress bar */}
      {isStarted && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex justify-between text-sm mb-2">
            <span className="font-medium text-gray-700">Progress</span>
            <span className="text-gray-500">{completedCount} / {wiSteps.length} steps</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-2.5">
            <div
              className={cn('h-2.5 rounded-full transition-all', isCompleted ? 'bg-green-500' : 'bg-blue-500')}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* D365 production-order start message status */}
      {d365Start.phase !== 'idle' && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Send size={16} className="text-blue-600" />
            <h2 className="text-sm font-semibold text-gray-900">D365 Production Order Start</h2>
          </div>
          {d365Start.phase === 'sending' && (
            <div className="flex items-center gap-2 text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-lg p-2.5">
              <Loader2 size={15} className="animate-spin" />
              Posting <span className="font-mono">ProdProductionOrderStart</span> to the D365 message queue…
            </div>
          )}
          {d365Start.phase === 'sent' && (
            <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg p-2.5">
              <CheckCircle size={15} />
              Start message sent to D365{d365Start.queue ? <> (queue <span className="font-mono">{d365Start.queue}</span>)</> : ''}.
            </div>
          )}
          {d365Start.phase === 'failed' && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">
              <div className="font-medium mb-0.5">Could not post start message to D365</div>
              <div className="text-xs whitespace-pre-wrap break-words">{d365Start.error}</div>
              <p className="text-xs text-gray-500 mt-1">The order was started locally; the D365 message can be retried.</p>
            </div>
          )}
          {d365Start.phase === 'skipped' && (
            <div className="text-sm text-yellow-800 bg-yellow-50 border border-yellow-200 rounded-lg p-2.5">
              D365 integration is disabled — start message not sent. ({d365Start.reason})
            </div>
          )}
        </div>
      )}

      {/* Start button */}
      {!isStarted && order?.status === 'pending' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 text-center space-y-3">
          <p className="text-gray-600 text-sm">Ready to begin production of <strong>{wi?.product_name}</strong>?</p>
          <button
            onClick={() => startOrderMutation.mutate()}
            disabled={startOrderMutation.isPending || wiSteps.length === 0}
            className="flex items-center gap-2 mx-auto px-6 py-3 bg-green-600 text-white rounded-xl font-medium hover:bg-green-700 disabled:opacity-50"
          >
            <PlayCircle size={18} />
            Start Production
          </button>
          {wiSteps.length === 0 && (
            <p className="text-xs text-red-500">This work instruction has no steps defined.</p>
          )}
        </div>
      )}

      {/* Completed banner */}
      {isCompleted && (
        <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl p-4 text-green-800">
          <CheckCircle size={22} />
          <div>
            <p className="font-semibold">Production complete</p>
            <p className="text-sm">All steps finished for lot {order?.lot_number}</p>
          </div>
        </div>
      )}

      {/* Materials — the bill of materials for the run, rolled up from the
          WI's steps. Shown before the order starts so the operator can stage
          the bench, and kept visible during the run for reference. */}
      {wiSteps.length > 0 && <OrderMaterialsSummary steps={wiSteps} />}

      {/* Steps */}
      {isStarted && (
        <div className="space-y-3">
          {wiSteps.map((wiStep, i) => {
            const poStep = poSteps.find(s => s.wi_step_id === wiStep.id);
            return (
              <StepCard
                key={wiStep.id}
                wiStep={wiStep}
                poStep={poStep}
                index={i}
                isActive={activeStepIdx === i}
                orderId={id!}
                orderNumber={order?.production_order_number ?? order?.lot_number ?? ''}
                technicianName={profile?.full_name ?? ''}
                onActivate={() => setActiveStepIdx(i)}
                onComplete={async (actualValues, notes) => {
                  await completeStepMutation.mutateAsync({ wiStepId: wiStep.id, actualValues, notes, skip: false });
                }}
                onSkip={async () => {
                  await completeStepMutation.mutateAsync({ wiStepId: wiStep.id, actualValues: {}, notes: '', skip: true });
                }}
                onReopen={async () => {
                  await reopenStepMutation.mutateAsync(wiStep.id);
                }}
              />
            );
          })}
        </div>
      )}

      {/* Quality Control capture */}
      {isStarted && wi?.reagent_item_id && (
        <QualityControlCard
          productionOrderId={id!}
          reagentItemId={wi.reagent_item_id}
          locked={order?.status === 'cancelled'}
          onCertificate={() => navigate(`/production-orders/${id}/certificate`)}
          onResultsSaved={() => reconcileDoneStatus.mutate()}
        />
      )}

      {/* Non-started steps preview */}
      {!isStarted && wiSteps.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
            <h2 className="text-sm font-semibold text-gray-700">Steps Preview ({wiSteps.length})</h2>
          </div>
          <ol className="divide-y divide-gray-50">
            {wiSteps.map((s) => {
              const p = s.parameters as Record<string, unknown>;
              const t = (p._step_type ?? 'custom') as StepType;
              return (
                <li key={s.id} className="flex items-center gap-3 px-5 py-3">
                  <Circle size={16} className="text-gray-300 shrink-0" />
                  <span className="text-gray-400">{STEP_ICONS[t]}</span>
                  <span className="text-sm text-gray-700">{s.name}</span>
                </li>
              );
            })}
          </ol>
        </div>
      )}

    </div>
  );
}

// ─── Schedule editor (inline on detail page) ────────────────────────────────
function ScheduleEditor({
  order, canEdit,
}: {
  order: ProductionOrder;
  canEdit: boolean;
}) {
  const qc = useQueryClient();

  /** ISO → datetime-local string */
  const isoToLocal = (iso?: string | null): string => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
           `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const localToIso = (v: string): string | null => {
    if (!v) return null;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString();
  };

  const [start, setStart] = useState<string>(isoToLocal(order.scheduled_start));
  const [end,   setEnd]   = useState<string>(isoToLocal(order.scheduled_end));
  const [flash, setFlash] = useState(false);

  // Re-sync local state if the underlying order is refetched.
  useEffect(() => {
    setStart(isoToLocal(order.scheduled_start));
    setEnd(isoToLocal(order.scheduled_end));
  }, [order.scheduled_start, order.scheduled_end]);

  const dirty =
    start !== isoToLocal(order.scheduled_start) ||
    end   !== isoToLocal(order.scheduled_end);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('production_orders')
        .update({
          scheduled_start: localToIso(start),
          scheduled_end:   localToIso(end),
        })
        .eq('id', order.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['production-order', order.id] });
      qc.invalidateQueries({ queryKey: ['production-orders'] });
      qc.invalidateQueries({ queryKey: ['gantt-orders'] });
      qc.invalidateQueries({ queryKey: ['unscheduled-orders'] });
      setFlash(true);
      setTimeout(() => setFlash(false), 1200);
    },
  });

  /** Adjust end by the same delta when start shifts, preserving duration. */
  function handleStart(newStart: string) {
    if (start && end) {
      const oldS = new Date(start).getTime();
      const oldE = new Date(end).getTime();
      const newS = new Date(newStart).getTime();
      if (!isNaN(oldS) && !isNaN(oldE) && !isNaN(newS)) {
        const dur = oldE - oldS;
        setEnd(isoToLocal(new Date(newS + dur).toISOString()));
      }
    }
    setStart(newStart);
  }

  return (
    <div className="mt-2 flex items-center gap-2 text-xs text-gray-500 flex-wrap">
      <CalendarClock size={13} className="text-gray-400" />
      <span>Scheduled</span>
      <input
        type="datetime-local"
        value={start}
        disabled={!canEdit}
        onChange={e => handleStart(e.target.value)}
        className="border border-gray-200 rounded-md px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-gray-50 disabled:text-gray-500"
      />
      <span className="text-gray-400">→</span>
      <input
        type="datetime-local"
        value={end}
        disabled={!canEdit}
        onChange={e => setEnd(e.target.value)}
        className="border border-gray-200 rounded-md px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-gray-50 disabled:text-gray-500"
      />
      {canEdit && dirty && (
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          <Check size={12} /> Save
        </button>
      )}
      {flash && <span className="text-emerald-600 font-medium">Saved</span>}
    </div>
  );
}

// ─── Assignee editor (inline on detail page) ────────────────────────────────
function AssigneeEditor({
  order, canEdit,
}: {
  order: ProductionOrder;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const [val, setVal] = useState<string>(order.assigned_to ?? '');
  const [flash, setFlash] = useState(false);

  useEffect(() => { setVal(order.assigned_to ?? ''); }, [order.assigned_to]);

  const { data: users = [] } = useQuery<Profile[]>({
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

  const dirty = val !== (order.assigned_to ?? '');

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('production_orders')
        .update({ assigned_to: val || null })
        .eq('id', order.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['production-order', order.id] });
      qc.invalidateQueries({ queryKey: ['production-orders'] });
      setFlash(true);
      setTimeout(() => setFlash(false), 1200);
    },
  });

  return (
    <div className="mt-2 flex items-center gap-2 text-xs text-gray-500 flex-wrap">
      <UserCog size={13} className="text-gray-400" />
      <span>Assigned to</span>
      <select
        value={val}
        disabled={!canEdit}
        onChange={e => setVal(e.target.value)}
        className="border border-gray-200 rounded-md px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-gray-50 disabled:text-gray-500"
      >
        <option value="">— Unassigned —</option>
        {users.map(u => (
          <option key={u.id} value={u.id}>
            {u.full_name}{u.email ? ` — ${u.email}` : ''} ({u.role})
          </option>
        ))}
      </select>
      {canEdit && dirty && (
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          <Check size={12} /> Save
        </button>
      )}
      {flash && <span className="text-emerald-600 font-medium">Saved</span>}
    </div>
  );
}

// ─── Required-by editor (inline on detail page) ─────────────────────────────
function RequiredByEditor({
  order, canEdit,
}: {
  order: ProductionOrder;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const [val, setVal] = useState<string>(order.required_by ?? '');
  const [flash, setFlash] = useState(false);

  useEffect(() => { setVal(order.required_by ?? ''); }, [order.required_by]);

  const dirty = val !== (order.required_by ?? '');

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('production_orders')
        .update({ required_by: val || null })
        .eq('id', order.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['production-order', order.id] });
      qc.invalidateQueries({ queryKey: ['production-orders'] });
      qc.invalidateQueries({ queryKey: ['unscheduled-orders'] });
      setFlash(true);
      setTimeout(() => setFlash(false), 1200);
    },
  });

  return (
    <div className="mt-1 flex items-center gap-2 text-xs text-gray-500 flex-wrap">
      <CalendarClock size={13} className="text-gray-400" />
      <span>Required by</span>
      <input
        type="date"
        value={val}
        disabled={!canEdit}
        onChange={e => setVal(e.target.value)}
        className="border border-gray-200 rounded-md px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-gray-50 disabled:text-gray-500"
      />
      {canEdit && dirty && (
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          <Check size={12} /> Save
        </button>
      )}
      {flash && <span className="text-emerald-600 font-medium">Saved</span>}
    </div>
  );
}
