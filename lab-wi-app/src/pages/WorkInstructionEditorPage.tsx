import { useState, useRef, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { StepTemplate, WIStep, WorkInstruction, StepType, ParameterSchema, ParameterFieldDef } from '../types';
import {
  Plus, Trash2, GripVertical, Save, Send, ChevronDown, ChevronUp, ArrowLeft,
  FlaskConical, Scale as ScaleIcon, Timer, ArrowRightLeft, Thermometer, Snowflake, TestTube, Eye, Settings,
  Wrench, Beaker, Printer, StickyNote, Milestone, AlertTriangle, SlidersHorizontal, Paperclip,
} from 'lucide-react';
import { cn } from '../lib/utils';

// ─── Step type icon helper ────────────────────────────────────────────────────
const STEP_ICONS: Record<StepType, React.ReactNode> = {
  gather_inputs:    <FlaskConical size={15} />,
  gather_equipment: <Wrench size={15} />,
  gather_reagents:  <Beaker size={15} />,
  weigh:            <ScaleIcon size={15} />,
  mix:              <Timer size={15} />,
  transfer:         <ArrowRightLeft size={15} />,
  ph_adjust:        <TestTube size={15} />,
  heat:             <Thermometer size={15} />,
  cool:             <Snowflake size={15} />,
  observe:          <Eye size={15} />,
  notes:            <StickyNote size={15} />,
  production_break: <Milestone size={15} />,
  print_labels:     <Printer size={15} />,
  attachment:       <Paperclip size={15} />,
  possible_deviation: <AlertTriangle size={15} />,
  user_defined:     <SlidersHorizontal size={15} />,
  custom:           <Settings size={15} />,
};

// ─── Generic editor for user-defined templates ───────────────────────────────
// Renders authoring inputs from the parameter schema snapshotted into the step
// (parameters._param_schema) when it was added from the library.
function UserDefinedParamEditor({
  params, onChange,
}: {
  params: Record<string, unknown>;
  onChange: (p: Record<string, unknown>) => void;
}) {
  const schema = (params._param_schema ?? {}) as ParameterSchema;
  const fields = Object.entries(schema).filter(
    (entry): entry is [string, ParameterFieldDef] => !('items' in entry[1])
  );
  if (fields.length === 0) {
    return <p className="text-xs text-gray-400 italic">This template has no configurable parameters.</p>;
  }

  function set(key: string, value: unknown) {
    onChange({ ...params, [key]: value });
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      {fields.map(([key, def]) => (
        <div key={key} className={def.type === 'string' && !def.options ? 'col-span-2' : ''}>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            {def.label}
            {def.required && <span className="text-red-500 ml-0.5">*</span>}
          </label>
          {def.type === 'boolean' ? (
            <label className="flex items-center gap-2 py-1">
              <input
                type="checkbox"
                checked={(params[key] as boolean) ?? (def.default as boolean) ?? false}
                onChange={e => set(key, e.target.checked)}
              />
              <span className="text-xs text-gray-500">Yes</span>
            </label>
          ) : def.options && def.options.length > 0 ? (
            <select
              value={String(params[key] ?? def.default ?? '')}
              onChange={e => set(key, def.type === 'number' ? parseFloat(e.target.value) : e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1 text-xs"
            >
              <option value="">— Select —</option>
              {def.options.map(o => <option key={String(o)} value={String(o)}>{String(o)}</option>)}
            </select>
          ) : def.type === 'number' ? (
            <input
              type="number"
              value={(params[key] as number) ?? (def.default as number) ?? ''}
              onChange={e => set(key, e.target.value === '' ? null : parseFloat(e.target.value))}
              className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          ) : (
            <input
              value={(params[key] as string) ?? (def.default as string) ?? ''}
              onChange={e => set(key, e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Parameter editors per step type ─────────────────────────────────────────
function StepParamEditor({
  stepType,
  params,
  onChange,
  gatheredInputs = [],
  reagentItems = [],
}: {
  stepType: StepType;
  params: Record<string, unknown>;
  onChange: (p: Record<string, unknown>) => void;
  gatheredInputs?: { material_name: string; quantity: number; unit: string; lot_controlled?: boolean }[];
  reagentItems?: { id: string; item_number: string; product_name: string; unit_of_measure: string; lot_controlled: boolean }[];
}) {
  function set(key: string, value: unknown) {
    onChange({ ...params, [key]: value });
  }

  switch (stepType) {
    case 'gather_inputs': {
      const inputs: { material_name: string; quantity: number; unit: string }[] =
        Array.isArray(params.inputs) ? (params.inputs as any[]) : [];
      return (
        <div className="space-y-2">
          <label className="text-xs font-medium text-gray-600">Inputs to Gather</label>
          {inputs.map((inp, i) => (
            <div key={i} className="flex gap-2 items-center">
              <input
                value={inp.material_name}
                onChange={e => {
                  const next = [...inputs]; next[i] = { ...next[i], material_name: e.target.value };
                  set('inputs', next);
                }}
                placeholder="Material name"
                className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
              <input
                type="number"
                value={inp.quantity}
                onChange={e => {
                  const next = [...inputs]; next[i] = { ...next[i], quantity: parseFloat(e.target.value) };
                  set('inputs', next);
                }}
                placeholder="Qty"
                className="w-20 border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
              <select
                value={inp.unit}
                onChange={e => {
                  const next = [...inputs]; next[i] = { ...next[i], unit: e.target.value };
                  set('inputs', next);
                }}
                className="w-16 border border-gray-200 rounded px-1 py-1 text-xs"
              >
                {['g','kg','mg','mL','L','mol','ea','tube'].map(u => <option key={u}>{u}</option>)}
              </select>
              <button onClick={() => set('inputs', inputs.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          <button
            onClick={() => set('inputs', [...inputs, { material_name: '', quantity: 0, unit: 'g' }])}
            className="text-xs text-blue-600 hover:underline flex items-center gap-1"
          >
            <Plus size={12} /> Add Input
          </button>
        </div>
      );
    }

    case 'gather_equipment': {
      const equipment: { name: string; notes: string }[] =
        Array.isArray(params.equipment) ? (params.equipment as any[]) : [];
      return (
        <div className="space-y-2">
          <label className="text-xs font-medium text-gray-600">Equipment to Gather</label>
          {equipment.map((item, i) => (
            <div key={i} className="flex gap-2 items-center">
              <input
                value={item.name}
                onChange={e => {
                  const next = [...equipment]; next[i] = { ...next[i], name: e.target.value };
                  set('equipment', next);
                }}
                placeholder="Equipment name"
                className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
              <input
                value={item.notes}
                onChange={e => {
                  const next = [...equipment]; next[i] = { ...next[i], notes: e.target.value };
                  set('equipment', next);
                }}
                placeholder="Notes (optional)"
                className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
              <button onClick={() => set('equipment', equipment.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          <button
            onClick={() => set('equipment', [...equipment, { name: '', notes: '' }])}
            className="text-xs text-blue-600 hover:underline flex items-center gap-1"
          >
            <Plus size={12} /> Add Equipment
          </button>
        </div>
      );
    }

    case 'gather_reagents': {
      const reagents: { item_id: string; item_number: string; product_name: string; quantity: number; unit: string; lot_controlled?: boolean }[] =
        Array.isArray(params.reagents) ? (params.reagents as any[]) : [];
      return (
        <div className="space-y-2">
          <label className="text-xs font-medium text-gray-600">Reagents to Gather</label>
          {reagents.map((row, i) => (
            <div key={i} className="flex gap-2 items-center">
              <select
                value={row.item_id}
                onChange={e => {
                  const found = reagentItems.find(r => r.id === e.target.value);
                  const next = [...reagents];
                  next[i] = {
                    ...next[i],
                    item_id: e.target.value,
                    item_number: found?.item_number ?? '',
                    product_name: found?.product_name ?? '',
                    unit: found?.unit_of_measure ?? next[i].unit,
                    lot_controlled: found?.lot_controlled ?? false,
                  };
                  set('reagents', next);
                }}
                className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
              >
                <option value="">— select reagent —</option>
                {reagentItems.map(r => (
                  <option key={r.id} value={r.id}>{r.item_number} — {r.product_name}{r.lot_controlled ? ' [LOT]' : ''}</option>
                ))}
              </select>
              <input
                type="number"
                value={row.quantity}
                onChange={e => {
                  const next = [...reagents]; next[i] = { ...next[i], quantity: parseFloat(e.target.value) };
                  set('reagents', next);
                }}
                placeholder="Qty"
                className="w-20 border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
              <select
                value={row.unit}
                onChange={e => {
                  const next = [...reagents]; next[i] = { ...next[i], unit: e.target.value };
                  set('reagents', next);
                }}
                className="w-16 border border-gray-200 rounded px-1 py-1 text-xs"
              >
                {['g','kg','mg','mL','L','mol','ea','tube'].map(u => <option key={u}>{u}</option>)}
              </select>
              {row.lot_controlled && (
                <span title="Lot/batch number will be required at execution" className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-teal-100 text-teal-700 uppercase tracking-wide shrink-0">LOT</span>
              )}
              <button onClick={() => set('reagents', reagents.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          {reagentItems.length === 0 && (
            <p className="text-xs text-amber-600">No reagent items in catalog. Sync from D365 first.</p>
          )}
          <button
            onClick={() => set('reagents', [...reagents, { item_id: '', item_number: '', product_name: '', quantity: 0, unit: 'g', lot_controlled: false }])}
            className="text-xs text-blue-600 hover:underline flex items-center gap-1"
          >
            <Plus size={12} /> Add Reagent
          </button>
        </div>
      );
    }

    case 'weigh': {
      const weighUnits = ['g','kg','mg','mL','L','ea','tube'];
      const hasGatheredInputs = gatheredInputs.length > 0;
      function selectMaterial(name: string) {
        const found = gatheredInputs.find(i => i.material_name === name);
        onChange({
          ...params,
          material_name: name,
          ...(found ? { target_weight: found.quantity, unit: found.unit, lot_controlled: found.lot_controlled ?? false } : {}),
        });
      }
      return (
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">Material Name</label>
            {hasGatheredInputs ? (
              <select
                value={(params.material_name as string) ?? ''}
                onChange={e => selectMaterial(e.target.value)}
                className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
              >
                <option value="">— Select a gathered input —</option>
                {gatheredInputs.map((inp, i) => (
                  <option key={i} value={inp.material_name}>
                    {inp.material_name} ({inp.quantity} {inp.unit})
                  </option>
                ))}
              </select>
            ) : (
              <>
                <input
                  value={(params.material_name as string) ?? ''}
                  onChange={e => set('material_name', e.target.value)}
                  className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                  placeholder="e.g. NaOH"
                />
                <p className="text-xs text-amber-600 mt-1">Add a Gather Inputs step first to select from a list</p>
              </>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Unit</label>
            <select
              value={(params.unit as string) ?? 'g'}
              onChange={e => set('unit', e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1 text-xs"
            >
              {weighUnits.map(u => <option key={u}>{u}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Target Weight</label>
            <input
              type="number"
              value={(params.target_weight as number) ?? ''}
              onChange={e => set('target_weight', parseFloat(e.target.value))}
              className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
              placeholder="40.0"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">Tolerance (%)</label>
            <input
              type="number"
              value={(params.tolerance_pct as number) ?? 2}
              onChange={e => set('tolerance_pct', parseFloat(e.target.value))}
              className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
              placeholder="2"
            />
          </div>
        </div>
      );
    }

    case 'mix':
      return (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Duration (minutes)</label>
            <select
              value={(params.duration_minutes as number) ?? 10}
              onChange={e => set('duration_minutes', parseInt(e.target.value))}
              className="w-full border border-gray-200 rounded px-2 py-1 text-xs"
            >
              {[5, 10, 15, 20, 30, 45, 60].map(m => (
                <option key={m} value={m}>{m} min</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Mix Speed</label>
            <select
              value={(params.speed as string) ?? 'medium'}
              onChange={e => set('speed', e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1 text-xs"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
        </div>
      );

    case 'heat':
    case 'cool':
      return (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Target Temp (°C)</label>
            <input
              type="number"
              value={(params.target_temp_c as number) ?? ''}
              onChange={e => set('target_temp_c', parseFloat(e.target.value))}
              className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>
          {stepType === 'heat' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Duration (min)</label>
              <input
                type="number"
                value={(params.duration_minutes as number) ?? ''}
                onChange={e => set('duration_minutes', parseInt(e.target.value))}
                className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
          )}
        </div>
      );

    case 'ph_adjust':
      return (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Target pH</label>
            <input
              type="number"
              step="0.1"
              value={(params.target_ph as number) ?? ''}
              onChange={e => set('target_ph', parseFloat(e.target.value))}
              className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Tolerance (±pH)</label>
            <input
              type="number"
              step="0.05"
              value={(params.tolerance as number) ?? 0.1}
              onChange={e => set('tolerance', parseFloat(e.target.value))}
              className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">Adjusting Reagent</label>
            <input
              value={(params.reagent as string) ?? ''}
              onChange={e => set('reagent', e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
              placeholder="e.g. 1M HCl or 1M NaOH"
            />
          </div>
        </div>
      );

    case 'observe':
      return (
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Observation Prompt</label>
          <input
            value={(params.prompt as string) ?? ''}
            onChange={e => set('prompt', e.target.value)}
            className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
            placeholder="e.g. Describe the color and clarity of the solution"
          />
        </div>
      );

    case 'notes':
      return (
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Notes Prompt (optional)</label>
          <input
            value={(params.prompt as string) ?? ''}
            onChange={e => set('prompt', e.target.value)}
            className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
            placeholder="e.g. Capture any notes about the order so far"
          />
        </div>
      );

    case 'production_break':
      return (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Next Part Label</label>
            <input
              value={(params.label as string) ?? ''}
              onChange={e => set('label', e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
              placeholder="e.g. Part 2 — Fill tubes with buffer"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Description (optional)</label>
            <input
              value={(params.description as string) ?? ''}
              onChange={e => set('description', e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
              placeholder="What separates this part from the previous one"
            />
          </div>
        </div>
      );

    case 'possible_deviation': {
      const units = ['g','kg','mg','mL','L','mol','ea','tube','%'];
      return (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Deviation Prompt (optional)</label>
            <input
              value={(params.prompt as string) ?? ''}
              onChange={e => set('prompt', e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
              placeholder="e.g. Flag if colour, clarity or yield looks off-spec"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Impacted Quantity Unit</label>
            <select
              value={(params.unit as string) ?? 'L'}
              onChange={e => set('unit', e.target.value)}
              className="w-28 border border-gray-200 rounded px-2 py-1 text-xs"
            >
              {units.map(u => <option key={u}>{u}</option>)}
            </select>
          </div>
          <p className="text-xs text-gray-400">
            At run time the operator records the impacted quantity and can notify the supervisor via Teams.
          </p>
        </div>
      );
    }

    case 'transfer':
      return (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
            <input
              value={(params.from_vessel as string) ?? ''}
              onChange={e => set('from_vessel', e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
              placeholder="e.g. Beaker A or Lab Bench"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
            <input
              value={(params.to_vessel as string) ?? ''}
              onChange={e => set('to_vessel', e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
              placeholder="e.g. Volumetric Flask or QC area"
            />
          </div>
        </div>
      );

    case 'print_labels':
      return (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Label Template</label>
            <input
              value={(params.label_template as string) ?? ''}
              onChange={e => set('label_template', e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
              placeholder="e.g. Product Label, Container ID"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Quantity</label>
            <input
              type="number"
              value={(params.quantity as number) ?? 1}
              onChange={e => set('quantity', parseInt(e.target.value))}
              className="w-24 border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
              min={1}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Notes (optional)</label>
            <input
              value={(params.notes as string) ?? ''}
              onChange={e => set('notes', e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
              placeholder="Any special instructions for printing"
            />
          </div>
        </div>
      );

    case 'attachment':
      return (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Attachment Prompt</label>
            <input
              value={(params.prompt as string) ?? ''}
              onChange={e => set('prompt', e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
              placeholder="e.g. Attach the balance printout and CoA scan"
            />
          </div>
          <label className="inline-flex items-center gap-2 text-xs font-medium text-gray-600">
            <input
              type="checkbox"
              checked={(params.required as boolean) ?? true}
              onChange={e => set('required', e.target.checked)}
              className="w-3.5 h-3.5 rounded accent-blue-600"
            />
            At least one attachment is required to complete the step
          </label>
        </div>
      );

    case 'user_defined':
      return <UserDefinedParamEditor params={params} onChange={onChange} />;

    default:
      return (
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Instruction Text</label>
          <textarea
            rows={2}
            value={(params.instruction_text as string) ?? ''}
            onChange={e => set('instruction_text', e.target.value)}
            className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
            placeholder="Describe what the operator should do"
          />
        </div>
      );
  }
}

// ─── Single step row in the editor ───────────────────────────────────────────
interface StepRowProps {
  step: Partial<WIStep> & { _localId: string; step_type: StepType };
  index: number;
  total: number;
  canDrag: boolean;
  isDragging: boolean;
  isDropTarget: boolean;
  gatheredInputs: { material_name: string; quantity: number; unit: string; lot_controlled?: boolean }[];
  reagentItems: { id: string; item_number: string; product_name: string; unit_of_measure: string; lot_controlled: boolean }[];
  onMove: (idx: number, dir: 1 | -1) => void;
  onRemove: (localId: string) => void;
  onChange: (localId: string, patch: Partial<WIStep & { step_type: StepType }>) => void;
  onDragStart: () => void;
  onDragEnter: () => void;
  onDragEnd: () => void;
}

function StepRow({ step, index, total, canDrag, isDragging, isDropTarget, gatheredInputs, reagentItems, onMove, onRemove, onChange, onDragStart, onDragEnter, onDragEnd }: StepRowProps) {
  const [open, setOpen] = useState(true);
  const fromGripRef = useRef(false);

  return (
    <div
      draggable={canDrag}
      onDragStart={e => {
        if (!fromGripRef.current) { e.preventDefault(); return; }
        e.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragEnter={e => { e.preventDefault(); onDragEnter(); }}
      onDragOver={e => e.preventDefault()}
      onDragEnd={() => { fromGripRef.current = false; onDragEnd(); }}
      className={cn(
        'border rounded-xl bg-white overflow-hidden transition-all',
        isDragging ? 'opacity-40' : isDropTarget ? 'border-blue-400 border-2' : 'border-gray-200'
      )}
    >
      <div className="flex items-center gap-2 px-4 py-3">
        <div
          className={cn('shrink-0 p-0.5 touch-none', canDrag ? 'cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600' : 'text-gray-200 pointer-events-none')}
          onPointerDown={() => { fromGripRef.current = true; }}
          onPointerUp={() => { fromGripRef.current = false; }}
        >
          <GripVertical size={16} />
        </div>
        <div
          className="flex-1 flex items-center gap-2 cursor-pointer select-none min-w-0"
          onClick={() => setOpen(o => !o)}
        >
          <span className="text-xs font-bold text-gray-400 w-5 shrink-0">{index + 1}</span>
          <span className="text-gray-500 shrink-0">{STEP_ICONS[step.step_type]}</span>
          <span className="flex-1 font-medium text-gray-800 text-sm truncate">
            {step.name || <span className="text-gray-400 italic">Untitled Step</span>}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={e => { e.stopPropagation(); onMove(index, -1); }}
            disabled={index === 0}
            className="p-1 rounded hover:bg-gray-100 disabled:opacity-30"
          >
            <ChevronUp size={14} />
          </button>
          <button
            onClick={e => { e.stopPropagation(); onMove(index, 1); }}
            disabled={index === total - 1}
            className="p-1 rounded hover:bg-gray-100 disabled:opacity-30"
          >
            <ChevronDown size={14} />
          </button>
          <button
            onClick={e => { e.stopPropagation(); onRemove(step._localId); }}
            className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500"
          >
            <Trash2 size={14} />
          </button>
          <button onClick={() => setOpen(o => !o)} className="p-1 text-gray-400">
            {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-gray-100 pt-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Step Name</label>
              <input
                value={step.name ?? ''}
                onChange={e => onChange(step._localId, { name: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                placeholder="Step name"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Step Type</label>
              <select
                value={step.step_type}
                onChange={e => onChange(step._localId, { step_type: e.target.value as StepType, parameters: {} })}
                className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                {Object.entries(STEP_ICONS)
                  // user_defined steps get their parameters from a library template,
                  // so the type is only offered when the step already has one
                  .filter(([type]) => type !== 'user_defined' || step.step_type === 'user_defined')
                  .map(([type]) => (
                    <option key={type} value={type}>
                      {type === 'ph_adjust' ? 'pH adjust' : type.replace('_', ' ')}
                    </option>
                  ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Description (optional)</label>
            <input
              value={step.description ?? ''}
              onChange={e => onChange(step._localId, { description: e.target.value })}
              className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder="Additional instructions for the operator"
            />
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <StepParamEditor
              stepType={step.step_type}
              params={step.parameters ?? {}}
              onChange={p => onChange(step._localId, { parameters: p })}
              gatheredInputs={gatheredInputs}
              reagentItems={reagentItems}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Add Step from library panel ─────────────────────────────────────────────
function AddStepPanel({ templates, onAdd }: { templates: StepTemplate[]; onAdd: (t: StepTemplate) => void }) {
  return (
    <div className="border border-dashed border-gray-300 rounded-xl p-4">
      <p className="text-xs font-medium text-gray-500 mb-3">Add from library</p>
      <div className="flex flex-wrap gap-2">
        {templates.map(t => (
          <button
            key={t.id}
            onClick={() => onAdd(t)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-white border border-gray-200 rounded-lg hover:border-blue-400 hover:bg-blue-50 transition-colors font-medium text-gray-700"
          >
            {STEP_ICONS[t.step_type]}
            {t.name}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
type LocalStep = Partial<WIStep> & { _localId: string; step_type: StepType };

export default function WorkInstructionEditorPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { profile } = useAuth();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [productName, setProductName] = useState('');
  const [reagentItemId, setReagentItemId] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState('');
  const [showProductDropdown, setShowProductDropdown] = useState(false);
  const productInputRef = useRef<HTMLInputElement>(null);
  const [targetMolarity, setTargetMolarity] = useState('');
  const [scheduledMinutes, setScheduledMinutes] = useState('');
  const [steps, setSteps] = useState<LocalStep[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragIndexRef = useRef<number | null>(null);
  const hoverIndexRef = useRef<number | null>(null);
  const headerLoadedRef = useRef(false);

  const { data: wiData } = useQuery<WorkInstruction & { wi_steps: WIStep[] }>({
    queryKey: ['work-instruction', id],
    enabled: !isNew,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('work_instructions')
        .select('*, wi_steps(*)')
        .eq('id', id!)
        .single();
      if (error) throw error;
      return data as WorkInstruction & { wi_steps: WIStep[] };
    },
  });

  useEffect(() => {
    if (!wiData || headerLoadedRef.current) return;
    headerLoadedRef.current = true;
    setTitle(wiData.title);
    setDescription(wiData.description ?? '');
    setProductName(wiData.product_name);
    setProductSearch(wiData.product_name);
    setReagentItemId(wiData.reagent_item_id ?? null);
    setTargetMolarity(wiData.target_molarity?.toString() ?? '');
    setScheduledMinutes(wiData.scheduled_minutes != null ? String(wiData.scheduled_minutes) : '');
    const sorted = [...(wiData.wi_steps ?? [])].sort((a: any, b: any) => a.step_order - b.step_order);
    setSteps(sorted.map((s: WIStep) => ({ ...s, _localId: s.id, step_type: (s.parameters as any)?._step_type ?? 'custom' as StepType })));
  }, [wiData]);

  const { data: templates = [] } = useQuery({
    queryKey: ['step-templates'],
    queryFn: async () => {
      const { data } = await supabase.from('step_templates').select('*').order('is_system', { ascending: false }).order('name');
      return (data ?? []) as StepTemplate[];
    },
  });

  const { data: reagentItems = [] } = useQuery({
    queryKey: ['reagent-items-active'],
    queryFn: async () => {
      const { data } = await supabase
        .from('reagent_items')
        .select('id, item_number, product_name, unit_of_measure, lot_controlled')
        .eq('is_active', true)
        .order('product_name');
      return (data ?? []) as { id: string; item_number: string; product_name: string; unit_of_measure: string; lot_controlled: boolean }[];
    },
  });

  const isAdmin = profile?.role === 'admin';
  const canEdit = isNew || isAdmin || (wiData && (wiData.status === 'draft' || wiData.status === 'rejected') && wiData.created_by === profile?.id);

  // The reagent item this WI is currently linked to (drives the item-number display).
  const linkedItem = reagentItems.find(r => r.id === reagentItemId) ?? null;

  function addStepFromTemplate(t: StepTemplate) {
    const localId = crypto.randomUUID();
    setSteps(prev => [...prev, {
      _localId: localId,
      name: t.name,
      description: t.description ?? '',
      step_type: t.step_type,
      step_template_id: t.id,
      parameters: t.step_type === 'user_defined'
        ? userDefinedDefaults(t.parameter_schema)
        : getDefaultParams(t.step_type),
    }]);
  }

  // Snapshot the template's schema into the step (like _step_type) so the
  // editor, detail, and execution pages can render it without re-fetching the
  // template — and so later template edits don't change existing WIs.
  function userDefinedDefaults(schema: ParameterSchema): Record<string, unknown> {
    const params: Record<string, unknown> = { _param_schema: schema };
    for (const [key, def] of Object.entries(schema)) {
      if (!('items' in def) && def.default !== undefined) params[key] = def.default;
    }
    return params;
  }

  function getDefaultParams(type: StepType): Record<string, unknown> {
    switch (type) {
      case 'gather_inputs': return { inputs: [] };
      case 'gather_equipment': return { equipment: [] };
      case 'gather_reagents': return { reagents: [] };
      case 'print_labels': return { label_template: '', quantity: 1, notes: '' };
      case 'attachment': return { prompt: '', required: true };
      case 'weigh': return { material_name: '', target_weight: 0, unit: 'g', tolerance_pct: 2 };
      case 'mix': return { duration_minutes: 10, speed: 'medium' };
      case 'heat': return { target_temp_c: 80, duration_minutes: 15 };
      case 'cool': return { target_temp_c: 20 };
      case 'ph_adjust': return { target_ph: 7, tolerance: 0.1, reagent: '' };
      case 'observe': return { prompt: '' };
      case 'notes': return { prompt: '' };
      case 'production_break': return { label: '', description: '' };
      case 'possible_deviation': return { prompt: '', unit: 'L' };
      case 'transfer': return { from_vessel: '', to_vessel: '' };
      default: return { instruction_text: '' };
    }
  }

  function moveStep(idx: number, dir: 1 | -1) {
    setSteps(prev => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }

  function removeStep(localId: string) {
    setSteps(prev => prev.filter(s => s._localId !== localId));
  }

  function updateStep(localId: string, patch: Partial<LocalStep>) {
    setSteps(prev => prev.map(s => s._localId === localId ? { ...s, ...patch } : s));
  }

  // Resolve typed text to a reagent item: an exact item-number match (unique) wins,
  // otherwise an unambiguous exact product-name match. Returns null if none/ambiguous.
  function resolveReagentItem(text: string) {
    const t = text.trim().toLowerCase();
    if (!t) return null;
    const byNumber = reagentItems.find(r => r.item_number.toLowerCase() === t);
    if (byNumber) return byNumber;
    const byName = reagentItems.filter(r => r.product_name.toLowerCase() === t);
    return byName.length === 1 ? byName[0] : null;
  }

  const submitMutation = useMutation({
    mutationFn: async (submitForReview: boolean) => {
      if (!title.trim() || !productName.trim()) throw new Error('Title and product name are required');

      // If linked, keep the name in sync with the item master — covers the case
      // where the user typed an item number and saved before it normalized to the name.
      const linked = reagentItems.find(r => r.id === reagentItemId) ?? null;
      const finalProductName =
        linked && productName.trim().toLowerCase() === linked.item_number.toLowerCase()
          ? linked.product_name
          : productName.trim();

      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        product_name: finalProductName,
        reagent_item_id: reagentItemId ?? null,
        target_molarity: targetMolarity ? parseFloat(targetMolarity) : null,
        scheduled_minutes: scheduledMinutes ? Math.max(1, Math.round(parseFloat(scheduledMinutes))) : null,
        status: isNew ? 'draft' : (submitForReview ? 'pending_review' : (wiData?.status ?? 'draft')),
        created_by: profile!.id,
      };

      let wiId = id;
      if (isNew) {
        const { data, error } = await supabase.from('work_instructions').insert(payload).select().single();
        if (error) throw error;
        wiId = data.id;
      } else {
        const { error } = await supabase.from('work_instructions').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', id!);
        if (error) throw error;
        // Delete existing steps to re-insert in order
        await supabase.from('wi_steps').delete().eq('work_instruction_id', id!);
      }

      // Insert steps
      if (steps.length > 0) {
        const stepsPayload = steps.map((s, i) => ({
          work_instruction_id: wiId!,
          step_template_id: s.step_template_id ?? null,
          // Steps are deleted + reinserted on save; carry the lineage token
          // (or seed it from the old row's id) so the version diff can match
          // this step across versions even if it is later renamed.
          source_step_id: s.source_step_id ?? s.id ?? null,
          step_order: i + 1,
          name: s.name || 'Unnamed Step',
          description: s.description || null,
          parameters: { ...s.parameters, _step_type: s.step_type },
        }));
        const { error } = await supabase.from('wi_steps').insert(stepsPayload);
        if (error) throw error;
      }

      if (submitForReview && !isNew) {
        await supabase.from('wi_approvals').insert({
          work_instruction_id: wiId!,
          reviewer_id: profile!.id,
          action: 'submitted',
          comment: 'Submitted for review',
        });
      }

      return wiId;
    },
    onSuccess: (wiId) => {
      qc.invalidateQueries({ queryKey: ['work-instructions'] });
      qc.invalidateQueries({ queryKey: ['work-instruction', wiId] });
      navigate(`/work-instructions/${wiId}`);
    },
  });

  async function handleSave(submitForReview = false) {
    setSaving(true);
    setError('');
    try {
      await submitMutation.mutateAsync(submitForReview);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed');
      console.error('Save error:', e);
    } finally {
      setSaving(false);
    }
  }

  const isDraft = isNew || wiData?.status === 'draft' || wiData?.status === 'rejected';

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/work-instructions')} className="text-gray-400 hover:text-gray-700 transition-colors">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-xl font-bold text-gray-900 flex-1">
          {isNew ? 'New Work Instruction' : title || 'Edit Work Instruction'}
        </h1>
        {canEdit && (
          <div className="flex gap-2">
            <button
              onClick={() => handleSave(false)}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <Save size={15} />
              Save Draft
            </button>
            {!isNew && (
              <button
                onClick={() => handleSave(true)}
                disabled={saving || !isDraft}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                <Send size={15} />
                Submit for Review
              </button>
            )}
            {isNew && (
              <button
                onClick={() => handleSave(false)}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                <Save size={15} />
                Create
              </button>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
      )}

      {/* Header fields */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700">Work Instruction Details</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              disabled={!canEdit}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              placeholder="e.g. Prepare 1M Sodium Hydroxide Solution"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Product *</label>
            {canEdit ? (
              <div className="relative">
                <input
                  ref={productInputRef}
                  value={productSearch}
                  onChange={e => {
                    const v = e.target.value;
                    setProductSearch(v);
                    setProductName(v);
                    // Auto-link as soon as the text uniquely matches an item (name or item #).
                    setReagentItemId(resolveReagentItem(v)?.id ?? null);
                    setShowProductDropdown(true);
                  }}
                  onFocus={() => setShowProductDropdown(true)}
                  onBlur={() => setTimeout(() => {
                    setShowProductDropdown(false);
                    // On blur, snap a matched entry to the canonical product name so the
                    // name and the linked item id always agree (e.g. typing "FG401" → "P24110").
                    const match = resolveReagentItem(productSearch);
                    if (match) {
                      setReagentItemId(match.id);
                      setProductName(match.product_name);
                      setProductSearch(match.product_name);
                    }
                  }, 150)}
                  disabled={!canEdit}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Search reagent items or type a product name…"
                />
                {linkedItem && (
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-green-700 font-medium bg-green-50 rounded px-1.5 py-0.5">
                    <span className="font-mono">{linkedItem.item_number}</span> · linked
                  </span>
                )}
                {showProductDropdown && productSearch.trim() && (
                  <ul className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto text-sm">
                    {reagentItems
                      .filter(r =>
                        r.product_name.toLowerCase().includes(productSearch.toLowerCase()) ||
                        r.item_number.toLowerCase().includes(productSearch.toLowerCase())
                      )
                      .slice(0, 20)
                      .map(r => (
                        <li
                          key={r.id}
                          onMouseDown={() => {
                            setProductName(r.product_name);
                            setProductSearch(r.product_name);
                            setReagentItemId(r.id);
                            setShowProductDropdown(false);
                          }}
                          className="flex items-center justify-between px-3 py-2 hover:bg-blue-50 cursor-pointer"
                        >
                          <span>{r.product_name}</span>
                          <span className="text-gray-400 text-xs ml-2 shrink-0">{r.item_number} · {r.unit_of_measure}</span>
                        </li>
                      ))}
                    {reagentItems.filter(r =>
                      r.product_name.toLowerCase().includes(productSearch.toLowerCase()) ||
                      r.item_number.toLowerCase().includes(productSearch.toLowerCase())
                    ).length === 0 && (
                      <li className="px-3 py-2 text-gray-400 italic">No matching items — name will be saved as typed</li>
                    )}
                  </ul>
                )}
                {!linkedItem && productName.trim() && (
                  <p className="mt-1 text-xs text-amber-600">
                    Not linked to an item-master record — D365 production orders for this product won't match. Pick an item from the list to link it.
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-800 py-2">
                {productName}
                {linkedItem && <span className="ml-2 font-mono text-xs text-gray-500">{linkedItem.item_number}</span>}
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Target Molarity (M)</label>
            <input
              type="number"
              step="0.001"
              value={targetMolarity}
              onChange={e => setTargetMolarity(e.target.value)}
              disabled={!canEdit}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              placeholder="e.g. 1.0"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Scheduled Time (minutes)</label>
            <input
              type="number"
              min="1"
              step="1"
              value={scheduledMinutes}
              onChange={e => setScheduledMinutes(e.target.value)}
              disabled={!canEdit}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              placeholder="e.g. 90"
            />
            <p className="text-xs text-gray-400 mt-1">Expected duration of one production run. Blocks this much time on the schedule.</p>
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={2}
              disabled={!canEdit}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              placeholder="Overview of this work instruction"
            />
          </div>
        </div>
      </div>

      {/* Steps editor */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-700">
          Steps ({steps.length})
        </h2>

        {steps.length === 0 && (
          <div className="text-center py-8 bg-white rounded-xl border border-gray-200 text-sm text-gray-400">
            No steps yet — add from the library below
          </div>
        )}

        {steps.map((s, i) => {
          const gatheredInputs = steps
            .filter(x => x.step_type === 'gather_inputs' || x.step_type === 'gather_reagents')
            .flatMap(x => {
              if (x.step_type === 'gather_inputs') {
                return (x.parameters?.inputs as { material_name: string; quantity: number; unit: string }[]) ?? [];
              }
              // gather_reagents rows → map to same shape for weigh step selector
              return ((x.parameters?.reagents as { product_name: string; quantity: number; unit: string; lot_controlled?: boolean }[]) ?? [])
                .map(r => ({ material_name: r.product_name, quantity: r.quantity, unit: r.unit, lot_controlled: r.lot_controlled ?? false }));
            })
            .filter(x => x.material_name?.trim());
          return (
            <StepRow
              key={s._localId}
              step={s}
              index={i}
              total={steps.length}
              canDrag={!!canEdit}
              isDragging={draggingId === s._localId}
              isDropTarget={dragOverIndex === i && draggingId !== null && draggingId !== s._localId}
              gatheredInputs={gatheredInputs}
              reagentItems={reagentItems}
              onMove={moveStep}
              onRemove={removeStep}
              onChange={updateStep}
              onDragStart={() => { dragIndexRef.current = i; setDraggingId(s._localId); }}
              onDragEnter={() => { hoverIndexRef.current = i; setDragOverIndex(i); }}
              onDragEnd={() => {
                const from = dragIndexRef.current;
                const to = hoverIndexRef.current;
                if (from !== null && to !== null && from !== to) {
                  setSteps(prev => {
                    const next = [...prev];
                    const [moved] = next.splice(from, 1);
                    next.splice(to, 0, moved);
                    return next;
                  });
                }
                dragIndexRef.current = null;
                hoverIndexRef.current = null;
                setDraggingId(null);
                setDragOverIndex(null);
              }}
            />
          );
        })}

        {canEdit && (
          <AddStepPanel templates={templates} onAdd={addStepFromTemplate} />
        )}
      </div>

      {canEdit && (
        <div className="flex justify-end gap-2 pb-8">
          <button
            onClick={() => handleSave(false)}
            disabled={saving}
            className={cn(
              'flex items-center gap-2 px-5 py-2 text-sm rounded-lg font-medium disabled:opacity-50',
              isNew
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'border border-gray-300 text-gray-700 hover:bg-gray-50'
            )}
          >
            <Save size={15} />
            {isNew ? 'Create Work Instruction' : 'Save Draft'}
          </button>
          {!isNew && isDraft && (
            <button
              onClick={() => handleSave(true)}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2 text-sm bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              <Send size={15} />
              Submit for Review
            </button>
          )}
        </div>
      )}
    </div>
  );
}
