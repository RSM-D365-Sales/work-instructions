import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { StepTemplate, StepType } from '../types';
import { Plus, Pencil, Trash2, FlaskConical, Scale, Timer, ArrowRightLeft, Thermometer, Snowflake, TestTube, Eye, Settings, ChevronDown, ChevronUp, Lock, Wrench, Beaker, Printer, StickyNote, Milestone, AlertTriangle, SlidersHorizontal, Paperclip } from 'lucide-react';
import type { ParameterSchema, ParameterFieldDef } from '../types';

const STEP_TYPE_META: Record<StepType, { label: string; icon: React.ReactNode; color: string }> = {
  gather_inputs:    { label: 'Gather Inputs (legacy)', icon: <FlaskConical size={16} />, color: 'bg-indigo-100 text-indigo-700' },
  gather_equipment: { label: 'Gather Equipment',       icon: <Wrench size={16} />,       color: 'bg-slate-100 text-slate-700' },
  gather_reagents:  { label: 'Gather Reagents',        icon: <Beaker size={16} />,        color: 'bg-indigo-100 text-indigo-700' },
  weigh:            { label: 'Weigh',                  icon: <Scale size={16} />,         color: 'bg-blue-100 text-blue-700' },
  mix:              { label: 'Mix',                    icon: <Timer size={16} />,         color: 'bg-cyan-100 text-cyan-700' },
  transfer:         { label: 'Transfer',               icon: <ArrowRightLeft size={16} />, color: 'bg-orange-100 text-orange-700' },
  ph_adjust:        { label: 'pH Adjust',              icon: <TestTube size={16} />,      color: 'bg-lime-100 text-lime-700' },
  heat:             { label: 'Heat',                   icon: <Thermometer size={16} />,   color: 'bg-red-100 text-red-700' },
  cool:             { label: 'Cool',                   icon: <Snowflake size={16} />,     color: 'bg-sky-100 text-sky-700' },
  observe:          { label: 'Observe & Record',       icon: <Eye size={16} />,           color: 'bg-purple-100 text-purple-700' },
  notes:            { label: 'Notes',                  icon: <StickyNote size={16} />,    color: 'bg-amber-100 text-amber-700' },
  production_break: { label: 'Production Break',       icon: <Milestone size={16} />,     color: 'bg-rose-100 text-rose-700' },
  print_labels:     { label: 'Print Labels',            icon: <Printer size={16} />,       color: 'bg-teal-100 text-teal-700' },
  attachment:       { label: 'Add Attachment',          icon: <Paperclip size={16} />,     color: 'bg-violet-100 text-violet-700' },
  possible_deviation: { label: 'Possible Deviation',    icon: <AlertTriangle size={16} />, color: 'bg-red-100 text-red-700' },
  user_defined:     { label: 'User Defined',           icon: <SlidersHorizontal size={16} />, color: 'bg-emerald-100 text-emerald-700' },
  custom:           { label: 'Custom Step',            icon: <Settings size={16} />,      color: 'bg-gray-100 text-gray-700' },
};

// ── Parameter schema reader ────────────────────────────────────────────────
function ParamSchemaTable({ schema }: { schema: ParameterSchema }) {
  const entries = Object.entries(schema);
  if (entries.length === 0) return <p className="text-xs text-gray-400 italic">No parameters defined</p>;
  return (
    <table className="w-full text-xs border-t border-gray-100 mt-2">
      <thead>
        <tr className="text-gray-400 border-b border-gray-100">
          <th className="text-left py-1.5 pr-3 font-medium">Parameter</th>
          <th className="text-left py-1.5 pr-3 font-medium">Type</th>
          <th className="text-left py-1.5 pr-3 font-medium">Default</th>
          <th className="text-left py-1.5 font-medium">Required</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-50">
        {entries.map(([key, def]) => {
          if ('items' in def) {
            // array type — show the sub-fields
            return (
              <tr key={key} className="align-top">
                <td className="py-1.5 pr-3 font-mono text-gray-700">{key}</td>
                <td className="py-1.5 pr-3 text-gray-500">array</td>
                <td className="py-1.5 pr-3 text-gray-400">—</td>
                <td className="py-1.5 text-gray-400">—</td>
              </tr>
            );
          }
          return (
            <tr key={key}>
              <td className="py-1.5 pr-3 font-mono text-gray-700">{def.label ?? key}</td>
              <td className="py-1.5 pr-3 text-gray-500">
                {def.type}
                {def.options && <span className="ml-1 text-gray-400">({(def.options as (string|number)[]).join(' | ')})</span>}
              </td>
              <td className="py-1.5 pr-3 text-gray-400">{def.default !== undefined ? String(def.default) : '—'}</td>
              <td className="py-1.5">
                {def.required ? <span className="text-blue-600 font-medium">yes</span> : <span className="text-gray-300">no</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default function StepLibraryPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<StepTemplate | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const isAdmin = profile?.role === 'admin';
  const canManage = profile?.role === 'author' || profile?.role === 'approver' || isAdmin;

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['step-templates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('step_templates')
        .select('*')
        .order('is_system', { ascending: false })
        .order('name');
      if (error) throw error;
      return data as StepTemplate[];
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('step_templates').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['step-templates'] }),
    // The DB trigger backstops the in-use check — surface its message here.
    onError: (e: unknown) => setDeleteError(e instanceof Error ? e.message : 'Delete failed.'),
  });

  /** Delete a template unless an ACTIVE work instruction (draft / pending
   *  review / approved) still uses it — in that case explain which ones. */
  async function handleDelete(t: StepTemplate) {
    setDeleteError('');
    const { data, error } = await supabase
      .from('wi_steps')
      .select('work_instructions!inner(id, title, version, status)')
      .eq('step_template_id', t.id)
      .in('work_instructions.status', ['draft', 'pending_review', 'approved']);
    if (error) { setDeleteError(error.message); return; }

    const inUse = new Map<string, { title: string; version: number; status: string }>();
    for (const row of (data ?? []) as unknown as { work_instructions: { id: string; title: string; version: number; status: string } | null }[]) {
      if (row.work_instructions) inUse.set(row.work_instructions.id, row.work_instructions);
    }
    if (inUse.size > 0) {
      const names = [...inUse.values()]
        .slice(0, 4)
        .map(w => `“${w.title}” v${w.version} (${w.status.replace('_', ' ')})`);
      setDeleteError(
        `Can't delete “${t.name}” — it is used by ${inUse.size} active work instruction${inUse.size === 1 ? '' : 's'}: ` +
        names.join(', ') + (inUse.size > 4 ? ', …' : '') +
        '. Remove the step from those work instructions (or retire them) first.'
      );
      return;
    }

    if (!confirm(`Delete “${t.name}” from the step library?`)) return;
    deleteMutation.mutate(t.id);
  }

  function openNew() { setEditing(null); setShowForm(true); }
  function openEdit(t: StepTemplate) { setEditing(t); setShowForm(true); }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Step Library</h1>
          <p className="text-sm text-gray-500 mt-1">Reusable step templates for building work instructions</p>
        </div>
        {canManage && (
          <button
            onClick={openNew}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            <Plus size={16} />
            New Template
          </button>
        )}
      </div>

      {deleteError && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 text-sm text-red-700">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span className="flex-1">{deleteError}</span>
          <button onClick={() => setDeleteError('')} className="text-xs underline opacity-70 hover:opacity-100 shrink-0">
            Dismiss
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">Loading…</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {templates.map(t => {
            const meta = STEP_TYPE_META[t.step_type];
            const expanded = expandedId === t.id;
            const paramCount = Object.keys(t.parameter_schema).length;
            return (
              <div key={t.id} className="bg-white rounded-xl border border-gray-200 flex flex-col">
                {/* Card header — always visible */}
                <div className="p-5 flex flex-col gap-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${meta.color}`}>
                        {meta.icon}
                        {meta.label}
                      </span>
                      {t.is_system && (
                        <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">System</span>
                      )}
                    </div>
                    <div className="flex gap-1">
                      {canManage && !t.is_system && (
                        <button onClick={() => openEdit(t)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors" title="Edit">
                          <Pencil size={14} />
                        </button>
                      )}
                      {/* Admins may delete any template (incl. system); authors
                          their own non-system ones. Blocked while an active WI
                          uses it — handleDelete explains which. */}
                      {(isAdmin || (canManage && !t.is_system)) && (
                        <button
                          onClick={() => handleDelete(t)}
                          disabled={deleteMutation.isPending}
                          className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 disabled:opacity-40 transition-colors"
                          title="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">{t.name}</h3>
                    {t.description && <p className="text-sm text-gray-500 mt-1">{t.description}</p>}
                  </div>
                </div>

                {/* Expand toggle */}
                <button
                  onClick={() => setExpandedId(expanded ? null : t.id)}
                  className="flex items-center justify-between px-5 py-2.5 border-t border-gray-100 text-xs text-gray-400 hover:bg-gray-50 transition-colors rounded-b-xl"
                >
                  <span className="flex items-center gap-1.5">
                    {t.is_system && <Lock size={11} />}
                    {paramCount} configurable parameter{paramCount !== 1 ? 's' : ''}
                  </span>
                  {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>

                {/* Expanded parameter detail */}
                {expanded && (
                  <div className="px-5 pb-5 border-t border-gray-100">
                    {t.is_system && (
                      <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mt-3 mb-2 flex items-center gap-1.5">
                        <Lock size={11} /> System templates are read-only. Parameters are fixed.
                      </p>
                    )}
                    <ParamSchemaTable schema={t.parameter_schema as ParameterSchema} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showForm && (
        <TemplateModal
          template={editing}
          systemTemplates={templates.filter(t => t.is_system)}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); qc.invalidateQueries({ queryKey: ['step-templates'] }); }}
        />
      )}
    </div>
  );
}

// ── Parameter builder ──────────────────────────────────────────────────────
// A local editable row that maps 1:1 to a ParameterFieldDef in parameter_schema.
interface ParamRow {
  id: string;
  label: string;
  type: ParameterFieldDef['type'];
  options: string;   // comma-separated; string/number only
  default: string;   // parsed per type on save
  required: boolean;
}

function slugifyKey(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function rowsFromSchema(schema: ParameterSchema): ParamRow[] {
  return Object.entries(schema)
    .filter((entry): entry is [string, ParameterFieldDef] => !('items' in entry[1]))
    .map(([key, def]) => ({
      id: crypto.randomUUID(),
      label: def.label ?? key,
      type: def.type,
      options: (def.options ?? []).join(', '),
      default: def.default !== undefined ? String(def.default) : '',
      required: !!def.required,
    }));
}

function schemaFromRows(rows: ParamRow[]): ParameterSchema {
  const schema: ParameterSchema = {};
  for (const row of rows) {
    const label = row.label.trim();
    if (!label) continue;
    let key = slugifyKey(label) || 'param';
    let n = 2;
    while (key in schema) key = `${slugifyKey(label)}_${n++}`;

    const def: ParameterFieldDef = { type: row.type, label };
    if (row.type !== 'boolean' && row.options.trim()) {
      const raw = row.options.split(',').map(o => o.trim()).filter(Boolean);
      const options = row.type === 'number'
        ? raw.map(o => parseFloat(o)).filter(o => !Number.isNaN(o))
        : raw;
      if (options.length > 0) def.options = options;
    }
    if (row.default.trim()) {
      if (row.type === 'number') {
        const d = parseFloat(row.default);
        if (!Number.isNaN(d)) def.default = d;
      } else if (row.type === 'boolean') {
        def.default = row.default === 'true';
      } else {
        def.default = row.default.trim();
      }
    }
    if (row.required) def.required = true;
    schema[key] = def;
  }
  return schema;
}

function TemplateModal({
  template, systemTemplates, onClose, onSaved,
}: {
  template: StepTemplate | null;
  systemTemplates: StepTemplate[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { profile } = useAuth();
  const [name, setName] = useState(template?.name ?? '');
  const [description, setDescription] = useState(template?.description ?? '');
  const [stepType, setStepType] = useState<StepType>(template?.step_type ?? 'user_defined');
  const [paramRows, setParamRows] = useState<ParamRow[]>(
    template ? rowsFromSchema(template.parameter_schema) : []
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function updateRow(id: string, patch: Partial<ParamRow>) {
    setParamRows(rows => rows.map(r => r.id === id ? { ...r, ...patch } : r));
  }

  function addRow() {
    setParamRows(rows => [...rows, { id: crypto.randomUUID(), label: '', type: 'string', options: '', default: '', required: false }]);
  }

  function resolveSchema(): ParameterSchema {
    if (stepType === 'user_defined') return schemaFromRows(paramRows);
    // Built-in type: mirror the system template's schema so the card shows real
    // parameters; keep the existing schema when the type hasn't changed on edit.
    if (template && template.step_type === stepType) return template.parameter_schema;
    return systemTemplates.find(s => s.step_type === stepType)?.parameter_schema ?? {};
  }

  async function save() {
    if (!name.trim()) { setError('Name is required'); return; }
    if (stepType === 'user_defined' && paramRows.some(r => !r.label.trim())) {
      setError('Every parameter needs a label (or remove the empty row)');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        step_type: stepType,
        parameter_schema: resolveSchema(),
        is_system: false,
        created_by: profile!.id,
      };
      let err;
      if (template) {
        ({ error: err } = await supabase.from('step_templates').update(payload).eq('id', template.id));
      } else {
        ({ error: err } = await supabase.from('step_templates').insert(payload));
      }
      if (err) throw err;
      onSaved();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          {template ? 'Edit Template' : 'New Step Template'}
        </h2>
        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. Centrifuge"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Step Type</label>
              <select
                value={stepType}
                onChange={e => setStepType(e.target.value as StepType)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="user_defined">User Defined — build your own parameters</option>
                {Object.entries(STEP_TYPE_META)
                  .filter(([type]) => type !== 'user_defined')
                  .map(([type, meta]) => (
                    <option key={type} value={type}>{meta.label}</option>
                  ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="What does this step do?"
            />
          </div>

          {stepType === 'user_defined' ? (
            <div className="border border-gray-200 rounded-xl p-4 space-y-3">
              <div>
                <p className="text-sm font-medium text-gray-700">Configurable Parameters</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  Authors fill these in when adding this step to a work instruction; operators see the values during a run.
                </p>
              </div>

              {paramRows.length > 0 && (
                <div className="grid grid-cols-[1fr_90px_1fr_90px_24px_24px] gap-2 items-center text-[11px] font-medium text-gray-400">
                  <span>Label</span><span>Type</span><span>Options</span><span>Default</span><span className="text-center">Req</span><span />
                </div>
              )}
              {paramRows.map(row => (
                <div key={row.id} className="grid grid-cols-[1fr_90px_1fr_90px_24px_24px] gap-2 items-center">
                  <input
                    value={row.label}
                    onChange={e => updateRow(row.id, { label: e.target.value })}
                    placeholder="e.g. Spin Speed (RPM)"
                    className="border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                  <select
                    value={row.type}
                    onChange={e => updateRow(row.id, { type: e.target.value as ParamRow['type'], options: '', default: '' })}
                    className="border border-gray-200 rounded px-1 py-1.5 text-xs"
                  >
                    <option value="string">text</option>
                    <option value="number">number</option>
                    <option value="boolean">yes/no</option>
                  </select>
                  {row.type !== 'boolean' ? (
                    <input
                      value={row.options}
                      onChange={e => updateRow(row.id, { options: e.target.value })}
                      placeholder="Dropdown options, comma-separated"
                      className="border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                    />
                  ) : (
                    <span className="text-xs text-gray-300 text-center">—</span>
                  )}
                  {row.type === 'boolean' ? (
                    <select
                      value={row.default}
                      onChange={e => updateRow(row.id, { default: e.target.value })}
                      className="border border-gray-200 rounded px-1 py-1.5 text-xs"
                    >
                      <option value="">—</option>
                      <option value="true">yes</option>
                      <option value="false">no</option>
                    </select>
                  ) : (
                    <input
                      value={row.default}
                      onChange={e => updateRow(row.id, { default: e.target.value })}
                      type={row.type === 'number' ? 'number' : 'text'}
                      placeholder="Default"
                      className="border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                    />
                  )}
                  <input
                    type="checkbox"
                    checked={row.required}
                    onChange={e => updateRow(row.id, { required: e.target.checked })}
                    className="justify-self-center"
                    title="Required at authoring time"
                  />
                  <button
                    onClick={() => setParamRows(rows => rows.filter(r => r.id !== row.id))}
                    className="text-gray-300 hover:text-red-500 justify-self-center"
                    title="Remove parameter"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}

              <button onClick={addRow} className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                <Plus size={12} /> Add Parameter
              </button>
            </div>
          ) : (
            <p className="text-xs text-gray-400 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
              This template reuses the built-in {STEP_TYPE_META[stepType].label} step — its parameters and
              run-time behavior come from the system. Choose “User Defined” to build your own parameter list.
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
