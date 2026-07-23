import { useState, useRef, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { StepTemplate, WIStep, WorkInstruction, StepType, ParameterSchema, ParameterFieldDef, QCTest, WIQCTest, QCResultType } from '../types';
import {
  Plus, Trash2, GripVertical, Save, Send, ChevronDown, ChevronUp, ArrowLeft,
  FlaskConical, Scale as ScaleIcon, Timer, ArrowRightLeft, Thermometer, Snowflake, TestTube, Eye, Settings,
  Wrench, Beaker, Printer, StickyNote, Milestone, AlertTriangle, SlidersHorizontal, Paperclip,
  ChevronsDownUp, ChevronsUpDown, PanelLeftClose, PanelLeftOpen,
  Droplet, Waves, ThermometerSnowflake, ThermometerSun, Moon, FlaskRound, Lock, Package, Clock,
  Calculator, Sigma, Unlock, LayoutTemplate, ClipboardCheck, DownloadCloud,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { DILUTION_VARS, type DilutionVar } from '../lib/dilution';
import { QC_PRESETS, formatSpec } from '../lib/qc';

// ─── Step type icon helper ────────────────────────────────────────────────────
const STEP_ICONS: Record<StepType, React.ReactNode> = {
  gather_inputs:    <FlaskConical size={15} />,
  gather_equipment: <Wrench size={15} />,
  gather_reagents:  <Beaker size={15} />,
  weigh:            <ScaleIcon size={15} />,
  dispense:         <Droplet size={15} />,
  dilution:         <Calculator size={15} />,
  replicate_measurement: <Sigma size={15} />,
  mix:              <Timer size={15} />,
  agitate:          <Waves size={15} />,
  transfer:         <ArrowRightLeft size={15} />,
  bring_to_volume:  <FlaskRound size={15} />,
  ph_adjust:        <TestTube size={15} />,
  heat:             <Thermometer size={15} />,
  cool:             <Snowflake size={15} />,
  freeze:           <ThermometerSnowflake size={15} />,
  thaw:             <ThermometerSun size={15} />,
  overnight:        <Moon size={15} />,
  observe:          <Eye size={15} />,
  record_time:      <Clock size={15} />,
  notes:            <StickyNote size={15} />,
  production_break: <Milestone size={15} />,
  print_labels:     <Printer size={15} />,
  cap:              <Lock size={15} />,
  package:          <Package size={15} />,
  attachment:       <Paperclip size={15} />,
  possible_deviation: <AlertTriangle size={15} />,
  user_defined:     <SlidersHorizontal size={15} />,
  custom:           <Settings size={15} />,
};

// ─── Step type grouping ───────────────────────────────────────────────────────
// 26 step types in one flat list is a lot to scan for someone authoring their
// first Work Instruction, so the pickers group them by what the operator is
// actually doing, in roughly the order a recipe runs: gather → measure →
// process → hold → record → finish.
//
// Order within a group is the order below (not alphabetical) — the common step
// leads each group. A new step type that isn't listed here still shows up, in a
// trailing "Other" group; add it to a group to place it properly.
const STEP_GROUPS: { label: string; types: StepType[] }[] = [
  { label: 'Gather & Prepare',   types: ['gather_reagents', 'gather_inputs', 'gather_equipment'] },
  { label: 'Measure & Dispense', types: ['weigh', 'dispense', 'dilution', 'bring_to_volume'] },
  { label: 'Mix & Process',      types: ['mix', 'agitate', 'transfer', 'ph_adjust'] },
  { label: 'Heat, Cool & Hold',  types: ['heat', 'cool', 'freeze', 'thaw', 'overnight', 'production_break'] },
  { label: 'Record & Document',  types: ['observe', 'replicate_measurement', 'notes', 'attachment', 'record_time', 'possible_deviation'] },
  { label: 'Finish & Label',     types: ['print_labels', 'cap', 'package'] },
  { label: 'Custom',             types: ['user_defined', 'custom'] },
];

const stepTypeLabel = (type: string) =>
  type === 'ph_adjust' ? 'pH adjust' : type.replace(/_/g, ' ');

// Templates bucketed into STEP_GROUPS order, empty groups dropped. Several
// templates can share a step_type (authors add their own), so this groups the
// library rather than the type list.
function groupTemplates(templates: StepTemplate[]) {
  const grouped = STEP_GROUPS.map(g => ({
    label: g.label,
    items: templates
      .filter(t => g.types.includes(t.step_type))
      .sort((a, b) =>
        g.types.indexOf(a.step_type) - g.types.indexOf(b.step_type) ||
        a.name.localeCompare(b.name)),
  }));
  const ungrouped = templates.filter(
    t => !STEP_GROUPS.some(g => g.types.includes(t.step_type))
  );
  if (ungrouped.length > 0) grouped.push({ label: 'Other', items: ungrouped });
  return grouped.filter(g => g.items.length > 0);
}

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

    case 'record_time':
      return (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Timestamp Label</label>
            <input
              value={(params.label as string) ?? ''}
              onChange={e => set('label', e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
              placeholder="e.g. Start time, End time, Water bath start"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Instructions (optional)</label>
            <input
              value={(params.prompt as string) ?? ''}
              onChange={e => set('prompt', e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
              placeholder="e.g. Record the time the solutions entered the 45°C water bath"
            />
          </div>
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

    case 'dispense': {
      const volUnits = ['mL','L','µL','g'];
      const hasGatheredInputs = gatheredInputs.length > 0;
      function selectMaterial(name: string) {
        const found = gatheredInputs.find(i => i.material_name === name);
        onChange({
          ...params,
          material_name: name,
          ...(found ? { target_volume: found.quantity, unit: found.unit, lot_controlled: found.lot_controlled ?? false } : {}),
        });
      }
      return (
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">Material / Solution</label>
            {hasGatheredInputs ? (
              <select
                value={(params.material_name as string) ?? ''}
                onChange={e => selectMaterial(e.target.value)}
                className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
              >
                <option value="">— Select a gathered input —</option>
                {gatheredInputs.map((inp, i) => (
                  <option key={i} value={inp.material_name}>{inp.material_name} ({inp.quantity} {inp.unit})</option>
                ))}
              </select>
            ) : (
              <input
                value={(params.material_name as string) ?? ''}
                onChange={e => set('material_name', e.target.value)}
                className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                placeholder="e.g. Methanol"
              />
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Unit</label>
            <select
              value={(params.unit as string) ?? 'mL'}
              onChange={e => set('unit', e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1 text-xs"
            >
              {volUnits.map(u => <option key={u}>{u}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Target Volume</label>
            <input
              type="number"
              value={(params.target_volume as number) ?? ''}
              onChange={e => set('target_volume', parseFloat(e.target.value))}
              className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
              placeholder="900"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Tolerance (%)</label>
            <input
              type="number"
              value={(params.tolerance_pct as number) ?? 2}
              onChange={e => set('tolerance_pct', parseFloat(e.target.value))}
              className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>
          <label className="col-span-2 inline-flex items-center gap-2 text-xs font-medium text-gray-600">
            <input
              type="checkbox"
              checked={(params.lot_controlled as boolean) ?? false}
              onChange={e => set('lot_controlled', e.target.checked)}
              className="w-3.5 h-3.5 rounded accent-blue-600"
            />
            Lot / batch controlled (operator records lot number at run time)
          </label>
        </div>
      );
    }

    case 'dilution': {
      const solveFor = (params.solve_for as DilutionVar) ?? 'V1';
      const concUnit = (params.conc_unit as string) ?? '%';
      const volUnit = (params.vol_unit as string) ?? 'L';
      const hasGathered = gatheredInputs.length > 0;
      // Pick a reagent from an earlier Gather Reagents / Gather Inputs step, or
      // free-type when none have been gathered yet.
      const reagentPicker = (key: string, placeholder: string) => hasGathered ? (
        <select
          value={(params[key] as string) ?? ''}
          onChange={e => set(key, e.target.value)}
          className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
        >
          <option value="">— Select a gathered reagent —</option>
          {gatheredInputs.map((inp, i) => (
            <option key={i} value={inp.material_name}>
              {inp.material_name}{inp.quantity ? ` (${inp.quantity} ${inp.unit})` : ''}
            </option>
          ))}
        </select>
      ) : (
        <input
          value={(params[key] as string) ?? ''}
          onChange={e => set(key, e.target.value)}
          className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
          placeholder={placeholder}
        />
      );
      return (
        <div className="space-y-3">
          <div className="bg-white border border-gray-200 rounded px-3 py-2 text-xs text-gray-600">
            <span className="font-mono font-semibold text-gray-800">C1 · V1 = C2 · V2</span>
            {' '}— the operator enters the three known values at run time; the fourth is calculated.
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Solve For</label>
              <select
                value={solveFor}
                onChange={e => set('solve_for', e.target.value)}
                className="w-full border border-gray-200 rounded px-2 py-1 text-xs"
              >
                {DILUTION_VARS.map(v => (
                  <option key={v.code} value={v.code}>{v.code} — {v.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Concentration Unit</label>
              <input
                value={concUnit}
                onChange={e => set('conc_unit', e.target.value)}
                className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                placeholder="e.g. %, M, mg/mL, X"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Volume Unit</label>
              <input
                value={volUnit}
                onChange={e => set('vol_unit', e.target.value)}
                className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                placeholder="e.g. L, mL, µL"
              />
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-600 mb-1">Preset known values (optional)</p>
            <div className="grid grid-cols-2 gap-3">
              {DILUTION_VARS.map(v => {
                const isTarget = v.code === solveFor;
                return (
                  <div key={v.key}>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      {v.code} — {v.label} <span className="text-gray-400">({v.kind === 'conc' ? concUnit : volUnit})</span>
                    </label>
                    <input
                      type="number"
                      value={isTarget ? '' : ((params[v.key] as number) ?? '')}
                      onChange={e => set(v.key, e.target.value === '' ? null : parseFloat(e.target.value))}
                      disabled={isTarget}
                      className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-gray-100 disabled:text-gray-400"
                      placeholder={isTarget ? 'Calculated at run time' : 'Optional default'}
                    />
                  </div>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Input reagent <span className="text-gray-400">(C1 · V1 stock)</span></label>
              {reagentPicker('input_name', 'e.g. 100% Methanol')}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Dilution liquid <span className="text-gray-400">(diluent)</span></label>
              {reagentPicker('diluent_name', 'e.g. CLRW water')}
            </div>
            {!hasGathered && (
              <p className="col-span-2 text-xs text-amber-600">
                Add a <strong>Gather Reagents</strong> step before this one to choose the input and dilution liquid from a list.
              </p>
            )}
          </div>
        </div>
      );
    }

    case 'replicate_measurement': {
      const mode = (params.mode as string) ?? 'simple';
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Measurement</label>
              <input
                value={(params.measurement_name as string) ?? ''}
                onChange={e => set('measurement_name', e.target.value)}
                className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                placeholder="e.g. Cell count, Absorbance, Osmolality"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Number of Replicates</label>
              <input
                type="number"
                min={1}
                value={(params.replicate_count as number) ?? 3}
                onChange={e => set('replicate_count', Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Value Type</label>
              <select
                value={mode}
                onChange={e => set('mode', e.target.value)}
                className="w-full border border-gray-200 rounded px-2 py-1 text-xs"
              >
                <option value="simple">Simple value</option>
                <option value="ratio">Ratio (numerator / denominator)</option>
              </select>
            </div>
          </div>
          {mode === 'ratio' ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Numerator Unit</label>
                <input
                  value={(params.num_unit as string) ?? ''}
                  onChange={e => set('num_unit', e.target.value)}
                  className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                  placeholder="e.g. cells"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Denominator Unit</label>
                <input
                  value={(params.den_unit as string) ?? ''}
                  onChange={e => set('den_unit', e.target.value)}
                  className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                  placeholder="e.g. mL"
                />
              </div>
              <p className="col-span-2 text-xs text-gray-400">
                Each replicate captures a numerator and denominator; the step averages the resulting
                {' '}{((params.num_unit as string) || 'x')} / {((params.den_unit as string) || 'y')} ratios.
              </p>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Unit (optional)</label>
              <input
                value={(params.unit as string) ?? ''}
                onChange={e => set('unit', e.target.value)}
                className="w-40 border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                placeholder="e.g. OD, g/L"
              />
            </div>
          )}
        </div>
      );
    }

    case 'agitate':
      return (
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Method</label>
            <select
              value={(params.method as string) ?? 'Stir'}
              onChange={e => set('method', e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1 text-xs"
            >
              {['Stir','Vortex','Invert','Shake'].map(m => <option key={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Duration (min)</label>
            <select
              value={(params.duration_minutes as number) ?? 5}
              onChange={e => set('duration_minutes', parseInt(e.target.value))}
              className="w-full border border-gray-200 rounded px-2 py-1 text-xs"
            >
              {[1, 2, 5, 10, 15, 20, 30].map(m => <option key={m} value={m}>{m} min</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Speed</label>
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

    case 'bring_to_volume': {
      const bvUnits = ['mL','L','µL'];
      return (
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">Solution</label>
            <input
              value={(params.material_name as string) ?? ''}
              onChange={e => set('material_name', e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
              placeholder="e.g. Masterclave solution"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Final Volume</label>
            <input
              type="number"
              value={(params.target_volume as number) ?? ''}
              onChange={e => set('target_volume', parseFloat(e.target.value))}
              className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
              placeholder="3"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Unit</label>
            <select
              value={(params.unit as string) ?? 'mL'}
              onChange={e => set('unit', e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1 text-xs"
            >
              {bvUnits.map(u => <option key={u}>{u}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">Diluent</label>
            <input
              value={(params.diluent as string) ?? ''}
              onChange={e => set('diluent', e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
              placeholder="e.g. CLRW water"
            />
          </div>
        </div>
      );
    }

    case 'freeze':
    case 'thaw':
      return (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Target Temp (°C)</label>
            <input
              type="number"
              value={(params.target_temp_c as number) ?? ''}
              onChange={e => set('target_temp_c', parseFloat(e.target.value))}
              className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
              placeholder={stepType === 'freeze' ? '-20' : '4'}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              {stepType === 'freeze' ? 'Duration / Until' : 'Thaw Until'}
            </label>
            <input
              value={(params[stepType === 'freeze' ? 'duration' : 'until'] as string) ?? ''}
              onChange={e => set(stepType === 'freeze' ? 'duration' : 'until', e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
              placeholder={stepType === 'freeze' ? 'e.g. overnight, ≥ 2 hours' : 'e.g. fully thawed, no ice crystals'}
            />
          </div>
          {stepType === 'thaw' && (
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Method (optional)</label>
              <input
                value={(params.method as string) ?? ''}
                onChange={e => set('method', e.target.value)}
                className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                placeholder="e.g. 2-8°C overnight, room temp, 37°C water bath"
              />
            </div>
          )}
        </div>
      );

    case 'overnight':
      return (
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">What happens overnight</label>
            <input
              value={(params.condition as string) ?? ''}
              onChange={e => set('condition', e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
              placeholder="e.g. Incubate, thaw at 2-8°C, allow to equilibrate"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Temperature (°C, optional)</label>
            <input
              type="number"
              value={(params.temp_c as number) ?? ''}
              onChange={e => set('temp_c', e.target.value === '' ? null : parseFloat(e.target.value))}
              className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
              placeholder="e.g. 4"
            />
          </div>
        </div>
      );

    case 'cap':
      return (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Method</label>
            <select
              value={(params.method as string) ?? 'Cap'}
              onChange={e => set('method', e.target.value)}
              className="w-40 border border-gray-200 rounded px-2 py-1 text-xs"
            >
              {['Cap','Screw cap','Parafilm','Seal','Stopper'].map(m => <option key={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Notes (optional)</label>
            <input
              value={(params.notes as string) ?? ''}
              onChange={e => set('notes', e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
              placeholder="e.g. Double layer of Parafilm; cap tightly"
            />
          </div>
        </div>
      );

    case 'package':
      return (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Container</label>
            <input
              value={(params.container as string) ?? ''}
              onChange={e => set('container', e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
              placeholder="e.g. 1L glass bottle, grey bin"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Label Reference</label>
            <input
              value={(params.label_ref as string) ?? ''}
              onChange={e => set('label_ref', e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
              placeholder="e.g. Label #1"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Destination</label>
            <input
              value={(params.destination as string) ?? ''}
              onChange={e => set('destination', e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
              placeholder="e.g. 2-8°C QC area"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Notes (optional)</label>
            <input
              value={(params.notes as string) ?? ''}
              onChange={e => set('notes', e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
              placeholder="Handling / storage notes"
            />
          </div>
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
  open: boolean;
  highlight: boolean;
  /** This WI is a template — show the per-step lock toggle. */
  isTemplate: boolean;
  /** This is a locked step on a child WI — read-only, inherited from the template. */
  lockedReadonly: boolean;
  gatheredInputs: { material_name: string; quantity: number; unit: string; lot_controlled?: boolean }[];
  reagentItems: { id: string; item_number: string; product_name: string; unit_of_measure: string; lot_controlled: boolean }[];
  onToggle: (localId: string) => void;
  onMove: (idx: number, dir: 1 | -1) => void;
  onRemove: (localId: string) => void;
  onChange: (localId: string, patch: Partial<WIStep & { step_type: StepType }>) => void;
  onDragStart: () => void;
  onDragEnter: () => void;
  onDragEnd: () => void;
}

function StepRow({ step, index, total, canDrag, isDragging, isDropTarget, open, highlight, isTemplate, lockedReadonly, gatheredInputs, reagentItems, onToggle, onMove, onRemove, onChange, onDragStart, onDragEnter, onDragEnd }: StepRowProps) {
  const fromGripRef = useRef(false);
  const dragOk = canDrag && !lockedReadonly;

  return (
    <div
      id={`wi-step-${step._localId}`}
      data-step-id={step._localId}
      draggable={dragOk}
      onDragStart={e => {
        if (!fromGripRef.current || !dragOk) { e.preventDefault(); return; }
        e.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragEnter={e => { e.preventDefault(); onDragEnter(); }}
      onDragOver={e => e.preventDefault()}
      onDragEnd={() => { fromGripRef.current = false; onDragEnd(); }}
      className={cn(
        'border rounded-xl overflow-hidden transition-all scroll-mt-4',
        lockedReadonly ? 'bg-amber-50/40' : 'bg-white',
        isDragging ? 'opacity-40' : isDropTarget ? 'border-blue-400 border-2' : lockedReadonly ? 'border-amber-200' : 'border-gray-200',
        highlight && 'ring-2 ring-blue-300'
      )}
    >
      <div className="flex items-center gap-2 px-4 py-3">
        <div
          className={cn('shrink-0 p-0.5 touch-none', dragOk ? 'cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600' : 'text-gray-200 pointer-events-none')}
          onPointerDown={() => { fromGripRef.current = true; }}
          onPointerUp={() => { fromGripRef.current = false; }}
        >
          <GripVertical size={16} />
        </div>
        <div
          className="flex-1 flex items-center gap-2 cursor-pointer select-none min-w-0"
          onClick={() => onToggle(step._localId)}
        >
          <span className="text-xs font-bold text-gray-400 w-5 shrink-0">{index + 1}</span>
          <span className="text-gray-500 shrink-0">{STEP_ICONS[step.step_type]}</span>
          <span className="flex-1 font-medium text-gray-800 text-sm truncate">
            {step.name || <span className="text-gray-400 italic">Untitled Step</span>}
          </span>
          {step.locked && (
            <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-100 border border-amber-200 rounded px-1.5 py-0.5">
              <Lock size={10} /> Locked
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {isTemplate && (
            <button
              onClick={e => { e.stopPropagation(); onChange(step._localId, { locked: !step.locked }); }}
              title={step.locked ? 'Locked — derived WIs cannot change this step. Click to unlock.' : 'Unlocked — derived WIs can edit this step. Click to lock.'}
              className={cn('p-1 rounded', step.locked ? 'text-amber-600 hover:bg-amber-100' : 'text-gray-300 hover:bg-gray-100 hover:text-gray-500')}
            >
              {step.locked ? <Lock size={14} /> : <Unlock size={14} />}
            </button>
          )}
          {!lockedReadonly && (
            <>
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
            </>
          )}
          <button onClick={() => onToggle(step._localId)} className="p-1 text-gray-400">
            {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {open && lockedReadonly && (
        <div className="px-4 pb-4 space-y-2 border-t border-amber-100 pt-3">
          <p className="flex items-center gap-1.5 text-xs text-amber-700">
            <Lock size={12} /> Locked by the template — fixed on this WI. Change it on the template and push the update.
          </p>
          {step.description && <p className="text-sm text-gray-600">{step.description}</p>}
          <div className="bg-white/70 border border-amber-100 rounded-lg p-3 text-xs text-gray-600 space-y-0.5">
            {Object.entries(step.parameters ?? {})
              .filter(([k]) => !k.startsWith('_'))
              .map(([k, v]) => (
                <div key={k}>
                  <span className="font-medium text-gray-500">{k.replace(/_/g, ' ')}:</span>{' '}
                  {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                </div>
              ))}
          </div>
        </div>
      )}

      {open && !lockedReadonly && (
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
                {STEP_GROUPS.map(g => {
                  // user_defined steps get their parameters from a library template,
                  // so the type is only offered when the step already has one
                  const types = g.types.filter(
                    t => t !== 'user_defined' || step.step_type === 'user_defined'
                  );
                  if (types.length === 0) return null;
                  return (
                    <optgroup key={g.label} label={g.label}>
                      {types.map(type => (
                        <option key={type} value={type}>{stepTypeLabel(type)}</option>
                      ))}
                    </optgroup>
                  );
                })}
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
      <div className="space-y-3">
        {groupTemplates(templates).map(g => (
          <div key={g.label}>
            <p className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-1.5">
              {g.label}
            </p>
            <div className="flex flex-wrap gap-2">
              {g.items.map(t => (
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
        ))}
      </div>
    </div>
  );
}

// ─── Insert-step divider between step cards ──────────────────────────────────
// Sits absolutely in the gap above a step card; hovering reveals a plus button
// that opens a template picker and inserts the new step at that position.
function InsertStepDivider({ templates, onInsert }: { templates: StepTemplate[]; onInsert: (t: StepTemplate) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="absolute inset-x-0 -top-[13px] h-3.5 z-10 group flex items-center justify-center">
      <div
        className={cn(
          'absolute inset-x-6 top-1/2 -translate-y-1/2 h-px transition-colors',
          open ? 'bg-blue-300' : 'bg-transparent group-hover:bg-blue-200'
        )}
      />
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title="Insert step here"
        className={cn(
          'relative z-10 flex items-center justify-center w-5 h-5 rounded-full border shadow-sm transition-all',
          open
            ? 'bg-blue-600 border-blue-600 text-white rotate-45'
            : 'bg-white border-gray-300 text-gray-400 opacity-0 group-hover:opacity-100 hover:border-blue-400 hover:text-blue-600'
        )}
      >
        <Plus size={12} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          {/* Wide multi-column menu: the whole library fits without scrolling on
              a normal screen. CSS columns balance the groups automatically;
              break-inside-avoid keeps a group from splitting across columns. */}
          <div className="absolute z-30 top-full left-1/2 -translate-x-1/2 mt-1.5 w-[40rem] max-w-[calc(100vw-3rem)] bg-white border border-gray-200 rounded-xl shadow-lg p-4">
            <p className="text-xs font-medium text-gray-500 mb-2.5">Insert step</p>
            <div className="columns-2 sm:columns-3 gap-4 max-h-[28rem] overflow-y-auto">
              {groupTemplates(templates).map(g => (
                <div key={g.label} className="break-inside-avoid mb-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-1">
                    {g.label}
                  </p>
                  <div className="flex flex-col gap-1">
                    {g.items.map(t => (
                      <button
                        key={t.id}
                        onClick={() => { onInsert(t); setOpen(false); }}
                        title={t.name}
                        className="flex items-center gap-1.5 w-full text-left px-2.5 py-1.5 text-xs bg-white border border-gray-200 rounded-lg hover:border-blue-400 hover:bg-blue-50 transition-colors font-medium text-gray-700"
                      >
                        <span className="shrink-0 text-gray-400">{STEP_ICONS[t.step_type]}</span>
                        <span className="truncate">{t.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Left step navigator (Word-style navigation pane) ────────────────────────
// Pinned flush against the app sidebar: negative margins swallow the page
// padding, sticky + h-screen keep it in place while the page scrolls, and the
// step list scrolls internally when it outgrows the viewport.
function StepNavPanel({
  steps, activeId, canDrag, hidden, onToggleHidden, onNavigate, onReorder,
}: {
  steps: LocalStep[];
  activeId: string | null;
  canDrag: boolean;
  hidden: boolean;
  onToggleHidden: () => void;
  onNavigate: (localId: string) => void;
  onReorder: (from: number, to: number) => void;
}) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  return (
    <nav
      className={cn(
        'hidden lg:flex flex-col sticky top-0 h-screen -my-6 -ml-6 shrink-0 bg-white border-r border-gray-200 transition-[width] duration-200',
        hidden ? 'w-11' : 'w-60'
      )}
    >
      <div
        className={cn(
          'flex items-center border-b border-gray-100 shrink-0 py-2.5',
          hidden ? 'justify-center' : 'justify-between pl-3 pr-2'
        )}
      >
        {!hidden && <p className="text-xs font-semibold text-gray-500">Step Navigator</p>}
        <button
          onClick={onToggleHidden}
          title={hidden ? 'Show step navigator' : 'Hide step navigator'}
          aria-label={hidden ? 'Show step navigator' : 'Hide step navigator'}
          className="p-1 rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
        >
          {hidden ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
        </button>
      </div>
      {hidden ? (
        steps.length > 0 && (
          <p className="mt-2 text-center text-[10px] font-semibold text-gray-400" title={`${steps.length} steps`}>
            {steps.length}
          </p>
        )
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-0.5">
          {steps.length === 0 && (
            <p className="px-2 py-3 text-xs text-gray-400 italic">No steps yet</p>
          )}
          {steps.map((s, i) => (
            <button
              key={s._localId}
              type="button"
              draggable={canDrag}
              onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; setDragIdx(i); }}
              onDragEnter={e => { e.preventDefault(); setOverIdx(i); }}
              onDragOver={e => e.preventDefault()}
              onDragEnd={() => {
                if (dragIdx !== null && overIdx !== null && dragIdx !== overIdx) onReorder(dragIdx, overIdx);
                setDragIdx(null);
                setOverIdx(null);
              }}
              onClick={() => onNavigate(s._localId)}
              title={s.name || 'Untitled Step'}
              className={cn(
                'w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-left text-xs transition-colors group',
                activeId === s._localId ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50',
                dragIdx === i && 'opacity-40',
                overIdx === i && dragIdx !== null && dragIdx !== i && 'ring-1 ring-blue-400'
              )}
            >
              {canDrag && (
                <GripVertical size={12} className="shrink-0 text-gray-300 group-hover:text-gray-400 cursor-grab" />
              )}
              <span className="w-5 shrink-0 text-right font-semibold text-gray-400">{i + 1}</span>
              <span className="shrink-0 text-gray-400 [&_svg]:w-3.5 [&_svg]:h-3.5">{STEP_ICONS[s.step_type]}</span>
              <span className="truncate font-medium">
                {s.name || <span className="italic font-normal text-gray-400">Untitled Step</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </nav>
  );
}

// ─── Quality specifications panel (captured at the end of the run) ───────────
export type QCRow = Partial<WIQCTest> & { _key: string };
let qcKeySeq = 0;
const newQcKey = () => `qc-${qcKeySeq++}`;

function WIQualitySpecs({
  rows, canEdit, itemTestCount, onUpdate, onRemove, onAddBlank, onAddPreset, onLoadFromItem,
}: {
  rows: QCRow[];
  canEdit: boolean;
  itemTestCount: number;
  onUpdate: (key: string, patch: Partial<WIQCTest>) => void;
  onRemove: (key: string) => void;
  onAddBlank: () => void;
  onAddPreset: (name: string) => void;
  onLoadFromItem: () => void;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 flex items-center gap-2 flex-wrap">
        <ClipboardCheck size={16} className="text-emerald-600" />
        <h2 className="text-sm font-semibold text-gray-700">Quality Specifications</h2>
        <span className="text-xs text-gray-400">captured at the end of the run</span>
        {canEdit && itemTestCount > 0 && (
          <button
            onClick={onLoadFromItem}
            className="ml-auto flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800"
            title="Replace the panel with the linked item's QC specs"
          >
            <DownloadCloud size={13} /> Load {itemTestCount} from item
          </button>
        )}
      </div>
      <div className="p-4 space-y-3">
        <p className="text-xs text-gray-500">
          These default from the reagent item's QC panel but can differ for this Work Instruction. Limits judge
          pass/fail during production and print on the Certificate of Analysis.
        </p>
        {rows.length === 0 ? (
          <div className="text-center py-6 bg-gray-50 rounded-lg border border-dashed border-gray-200 text-gray-500 text-sm">
            {itemTestCount > 0
              ? 'No QC specs yet — load them from the item, or add your own.'
              : 'No QC specs yet. Add tests below (or link a product with a QC panel to default from).'}
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
                {rows.map(r => {
                  const isQual = r.result_type === 'text' || r.result_type === 'passfail';
                  return (
                    <tr key={r._key}>
                      <td className="py-1.5 pr-2">
                        <input value={r.name ?? ''} disabled={!canEdit}
                          onChange={e => onUpdate(r._key, { name: e.target.value })} placeholder="e.g. pH"
                          className="w-32 border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-gray-50" />
                      </td>
                      <td className="py-1.5 px-2">
                        <select value={r.result_type ?? 'numeric'} disabled={!canEdit}
                          onChange={e => onUpdate(r._key, { result_type: e.target.value as QCResultType })}
                          className="border border-gray-200 rounded px-1.5 py-1 text-sm bg-white disabled:bg-gray-50">
                          <option value="numeric">numeric</option>
                          <option value="text">text</option>
                          <option value="passfail">pass/fail</option>
                        </select>
                      </td>
                      <td className="py-1.5 px-2">
                        <input type="number" step="any" value={r.lower_limit ?? ''} disabled={!canEdit || isQual}
                          onChange={e => onUpdate(r._key, { lower_limit: e.target.value === '' ? null : parseFloat(e.target.value) })}
                          className="w-20 border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-gray-50" />
                      </td>
                      <td className="py-1.5 px-2">
                        <input type="number" step="any" value={r.upper_limit ?? ''} disabled={!canEdit || isQual}
                          onChange={e => onUpdate(r._key, { upper_limit: e.target.value === '' ? null : parseFloat(e.target.value) })}
                          className="w-20 border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-gray-50" />
                      </td>
                      <td className="py-1.5 px-2">
                        <input value={r.unit ?? ''} disabled={!canEdit || isQual}
                          onChange={e => onUpdate(r._key, { unit: e.target.value })} placeholder="mOsm/kg"
                          className="w-24 border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-gray-50" />
                      </td>
                      <td className="py-1.5 px-2">
                        <input value={r.expected_text ?? ''} disabled={!canEdit || !isQual}
                          onChange={e => onUpdate(r._key, { expected_text: e.target.value })} placeholder="Clear, colorless"
                          className="w-36 border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-gray-50" />
                      </td>
                      <td className="py-1.5 px-2">
                        <input value={r.method ?? ''} disabled={!canEdit}
                          onChange={e => onUpdate(r._key, { method: e.target.value })} placeholder="USP <791>"
                          className="w-28 border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-gray-50" />
                      </td>
                      <td className="py-1.5 pl-2 text-right">
                        {canEdit && (
                          <button onClick={() => onRemove(r._key)} className="text-gray-300 hover:text-red-600"><Trash2 size={14} /></button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button onClick={onAddBlank} className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-700">
              <Plus size={14} /> Add test
            </button>
            <select value="" onChange={e => { if (e.target.value) onAddPreset(e.target.value); e.target.value = ''; }}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white text-gray-600">
              <option value="">+ Add from common tests…</option>
              {QC_PRESETS.map(p => (
                <option key={p.name} value={p.name}>{p.name}{p.unit ? ` (${p.unit})` : ''} — {formatSpec(p)}</option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
type LocalStep = Partial<WIStep> & { _localId: string; step_type: StepType };

const STEP_NAV_HIDDEN_KEY = 'wi-step-nav-hidden';

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
  const [isTemplate, setIsTemplate] = useState(false);
  // Child lineage — set when this WI was generated from a template (read-only).
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [templateVersion, setTemplateVersion] = useState<number | null>(null);
  const [showProductDropdown, setShowProductDropdown] = useState(false);
  const productInputRef = useRef<HTMLInputElement>(null);
  const [targetMolarity, setTargetMolarity] = useState('');
  const [scheduledMinutes, setScheduledMinutes] = useState('');
  const [steps, setSteps] = useState<LocalStep[]>([]);
  // QC spec panel — null until the author touches it; falls back to the saved
  // panel (existing WI) or an item default (see auto-seed effect below).
  const [qcRows, setQcRows] = useState<QCRow[] | null>(null);
  const qcAutoSeededRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragIndexRef = useRef<number | null>(null);
  const hoverIndexRef = useRef<number | null>(null);
  const headerLoadedRef = useRef(false);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [flashId, setFlashId] = useState<string | null>(null);
  const [activeStepId, setActiveStepId] = useState<string | null>(null);
  const [navHidden, setNavHidden] = useState(() => localStorage.getItem(STEP_NAV_HIDDEN_KEY) === '1');
  const flashTimerRef = useRef<number | null>(null);
  // Step order as ids, kept in a ref so the scroll-spy observer can read the
  // current order without being torn down on every keystroke.
  const stepOrderRef = useRef<string[]>([]);
  stepOrderRef.current = steps.map(s => s._localId);

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
    setProductName(wiData.product_name ?? '');
    setProductSearch(wiData.product_name ?? '');
    setReagentItemId(wiData.reagent_item_id ?? null);
    setIsTemplate(wiData.is_template ?? false);
    setTemplateId(wiData.template_id ?? null);
    setTemplateVersion(wiData.template_version ?? null);
    setTargetMolarity(wiData.target_molarity?.toString() ?? '');
    setScheduledMinutes(wiData.scheduled_minutes != null ? String(wiData.scheduled_minutes) : '');
    const sorted = [...(wiData.wi_steps ?? [])].sort((a: any, b: any) => a.step_order - b.step_order);
    setSteps(sorted.map((s: WIStep) => ({ ...s, _localId: s.id, step_type: (s.parameters as any)?._step_type ?? 'custom' as StepType })));
  }, [wiData]);

  // For a child WI, look up its template so the banner can name/link it.
  const { data: parentTemplate } = useQuery({
    queryKey: ['wi-template-parent', templateId],
    enabled: !!templateId,
    queryFn: async () => {
      const { data } = await supabase
        .from('work_instructions').select('id, title, version').eq('id', templateId!).single();
      return data as { id: string; title: string; version: number } | null;
    },
  });

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

  // Template flags. A WI generated from a template is a "child"; only real
  // drafts (not children, not approved) can be toggled into/out of a template.
  const isChild = !!templateId;
  const canToggleTemplate = !!canEdit && !isChild &&
    (isNew || wiData?.status === 'draft' || wiData?.status === 'rejected');

  // ── QC spec panel ──────────────────────────────────────────────────────────
  // The WI's own saved QC panel (existing WIs).
  const { data: wiQcData } = useQuery<WIQCTest[]>({
    queryKey: ['wi-qc-tests', id],
    enabled: !isNew,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('wi_qc_tests').select('*').eq('work_instruction_id', id!).order('test_order');
      if (error) throw error;
      return data as WIQCTest[];
    },
  });
  // The linked item's QC panel — the source these default from.
  const { data: itemQcTests = [] } = useQuery<QCTest[]>({
    queryKey: ['item-qc-tests', reagentItemId],
    enabled: !!reagentItemId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('qc_tests').select('*').eq('reagent_item_id', reagentItemId!).eq('is_active', true).order('test_order');
      if (error) throw error;
      return data as QCTest[];
    },
  });

  const specFromItem = (t: QCTest): QCRow => ({
    _key: newQcKey(), source_qc_test_id: t.id, name: t.name, unit: t.unit,
    result_type: t.result_type, lower_limit: t.lower_limit, upper_limit: t.upper_limit,
    target: t.target, expected_text: t.expected_text, method: t.method, is_active: true,
  });

  // Displayed rows: author edits (qcRows) → saved WI panel → empty.
  const qcDisplayRows: QCRow[] = qcRows ?? (wiQcData ?? []).map(t => ({ ...t, _key: t.id }));

  // Default from the item once, when the WI has no panel of its own yet.
  useEffect(() => {
    if (qcAutoSeededRef.current || qcRows !== null || !canEdit) return;
    if ((wiQcData ?? []).length > 0) { qcAutoSeededRef.current = true; return; }
    if (!reagentItemId || itemQcTests.length === 0) return;
    setQcRows(itemQcTests.map(specFromItem));
    qcAutoSeededRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wiQcData, itemQcTests, reagentItemId, canEdit, qcRows]);

  const qcUpdate = (key: string, patch: Partial<WIQCTest>) =>
    setQcRows(qcDisplayRows.map(r => r._key === key ? { ...r, ...patch } : r));
  const qcRemove = (key: string) => setQcRows(qcDisplayRows.filter(r => r._key !== key));
  const qcAddBlank = () => setQcRows([...qcDisplayRows, { _key: newQcKey(), name: '', unit: '', result_type: 'numeric', is_active: true }]);
  const qcAddPreset = (name: string) => {
    const p = QC_PRESETS.find(x => x.name === name);
    if (!p) return;
    setQcRows([...qcDisplayRows, {
      _key: newQcKey(), name: p.name, unit: p.unit, result_type: p.result_type,
      lower_limit: p.lower_limit ?? null, upper_limit: p.upper_limit ?? null,
      expected_text: p.expected_text ?? null, method: p.method ?? null, is_active: true,
    }]);
  };
  const qcLoadFromItem = () => setQcRows(itemQcTests.map(specFromItem));

  // Scroll-spy: highlight in the nav pane whichever step card is crossing the
  // upper part of the viewport. Re-observes only when steps are added/removed
  // or reordered (id list changes), not on every field edit.
  const stepIdsKey = steps.map(s => s._localId).join('|');
  useEffect(() => {
    const visible = new Set<string>();
    const observer = new IntersectionObserver(entries => {
      for (const e of entries) {
        const stepId = (e.target as HTMLElement).dataset.stepId;
        if (!stepId) continue;
        if (e.isIntersecting) visible.add(stepId); else visible.delete(stepId);
      }
      const first = stepOrderRef.current.find(sid => visible.has(sid));
      if (first) setActiveStepId(first);
    }, { rootMargin: '-10% 0px -55% 0px' });
    document.querySelectorAll<HTMLElement>('[data-step-id]').forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, [stepIdsKey]);

  function navigateToStep(localId: string) {
    // Expand the target so the nav actually lands on its content.
    setCollapsedIds(prev => {
      if (!prev.has(localId)) return prev;
      const next = new Set(prev);
      next.delete(localId);
      return next;
    });
    document.getElementById(`wi-step-${localId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveStepId(localId);
    setFlashId(localId);
    if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => setFlashId(null), 1600);
  }

  function toggleStepOpen(localId: string) {
    setCollapsedIds(prev => {
      const next = new Set(prev);
      if (next.has(localId)) next.delete(localId); else next.add(localId);
      return next;
    });
  }

  const collapseAll = () => setCollapsedIds(new Set(steps.map(s => s._localId)));
  const expandAll = () => setCollapsedIds(new Set());

  const toggleNavHidden = () =>
    setNavHidden(prev => {
      localStorage.setItem(STEP_NAV_HIDDEN_KEY, prev ? '0' : '1');
      return !prev;
    });

  function addStepFromTemplate(t: StepTemplate, atIndex?: number) {
    const localId = crypto.randomUUID();
    const newStep: LocalStep = {
      _localId: localId,
      name: t.name,
      description: t.description ?? '',
      step_type: t.step_type,
      step_template_id: t.id,
      parameters: t.step_type === 'user_defined'
        ? userDefinedDefaults(t.parameter_schema)
        : getDefaultParams(t.step_type),
    };
    setSteps(prev => {
      const next = [...prev];
      next.splice(atIndex ?? next.length, 0, newStep);
      return next;
    });
    // When inserting mid-list, bring the new card into view once it renders.
    if (atIndex !== undefined) {
      window.setTimeout(() => navigateToStep(localId), 60);
    }
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
      case 'dispense': return { material_name: '', target_volume: 0, unit: 'mL', tolerance_pct: 2, lot_controlled: false };
      case 'dilution': return { solve_for: 'V1', conc_unit: '%', vol_unit: 'L', input_name: '', diluent_name: '' };
      case 'replicate_measurement': return { measurement_name: '', replicate_count: 3, mode: 'simple', unit: '', num_unit: 'cells', den_unit: 'mL' };
      case 'mix': return { duration_minutes: 10, speed: 'medium' };
      case 'agitate': return { method: 'Stir', duration_minutes: 5, speed: 'medium' };
      case 'bring_to_volume': return { material_name: '', target_volume: 0, unit: 'mL', diluent: '' };
      case 'heat': return { target_temp_c: 80, duration_minutes: 15 };
      case 'cool': return { target_temp_c: 20 };
      case 'freeze': return { target_temp_c: -20, duration: '' };
      case 'thaw': return { target_temp_c: 4, method: '', until: '' };
      case 'overnight': return { condition: '', temp_c: null };
      case 'cap': return { method: 'Cap', notes: '' };
      case 'package': return { container: '', label_ref: '', destination: '', notes: '' };
      case 'ph_adjust': return { target_ph: 7, tolerance: 0.1, reagent: '' };
      case 'observe': return { prompt: '' };
      case 'record_time': return { label: 'Time', prompt: '' };
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

  function reorderSteps(from: number, to: number) {
    if (from === to) return;
    setSteps(prev => {
      if (from < 0 || from >= prev.length || to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
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
      if (!title.trim()) throw new Error('Title is required');
      if (!isTemplate && !productName.trim()) throw new Error('Product name is required (or mark this a Template)');

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
        // Templates carry no product link.
        product_name: isTemplate ? null : finalProductName,
        reagent_item_id: isTemplate ? null : (reagentItemId ?? null),
        is_template: isTemplate,
        template_id: templateId,
        template_version: templateVersion,
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
          locked: s.locked ?? false,
          parameters: { ...s.parameters, _step_type: s.step_type },
        }));
        const { error } = await supabase.from('wi_steps').insert(stepsPayload);
        if (error) throw error;
      }

      // Save the QC spec panel: update kept rows, insert new, delete removed —
      // preserving ids so historical qc_results keep their link.
      if (isNew || wiQcData !== undefined) {
        const current = (qcRows ?? (wiQcData ?? []).map(t => ({ ...t, _key: t.id })))
          .filter(r => (r.name ?? '').toString().trim());
        const existingQc = wiQcData ?? [];
        const keptIds = new Set(current.filter(r => r.id).map(r => r.id as string));
        const toDelete = existingQc.filter(t => !keptIds.has(t.id)).map(t => t.id);
        if (toDelete.length) {
          const { error } = await supabase.from('wi_qc_tests').delete().in('id', toDelete);
          if (error) throw error;
        }
        for (let i = 0; i < current.length; i++) {
          const r = current[i];
          const isQual = r.result_type === 'text' || r.result_type === 'passfail';
          const qcPayload = {
            work_instruction_id: wiId!,
            source_qc_test_id: r.source_qc_test_id ?? null,
            test_order: i,
            name: (r.name ?? '').toString().trim(),
            unit: r.unit?.toString().trim() || null,
            result_type: r.result_type ?? 'numeric',
            lower_limit: isQual ? null : (r.lower_limit ?? null),
            upper_limit: isQual ? null : (r.upper_limit ?? null),
            target: isQual ? null : (r.target ?? null),
            expected_text: isQual ? (r.expected_text?.toString().trim() || null) : null,
            method: r.method?.toString().trim() || null,
            is_active: r.is_active ?? true,
          };
          if (r.id) {
            const { error } = await supabase.from('wi_qc_tests').update(qcPayload).eq('id', r.id);
            if (error) throw error;
          } else {
            const { error } = await supabase.from('wi_qc_tests').insert({ ...qcPayload, created_by: profile!.id });
            if (error) throw error;
          }
        }
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
      qc.invalidateQueries({ queryKey: ['wi-qc-tests', wiId] });
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
    <div className="flex items-start gap-6">
      {/* Word-style step navigator, pinned beside the app sidebar */}
      <StepNavPanel
        steps={steps}
        activeId={activeStepId}
        canDrag={!!canEdit}
        hidden={navHidden}
        onToggleHidden={toggleNavHidden}
        onNavigate={navigateToStep}
        onReorder={reorderSteps}
      />

      <div className="flex-1 min-w-0 max-w-3xl mx-auto space-y-6">
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

      {/* Generated-from-template banner (child WI) */}
      {isChild && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900 flex items-center gap-2">
          <LayoutTemplate size={16} className="shrink-0 text-indigo-500" />
          <span>
            Generated from template{' '}
            <Link to={`/work-instructions/${templateId}`} className="font-semibold underline hover:text-indigo-700">
              {parentTemplate?.title ?? 'template'}
            </Link>
            {templateVersion != null && <span className="text-indigo-500"> (v{templateVersion})</span>}. Locked steps are read-only here.
          </span>
        </div>
      )}

      {/* Template banner */}
      {isTemplate && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900 flex items-center gap-2">
          <LayoutTemplate size={16} className="shrink-0 text-indigo-500" />
          <span>This is a <strong>template</strong> — no product link. Mark steps <Lock size={12} className="inline -mt-0.5 text-amber-600" /> locked to fix them on every derived Work Instruction.</span>
        </div>
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

          {/* Template toggle — only on real drafts (not children, not approved) */}
          {(canToggleTemplate || isTemplate) && (
            <div className="col-span-2">
              <label className={cn('inline-flex items-center gap-2 text-sm font-medium', canToggleTemplate ? 'text-gray-700 cursor-pointer' : 'text-gray-400')}>
                <input
                  type="checkbox"
                  checked={isTemplate}
                  disabled={!canToggleTemplate}
                  onChange={e => {
                    const on = e.target.checked;
                    setIsTemplate(on);
                    if (on) { setReagentItemId(null); setProductName(''); setProductSearch(''); }
                  }}
                  className="w-4 h-4 rounded accent-indigo-600"
                />
                <LayoutTemplate size={15} className="text-indigo-500" />
                This is a Template (reusable, not linked to a product)
              </label>
            </div>
          )}

          {!isTemplate && (
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
          )}
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
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">
            Steps ({steps.length})
          </h2>
          {steps.length > 0 && (
            <div className="flex items-center gap-1">
              <button
                onClick={expandAll}
                className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-md transition-colors"
                title="Expand all steps"
              >
                <ChevronsUpDown size={13} /> Expand all
              </button>
              <button
                onClick={collapseAll}
                className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-md transition-colors"
                title="Collapse all steps"
              >
                <ChevronsDownUp size={13} /> Collapse all
              </button>
            </div>
          )}
        </div>

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
            <div key={s._localId} className="relative">
              {canEdit && (
                <InsertStepDivider
                  templates={templates}
                  onInsert={t => addStepFromTemplate(t, i)}
                />
              )}
              <StepRow
                step={s}
                index={i}
                total={steps.length}
                canDrag={!!canEdit}
                isTemplate={isTemplate}
                lockedReadonly={isChild && !!s.locked}
                isDragging={draggingId === s._localId}
                isDropTarget={dragOverIndex === i && draggingId !== null && draggingId !== s._localId}
                open={!collapsedIds.has(s._localId)}
                highlight={flashId === s._localId}
                gatheredInputs={gatheredInputs}
                reagentItems={reagentItems}
                onToggle={toggleStepOpen}
                onMove={moveStep}
                onRemove={removeStep}
                onChange={updateStep}
                onDragStart={() => { dragIndexRef.current = i; setDraggingId(s._localId); }}
                onDragEnter={() => { hoverIndexRef.current = i; setDragOverIndex(i); }}
                onDragEnd={() => {
                  const from = dragIndexRef.current;
                  const to = hoverIndexRef.current;
                  if (from !== null && to !== null) reorderSteps(from, to);
                  dragIndexRef.current = null;
                  hoverIndexRef.current = null;
                  setDraggingId(null);
                  setDragOverIndex(null);
                }}
              />
            </div>
          );
        })}

        {canEdit && (
          <AddStepPanel templates={templates} onAdd={addStepFromTemplate} />
        )}
      </div>

      {/* Quality specifications — captured at the end of the run */}
      {!isTemplate && (
        <WIQualitySpecs
          rows={qcDisplayRows}
          canEdit={!!canEdit}
          itemTestCount={itemQcTests.length}
          onUpdate={qcUpdate}
          onRemove={qcRemove}
          onAddBlank={qcAddBlank}
          onAddPreset={qcAddPreset}
          onLoadFromItem={qcLoadFromItem}
        />
      )}

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
    </div>
  );
}
