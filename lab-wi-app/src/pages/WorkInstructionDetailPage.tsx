import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { WorkInstruction, WIStep, WIApproval, StepType, ParameterSchema, ReagentItem } from '../types';
import {
  ArrowLeft, Pencil, CheckCircle, XCircle, RotateCcw, PlayCircle, GitBranch, GitCompare,
  FlaskConical, Scale, Timer, ArrowRightLeft, Thermometer, Snowflake, TestTube, Eye, Settings, Trash2,
  Wrench, Beaker, Printer, StickyNote, Milestone, AlertTriangle, ChevronRight, SlidersHorizontal, Paperclip,
  Copy, X, Search,
  Droplet, Waves, ThermometerSnowflake, ThermometerSun, Moon, FlaskRound, Lock, Package, Clock,
  Calculator, Sigma, LayoutTemplate, RefreshCw, FilePlus,
} from 'lucide-react';
import { formatDate, cn, wiLineageKey } from '../lib/utils';
import StepNavPanel, { type StepNavItem } from '../components/StepNavPanel';

const STEP_ICONS: Record<StepType, React.ReactNode> = {
  gather_inputs:    <FlaskConical size={15} />,
  gather_equipment: <Wrench size={15} />,
  gather_reagents:  <Beaker size={15} />,
  weigh:            <Scale size={15} />,
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
  record_time:      <Clock size={15} />,
  observe:       <Eye size={15} />,  print_labels:     <Printer size={15} />,  custom:        <Settings size={15} />,
  cap:              <Lock size={15} />,
  package:          <Package size={15} />,
  attachment:       <Paperclip size={15} />,
  notes:            <StickyNote size={15} />,
  production_break: <Milestone size={15} />,
  possible_deviation: <AlertTriangle size={15} />,
  user_defined:     <SlidersHorizontal size={15} />,
};

const STATUS_STYLES: Record<string, string> = {
  draft:          'bg-gray-100 text-gray-600',
  pending_review: 'bg-yellow-100 text-yellow-700',
  approved:       'bg-green-100 text-green-700',
  rejected:       'bg-red-100 text-red-700',
};

function stepSummary(step: WIStep): string {
  const p = step.parameters as Record<string, unknown>;
  const type = (p._step_type ?? 'custom') as StepType;
  switch (type) {
    case 'weigh':
      return `Target: ${p.target_weight} ${p.unit} ± ${p.tolerance_pct}%`;
    case 'dispense':
      return `Dispense ${p.material_name ? `${p.material_name} — ` : ''}${p.target_volume} ${p.unit} ± ${p.tolerance_pct}%`;
    case 'dilution':
      return `Dilution (C1·V1 = C2·V2) — solve for ${p.solve_for ?? 'V1'}${p.input_name ? ` · ${p.input_name}` : ''}${p.diluent_name ? ` with ${p.diluent_name}` : ''}`;
    case 'replicate_measurement': {
      const unitLabel = (p.mode === 'ratio')
        ? `${(p.num_unit as string) || 'x'}/${(p.den_unit as string) || 'y'}`
        : ((p.unit as string) || '');
      return `Average of ${p.replicate_count ?? 3} readings${p.measurement_name ? ` of ${p.measurement_name}` : ''}${unitLabel ? ` (${unitLabel})` : ''}`;
    }
    case 'mix':
      return `Mix for ${p.duration_minutes} min at ${p.speed} speed`;
    case 'agitate':
      return `${p.method ?? 'Stir'} for ${p.duration_minutes} min at ${p.speed} speed`;
    case 'heat':
      return `Heat to ${p.target_temp_c}°C for ${p.duration_minutes} min`;
    case 'cool':
      return `Cool to ${p.target_temp_c}°C`;
    case 'freeze':
      return `Freeze to ${p.target_temp_c}°C${p.duration ? ` — ${p.duration}` : ''}`;
    case 'thaw':
      return `Thaw to ${p.target_temp_c}°C${p.method ? ` (${p.method})` : ''}`;
    case 'overnight':
      return `Overnight: ${p.condition || 'hold'}${p.temp_c != null ? ` at ${p.temp_c}°C` : ''}`;
    case 'bring_to_volume':
      return `Bring ${p.material_name ? `${p.material_name} ` : ''}to ${p.target_volume} ${p.unit}${p.diluent ? ` with ${p.diluent}` : ''}`;
    case 'ph_adjust':
      return `Target pH ${p.target_ph} ± ${p.tolerance} using ${p.reagent}`;
    case 'observe':
      return p.prompt as string ?? '';
    case 'record_time':
      return `Record timestamp: ${p.label || 'Time'}`;
    case 'transfer':
      return `From ${p.from_vessel} to ${p.to_vessel}`;
    case 'cap':
      return `${p.method ?? 'Cap'}${p.notes ? ` — ${p.notes}` : ''}`;
    case 'package':
      return `${p.container || 'Package'}${p.destination ? ` → ${p.destination}` : ''}${p.label_ref ? ` (${p.label_ref})` : ''}`;
    case 'gather_inputs': {
      const inputs = p.inputs as { material_name: string; quantity: number; unit: string }[] ?? [];
      return inputs.map(i => `${i.material_name} ${i.quantity} ${i.unit}`).join(', ');
    }
    case 'gather_equipment': {
      const equipment = p.equipment as { name: string }[] ?? [];
      return equipment.map(e => e.name).join(', ');
    }
    case 'gather_reagents': {
      const reagents = p.reagents as { product_name: string; quantity: number; unit: string }[] ?? [];
      return reagents.map(r => `${r.product_name} ${r.quantity} ${r.unit}`).join(', ');
    }
    case 'print_labels':
      return `${p.label_template ?? 'Labels'} × ${p.quantity ?? 1}${p.notes ? ` — ${p.notes}` : ''}`;
    case 'attachment':
      return `${(p.prompt as string)?.trim() || 'Attach supporting documents'}${(p.required ?? true) ? ' (required)' : ' (optional)'}`;
    case 'possible_deviation':
      return (p.prompt as string)?.trim()
        ? (p.prompt as string)
        : `Capture impacted quantity${p.unit ? ` (${p.unit})` : ''} and notify supervisor`;
    case 'user_defined': {
      const schema = (p._param_schema ?? {}) as ParameterSchema;
      return Object.entries(schema)
        .filter(([key, def]) => !('items' in def) && p[key] !== undefined && p[key] !== null && p[key] !== '')
        .map(([key, def]) => {
          const v = p[key];
          const display = !('items' in def) && def.type === 'boolean' ? (v ? 'Yes' : 'No') : String(v);
          return `${def.label ?? key}: ${display}`;
        })
        .join(', ');
    }
    default:
      return (p.instruction_text as string) ?? '';
  }
}

export default function WorkInstructionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { profile } = useAuth();
  const [approvalComment, setApprovalComment] = useState('');
  const [approvalLoading, setApprovalLoading] = useState(false);
  const [approvalError, setApprovalError] = useState('');
  const [newVersionLoading, setNewVersionLoading] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [copyModalOpen, setCopyModalOpen] = useState(false);
  const [newFromTemplateOpen, setNewFromTemplateOpen] = useState(false);
  const [propagateOpen, setPropagateOpen] = useState(false);

  const { data: wi, isLoading } = useQuery<WorkInstruction>({
    queryKey: ['work-instruction-detail', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('work_instructions')
        .select('*, creator:profiles!created_by(full_name, role)')
        .eq('id', id!)
        .single();
      if (error) throw error;
      return data as WorkInstruction;
    },
  });

  const { data: steps = [] } = useQuery<WIStep[]>({
    queryKey: ['wi-steps-detail', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('wi_steps')
        .select('*')
        .eq('work_instruction_id', id!)
        .order('step_order');
      if (error) throw error;
      return data as WIStep[];
    },
  });

  const { data: approvals = [] } = useQuery<WIApproval[]>({
    queryKey: ['wi-approvals', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('wi_approvals')
        .select('*, reviewer:profiles!reviewer_id(full_name)')
        .eq('work_instruction_id', id!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as WIApproval[];
    },
  });

  // All versions in this WI's lineage (same item link + title), newest first.
  // Matched by title in SQL, then filtered to the exact lineage client-side so
  // it stays consistent with the list page's collapsing rule.
  const { data: versions = [] } = useQuery<WorkInstruction[]>({
    queryKey: ['wi-versions', wi?.title, wi?.reagent_item_id, wi?.product_name],
    enabled: !!wi,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('work_instructions')
        .select('*, creator:profiles!created_by(full_name)')
        .eq('title', wi!.title)
        .order('version', { ascending: false });
      if (error) throw error;
      const key = wiLineageKey(wi!);
      return (data as WorkInstruction[]).filter(v => wiLineageKey(v) === key);
    },
  });

  // Every version id in this template's lineage — children generated from an
  // earlier template version still reference that older id, so propagation and
  // the derived-list must span the whole lineage.
  const templateLineageIds = versions.length ? versions.map(v => v.id) : (id ? [id] : []);

  // Work Instructions generated from any version of this template.
  const { data: derivedWis = [] } = useQuery<WorkInstruction[]>({
    queryKey: ['wi-derived', id, templateLineageIds.join(',')],
    enabled: !!wi?.is_template && templateLineageIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('work_instructions')
        .select('*, creator:profiles!created_by(full_name), reagent:reagent_items!reagent_item_id(item_number)')
        .in('template_id', templateLineageIds)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return data as WorkInstruction[];
    },
  });

  // The template this WI was generated from (only queried for children).
  const { data: parentTemplate } = useQuery<Pick<WorkInstruction, 'id' | 'title' | 'version'> | null>({
    queryKey: ['wi-parent-template', wi?.template_id],
    enabled: !!wi?.template_id,
    queryFn: async () => {
      const { data } = await supabase
        .from('work_instructions').select('id, title, version').eq('id', wi!.template_id!).single();
      return data as Pick<WorkInstruction, 'id' | 'title' | 'version'> | null;
    },
  });

  const newVersionMutation = useMutation({
    mutationFn: async () => {
      // If this is a child that the template flagged (a locked step changed
      // after approval), pull the template's current locked steps into the new
      // version so re-versioning actually applies the update.
      let templateLocked: Map<string, { name: string; description: string | null; parameters: unknown }> | null = null;
      let syncedTemplate: { id: string; version: number } | null = null;
      if (wi!.template_id && wi!.template_needs_review && parentTemplate) {
        const { data: tplVers } = await supabase
          .from('work_instructions')
          .select('id, version, status, wi_steps(source_step_id, id, name, description, parameters, locked)')
          .eq('is_template', true)
          .eq('title', parentTemplate.title)
          .order('version', { ascending: false });
        // Prefer the latest approved template version; fall back to the newest.
        const latest = (tplVers ?? []).find(t => t.status === 'approved') ?? (tplVers ?? [])[0];
        if (latest) {
          syncedTemplate = { id: latest.id, version: latest.version };
          templateLocked = new Map();
          for (const ts of (latest.wi_steps ?? []) as WIStep[]) {
            if (ts.locked) {
              templateLocked.set(ts.source_step_id ?? ts.id, {
                name: ts.name, description: ts.description ?? null, parameters: ts.parameters,
              });
            }
          }
        }
      }

      // Insert next version as a new draft
      const { data: newWI, error: e1 } = await supabase
        .from('work_instructions')
        .insert({
          title: wi!.title,
          description: wi!.description ?? null,
          product_name: wi!.product_name,
          reagent_item_id: wi!.reagent_item_id ?? null,
          // Carry template identity forward so a new version of a template
          // stays a template (and a child stays a child).
          is_template: wi!.is_template ?? false,
          // Re-point a freshly-synced child at the template version it now matches.
          template_id: syncedTemplate?.id ?? wi!.template_id ?? null,
          template_version: syncedTemplate?.version ?? wi!.template_version ?? null,
          template_needs_review: false,
          target_molarity: wi!.target_molarity ?? null,
          scheduled_minutes: wi!.scheduled_minutes ?? null,
          version: wi!.version + 1,
          status: 'draft',
          created_by: profile!.id,
        })
        .select()
        .single();
      if (e1) throw e1;

      // Copy all steps from the current WI to the new one, overlaying the
      // template's current content onto locked steps when we're pulling a
      // flagged update.
      if (steps.length > 0) {
        const newSteps = steps.map(s => {
          const token = s.source_step_id ?? s.id;
          const overlay = templateLocked?.get(token);
          return {
            work_instruction_id: newWI.id,
            step_template_id: s.step_template_id ?? null,
            // Carry the lineage token so the version diff matches steps across
            // versions (renames diff as "modified", not removed + added).
            source_step_id: token,
            step_order: s.step_order,
            name: overlay?.name ?? s.name,
            description: overlay ? overlay.description : (s.description ?? null),
            locked: s.locked ?? false,
            parameters: overlay?.parameters ?? s.parameters,
          };
        });
        const { error: e2 } = await supabase.from('wi_steps').insert(newSteps);
        if (e2) throw e2;
      }

      return newWI;
    },
    onSuccess: (newWI) => {
      qc.invalidateQueries({ queryKey: ['work-instructions'] });
      navigate(`/work-instructions/${newWI.id}/edit`);
    },
  });

  async function handleNewVersion() {
    setNewVersionLoading(true);
    try {
      await newVersionMutation.mutateAsync();
    } finally {
      setNewVersionLoading(false);
    }
  }

  const approveMutation = useMutation({
    mutationFn: async (action: 'approved' | 'rejected' | 'revision_requested') => {
      const { error: e1 } = await supabase
        .from('work_instructions')
        .update({ status: action === 'approved' ? 'approved' : action === 'rejected' ? 'rejected' : 'draft' })
        .eq('id', id!);
      if (e1) throw e1;

      const { error: e2 } = await supabase.from('wi_approvals').insert({
        work_instruction_id: id!,
        reviewer_id: profile!.id,
        action,
        comment: approvalComment.trim() || null,
      });
      if (e2) throw e2;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['work-instruction-detail', id] });
      qc.invalidateQueries({ queryKey: ['wi-approvals', id] });
      qc.invalidateQueries({ queryKey: ['wi-versions'] });
      qc.invalidateQueries({ queryKey: ['work-instructions'] });
      setApprovalComment('');
      setApprovalError('');
    },
    onError: (e: unknown) => {
      setApprovalError(e instanceof Error ? e.message : 'Approval action failed — check your permissions');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('work_instructions').delete().eq('id', id!);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['work-instructions'] });
      navigate('/work-instructions');
    },
  });

  async function handleApproval(action: 'approved' | 'rejected' | 'revision_requested') {
    setApprovalLoading(true);
    setApprovalError('');
    await approveMutation.mutateAsync(action);
    setApprovalLoading(false);
  }

  // Step navigator: highlight whichever step card is crossing the upper
  // viewport as the reader scrolls. Re-observes only when the step set changes.
  const [activeStepId, setActiveStepId] = useState<string | null>(null);
  const stepOrderRef = useRef<string[]>([]);
  stepOrderRef.current = steps.map(s => s.id);
  const stepIdsKey = steps.map(s => s.id).join('|');
  useEffect(() => {
    const visible = new Set<string>();
    const observer = new IntersectionObserver(entries => {
      for (const e of entries) {
        const sid = (e.target as HTMLElement).dataset.detailStepId;
        if (!sid) continue;
        if (e.isIntersecting) visible.add(sid); else visible.delete(sid);
      }
      const first = stepOrderRef.current.find(sid => visible.has(sid));
      if (first) setActiveStepId(first);
    }, { rootMargin: '-10% 0px -55% 0px' });
    document.querySelectorAll<HTMLElement>('[data-detail-step-id]').forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, [stepIdsKey]);

  function navigateToStep(sid: string) {
    document.getElementById(`wi-detail-step-${sid}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveStepId(sid);
  }

  if (isLoading) return <div className="text-center py-12 text-gray-400">Loading…</div>;
  if (!wi) return <div className="text-center py-12 text-gray-500">Work instruction not found</div>;

  const isApprover = profile?.role === 'approver' || profile?.role === 'admin';
  const isAuthor = profile?.role === 'author' || profile?.role === 'admin';
  const isAdmin = profile?.role === 'admin';
  const canEdit = isAuthor && (wi.created_by === profile?.id || isAdmin) && (wi.status === 'draft' || wi.status === 'rejected');
  // Separation of duties: you can review/approve a WI only if you didn't author it.
  const isOwnSubmission = wi.created_by === profile?.id;
  const canApprove = isApprover && wi.status === 'pending_review' && !isOwnSubmission;
  const canStartProduction = wi.status === 'approved';
  const canCreateNewVersion = wi.status === 'approved' && (isAuthor || isAdmin);

  const navItems: StepNavItem[] = steps.map(step => {
    const t = ((step.parameters as Record<string, unknown>)._step_type ?? 'custom') as StepType;
    return { id: step.id, name: step.name, icon: STEP_ICONS[t] };
  });

  return (
    <div className="flex items-start gap-6">
      <StepNavPanel
        items={navItems}
        activeId={activeStepId}
        onNavigate={navigateToStep}
        storageKey="wi-detail-nav"
      />
      <div className="flex-1 min-w-0 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <button onClick={() => navigate('/work-instructions')} className="mt-1 text-gray-400 hover:text-gray-700 transition-colors">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-bold text-gray-900">{wi.title}</h1>
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_STYLES[wi.status]}`}>
              {wi.status.replace('_', ' ')}
            </span>
            {wi.is_template && (
              <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-indigo-100 text-indigo-700">
                <LayoutTemplate size={12} /> Template
              </span>
            )}
            <span className="text-xs text-gray-400">v{wi.version}</span>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            {wi.is_template
              ? <span className="italic text-gray-400">Reusable template — not linked to a product</span>
              : wi.product_name}
            {wi.target_molarity != null && <span className="ml-1">— {wi.target_molarity} M</span>}
            {wi.scheduled_minutes != null && <span className="ml-1">— {wi.scheduled_minutes} min scheduled</span>}
          </p>
          {wi.description && <p className="text-sm text-gray-600 mt-1">{wi.description}</p>}
        </div>
        <div className="flex gap-2 shrink-0">
          {versions.length > 1 && (
            <Link
              to={`/work-instructions/${wi.id}/diff`}
              title="Side-by-side comparison against another version"
              className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
            >
              <GitCompare size={14} /> Compare
            </Link>
          )}
          {canEdit && (
            <Link
              to={`/work-instructions/${wi.id}/edit`}
              className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
            >
              <Pencil size={14} /> Edit
            </Link>
          )}
          {canCreateNewVersion && (
            <button
              onClick={handleNewVersion}
              disabled={newVersionLoading}
              className="flex items-center gap-2 px-3 py-2 border border-indigo-300 text-indigo-700 rounded-lg text-sm hover:bg-indigo-50 disabled:opacity-50"
            >
              <GitBranch size={14} /> New Version
            </button>
          )}
          {isAuthor && !wi.is_template && (
            <button
              onClick={() => setCopyModalOpen(true)}
              title="Start a work instruction for another item using this one as the template"
              className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
            >
              <Copy size={14} /> Copy to New Item
            </button>
          )}
          {isAuthor && wi.is_template && wi.status === 'approved' && (
            <button
              onClick={() => setNewFromTemplateOpen(true)}
              title="Generate a new Work Instruction from this template"
              className="flex items-center gap-2 px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700"
            >
              <FilePlus size={14} /> New from Template
            </button>
          )}
          {isAuthor && wi.is_template && derivedWis.length > 0 && (
            <button
              onClick={() => setPropagateOpen(true)}
              title="Push the template's current locked steps to derived Work Instructions"
              className="flex items-center gap-2 px-3 py-2 border border-indigo-300 text-indigo-700 rounded-lg text-sm hover:bg-indigo-50"
            >
              <RefreshCw size={14} /> Sync locked steps
            </button>
          )}
          {canStartProduction && !wi.is_template && (
            <Link
              to={`/production-orders/new?wi=${wi.id}`}
              className="flex items-center gap-2 px-3 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700"
            >
              <PlayCircle size={14} /> Start Production
            </Link>
          )}
          {isAdmin && (
            <button
              onClick={() => setDeleteConfirmOpen(true)}
              className="flex items-center gap-2 px-3 py-2 border border-red-300 text-red-600 rounded-lg text-sm hover:bg-red-50"
            >
              <Trash2 size={14} /> Delete
            </button>
          )}
        </div>
      </div>

      {/* Generated-from-template banner (child WI) */}
      {wi.template_id && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900 flex items-center gap-2">
          <LayoutTemplate size={16} className="shrink-0 text-indigo-500" />
          <span>
            Generated from template{' '}
            <Link to={`/work-instructions/${wi.template_id}`} className="font-semibold underline hover:text-indigo-700">
              {parentTemplate?.title ?? 'template'}
            </Link>
            {wi.template_version != null && <span className="text-indigo-500"> (v{wi.template_version})</span>}.
            Locked steps come from the template.
          </span>
        </div>
      )}

      {/* Template changed a locked step after this WI was approved */}
      {wi.template_needs_review && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-2">
          <AlertTriangle size={16} className="shrink-0 text-amber-500 mt-0.5" />
          <span>
            A <strong>locked step changed on the template</strong> after this approved WI was created. Create a
            new version to pull in the update, then re-approve. {canCreateNewVersion && 'Use “New Version” above.'}
          </span>
        </div>
      )}

      {/* Copy-to-new-item modal */}
      {copyModalOpen && (
        <CopyToNewItemModal wi={wi} steps={steps} onClose={() => setCopyModalOpen(false)} />
      )}

      {/* New-from-template modal */}
      {newFromTemplateOpen && (
        <NewFromTemplateModal template={wi} steps={steps} onClose={() => setNewFromTemplateOpen(false)} />
      )}

      {/* Propagate locked-step changes modal */}
      {propagateOpen && (
        <PropagateTemplateModal
          template={wi}
          templateSteps={steps}
          derived={derivedWis}
          onClose={() => setPropagateOpen(false)}
        />
      )}

      {/* Delete confirmation modal */}
      {deleteConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100">
                <Trash2 size={20} className="text-red-600" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-gray-900">Delete work instruction?</h2>
                <p className="text-sm text-gray-500">{wi.title} — v{wi.version}</p>
              </div>
            </div>
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              <strong>This action is irreversible.</strong> The work instruction, all of its steps, and the full approval history will be permanently deleted and cannot be recovered.
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setDeleteConfirmOpen(false)}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteMutation.mutate()}
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

      {/* Reviewer shortcut: see exactly what changed instead of re-reading */}
      {wi.status === 'pending_review' && versions.length > 1 && (() => {
        const compareBase =
          versions.find(v => v.id !== wi.id && v.status === 'approved') ??
          versions.find(v => v.id !== wi.id && v.version < wi.version) ??
          versions.find(v => v.id !== wi.id);
        if (!compareBase) return null;
        return (
          <Link
            to={`/work-instructions/${wi.id}/diff?base=${compareBase.id}`}
            className="flex items-center gap-3 bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3 hover:bg-indigo-100/70 transition-colors"
          >
            <GitCompare size={18} className="text-indigo-600 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-indigo-900">
                Reviewing v{wi.version}? See exactly what changed vs v{compareBase.version}
                {compareBase.status === 'approved' && ' (currently active)'}
              </p>
              <p className="text-xs text-indigo-600">
                Added, removed, and edited steps highlighted side by side — no need to re-read the whole instruction.
              </p>
            </div>
            <ChevronRight size={16} className="text-indigo-400 shrink-0" />
          </Link>
        );
      })()}

      {/* Steps */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
          <h2 className="text-sm font-semibold text-gray-700">Steps ({steps.length})</h2>
        </div>
        {steps.length === 0 ? (
          <p className="text-center py-8 text-sm text-gray-400">No steps defined</p>
        ) : (
          <ol className="divide-y divide-gray-50">
            {steps.map((step, i) => {
              const p = step.parameters as Record<string, unknown>;
              const stepType = (p._step_type ?? 'custom') as StepType;
              const summary = stepSummary(step);
              return (
                <li
                  key={step.id}
                  id={`wi-detail-step-${step.id}`}
                  data-detail-step-id={step.id}
                  className="flex items-start gap-4 px-5 py-4 scroll-mt-4"
                >
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-100 text-blue-700 text-xs font-bold shrink-0">
                    {i + 1}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500">{STEP_ICONS[stepType]}</span>
                      <span className="font-medium text-gray-900 text-sm">{step.name}</span>
                      {step.locked && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-100 border border-amber-200 rounded px-1.5 py-0.5">
                          <Lock size={10} /> Locked
                        </span>
                      )}
                    </div>
                    {step.description && <p className="text-xs text-gray-500 mt-0.5">{step.description}</p>}
                    {summary && (
                      <p className="text-xs text-blue-700 bg-blue-50 px-2 py-1 rounded mt-1.5 inline-block">{summary}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {/* Derived Work Instructions (templates only) */}
      {wi.is_template && (
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 flex items-center gap-2">
            <LayoutTemplate size={15} className="text-indigo-500" />
            <h2 className="text-sm font-semibold text-gray-700">Derived Work Instructions</h2>
            <span className="text-xs text-gray-400">{derivedWis.length}</span>
            {isAuthor && wi.status === 'approved' && (
              <button
                onClick={() => setNewFromTemplateOpen(true)}
                className="ml-auto flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-800"
              >
                <FilePlus size={13} /> New from Template
              </button>
            )}
          </div>
          {derivedWis.length === 0 ? (
            <p className="text-center py-6 text-sm text-gray-400">
              {wi.status === 'approved'
                ? 'No Work Instructions generated from this template yet.'
                : 'Approve this template to start generating Work Instructions from it.'}
            </p>
          ) : (
            <ul className="divide-y divide-gray-50">
              {derivedWis.map(d => (
                <li key={d.id}>
                  <Link to={`/work-instructions/${d.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50">
                    <span className="font-medium text-gray-900 text-sm flex-1 truncate">{d.title}</span>
                    {(d as any).reagent?.item_number && (
                      <span className="font-mono text-xs text-gray-500">{(d as any).reagent.item_number}</span>
                    )}
                    <span className="text-gray-500 text-sm truncate max-w-[10rem]">{d.product_name}</span>
                    <span className="text-xs text-gray-400">v{d.version}</span>
                    {d.template_needs_review && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-100 border border-amber-200 rounded px-1.5 py-0.5">
                        <AlertTriangle size={10} /> review
                      </span>
                    )}
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_STYLES[d.status]}`}>
                      {d.status.replace('_', ' ')}
                    </span>
                    <ChevronRight size={16} className="text-gray-300" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* You can't approve your own submission */}
      {isApprover && wi.status === 'pending_review' && isOwnSubmission && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          You submitted this work instruction, so a different reviewer must approve it (separation of duties).
        </div>
      )}

      {/* Approval panel */}
      {canApprove && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-semibold text-amber-800">Review &amp; Approve</h2>
          {approvalError && (
            <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{approvalError}</div>
          )}
          <textarea
            value={approvalComment}
            onChange={e => setApprovalComment(e.target.value)}
            rows={3}
            placeholder="Add a review comment (optional)"
            className="w-full border border-amber-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
          />
          <div className="flex gap-2">
            <button
              onClick={() => handleApproval('approved')}
              disabled={approvalLoading}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              <CheckCircle size={15} /> Approve
            </button>
            <button
              onClick={() => handleApproval('revision_requested')}
              disabled={approvalLoading}
              className="flex items-center gap-2 px-4 py-2 bg-yellow-500 text-white text-sm rounded-lg hover:bg-yellow-600 disabled:opacity-50"
            >
              <RotateCcw size={15} /> Request Revision
            </button>
            <button
              onClick={() => handleApproval('rejected')}
              disabled={approvalLoading}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 disabled:opacity-50"
            >
              <XCircle size={15} /> Reject
            </button>
          </div>
        </div>
      )}

      {/* Approval history */}
      {approvals.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
            <h2 className="text-sm font-semibold text-gray-700">Approval History</h2>
          </div>
          <ul className="divide-y divide-gray-50">
            {approvals.map(a => (
              <li key={a.id} className="px-5 py-3 flex items-start gap-3">
                <span className={`mt-0.5 text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${
                  a.action === 'approved' ? 'bg-green-100 text-green-700' :
                  a.action === 'rejected' ? 'bg-red-100 text-red-700' :
                  a.action === 'submitted' ? 'bg-blue-100 text-blue-700' :
                  'bg-yellow-100 text-yellow-700'
                }`}>
                  {a.action.replace('_', ' ')}
                </span>
                <div>
                  <p className="text-sm text-gray-800">
                    <span className="font-medium">{(a as any).reviewer?.full_name ?? 'Unknown'}</span>
                    {a.comment && <span className="text-gray-500"> — {a.comment}</span>}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">{formatDate(a.created_at)}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Version history — every version in this WI's lineage */}
      {versions.length > 1 && (
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 flex items-center gap-2">
            <GitBranch size={15} className="text-indigo-500" />
            <h2 className="text-sm font-semibold text-gray-700">Version History</h2>
            <span className="text-xs text-gray-400">{versions.length} versions</span>
          </div>
          <ul className="divide-y divide-gray-50">
            {versions.map(v => {
              const isCurrent = v.id === wi.id;
              return (
                <li key={v.id}>
                  <Link
                    to={`/work-instructions/${v.id}`}
                    className={cn(
                      'flex items-center gap-3 px-5 py-3 transition-colors',
                      isCurrent ? 'bg-indigo-50/50' : 'hover:bg-gray-50'
                    )}
                  >
                    <span className="text-xs font-bold text-gray-500 w-9 shrink-0">v{v.version}</span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${STATUS_STYLES[v.status]}`}>
                      {v.status.replace('_', ' ')}
                    </span>
                    <span className="text-sm text-gray-600 flex-1 truncate">
                      {(v as any).creator?.full_name ?? '—'}
                    </span>
                    <span className="text-xs text-gray-400 shrink-0">{formatDate(v.updated_at)}</span>
                    {isCurrent
                      ? <span className="text-xs text-indigo-600 font-medium shrink-0 w-16 text-right">current</span>
                      : <span className="shrink-0 w-16 flex justify-end"><ChevronRight size={15} className="text-gray-300" /></span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      </div>
    </div>
  );
}

// ─── Copy-to-new-item modal ───────────────────────────────────────────────────
// Uses an existing WI as the template for a brand-new draft (version 1) linked
// to a different reagent item — e.g. start "1.0 M EDTA" from "0.5 M EDTA".
// All steps are copied; source_step_id is deliberately NOT carried over, so the
// copy starts its own version-diff lineage instead of inheriting the source's.
function CopyToNewItemModal({ wi, steps, onClose }: { wi: WorkInstruction; steps: WIStep[]; onClose: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { profile } = useAuth();
  const [search, setSearch] = useState('');
  const [targetItemId, setTargetItemId] = useState('');
  const [title, setTitle] = useState('');
  const [productName, setProductName] = useState('');
  const [titleTouched, setTitleTouched] = useState(false);

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

  const targetItem = reagents.find(r => r.id === targetItemId);
  const q = search.trim().toLowerCase();
  const matches = reagents
    .filter(r => !q || r.product_name.toLowerCase().includes(q) || r.item_number.toLowerCase().includes(q))
    .sort((a, b) => (a.item_type === 'FG' ? 0 : 1) - (b.item_type === 'FG' ? 0 : 1))
    .slice(0, 30);

  function pickItem(r: ReagentItem) {
    setTargetItemId(r.id);
    setProductName(r.product_name);
    if (!titleTouched) setTitle(r.product_name);
  }

  const copyMutation = useMutation({
    mutationFn: async () => {
      const cleanTitle = title.trim();
      const cleanProduct = productName.trim();
      if (!cleanTitle) throw new Error('Give the new work instruction a title.');
      if (!cleanProduct) throw new Error('Pick a target item or enter a product name.');

      // Versions are grouped by item+title — a copy that collides with an
      // existing lineage would merge into its version history, so block it.
      const targetKey = wiLineageKey({ reagent_item_id: targetItemId || null, product_name: cleanProduct, title: cleanTitle });
      const { data: sameTitle, error: e0 } = await supabase
        .from('work_instructions')
        .select('id, title, product_name, reagent_item_id')
        .eq('title', cleanTitle);
      if (e0) throw e0;
      if ((sameTitle ?? []).some(w => wiLineageKey(w) === targetKey)) {
        throw new Error('A work instruction with this title already exists for the target item — change the title, or open that WI and use New Version instead.');
      }

      const { data: newWI, error: e1 } = await supabase
        .from('work_instructions')
        .insert({
          title: cleanTitle,
          description: wi.description ?? null,
          product_name: cleanProduct,
          reagent_item_id: targetItemId || null,
          // target_molarity intentionally not copied — the new item's
          // concentration is what the author is here to change.
          scheduled_minutes: wi.scheduled_minutes ?? null,
          version: 1,
          status: 'draft',
          created_by: profile!.id,
        })
        .select()
        .single();
      if (e1) throw e1;

      if (steps.length > 0) {
        const newSteps = steps.map(s => ({
          work_instruction_id: newWI.id,
          step_template_id: s.step_template_id ?? null,
          step_order: s.step_order,
          name: s.name,
          description: s.description ?? null,
          parameters: s.parameters,
        }));
        const { error: e2 } = await supabase.from('wi_steps').insert(newSteps);
        if (e2) throw e2;
      }
      return newWI;
    },
    onSuccess: (newWI) => {
      qc.invalidateQueries({ queryKey: ['work-instructions'] });
      navigate(`/work-instructions/${newWI.id}/edit`);
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100">
            <Copy size={17} className="text-indigo-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-gray-900">Copy to New Item</h2>
            <p className="text-xs text-gray-500 truncate">
              From {wi.title} (v{wi.version}) · {steps.length} step{steps.length === 1 ? '' : 's'} will be copied
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Target item picker */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Target item</label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by product name or item number…"
                className="w-full border border-gray-300 rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="mt-2 border border-gray-200 rounded-lg max-h-44 overflow-y-auto divide-y divide-gray-50">
              {matches.length === 0 ? (
                <p className="px-3 py-3 text-sm text-gray-400">No matching items.</p>
              ) : matches.map(r => (
                <button
                  key={r.id}
                  onClick={() => pickItem(r)}
                  className={cn(
                    'w-full flex items-baseline gap-2 px-3 py-2 text-left text-sm transition-colors',
                    r.id === targetItemId ? 'bg-blue-50 text-blue-800' : 'hover:bg-gray-50 text-gray-800'
                  )}
                >
                  <span className="font-medium truncate">{r.product_name}</span>
                  <span className="text-xs text-gray-400 font-mono shrink-0">{r.item_number}</span>
                  {r.item_type === 'FG' && <span className="ml-auto text-[10px] font-semibold text-emerald-600 shrink-0">FG</span>}
                </button>
              ))}
            </div>
            {targetItem && (
              <p className="text-xs text-gray-500 mt-1.5">
                Selected: <span className="font-medium text-gray-700">{targetItem.product_name}</span> · {targetItem.item_number}
              </p>
            )}
          </div>

          {/* Title / product name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">New title *</label>
            <input
              value={title}
              onChange={e => { setTitle(e.target.value); setTitleTouched(true); }}
              placeholder="e.g. 1.0 M EDTA Solution, pH 8.0"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Product name *</label>
            <input
              value={productName}
              onChange={e => setProductName(e.target.value)}
              placeholder="Filled from the target item, or type your own"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {copyMutation.isError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {(copyMutation.error as Error).message}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={() => copyMutation.mutate()}
              disabled={copyMutation.isPending || !title.trim() || !productName.trim()}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              <Copy size={14} />
              {copyMutation.isPending ? 'Copying…' : 'Create Draft Copy'}
            </button>
          </div>
          <p className="text-xs text-gray-400">
            Creates a draft (v1) owned by you and opens it in the editor so you can adjust quantities, targets, and steps.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── New-from-template modal ──────────────────────────────────────────────────
// Generates a child WI from a template: copies every step (carrying its lineage
// token AND locked flag) and records template_id / template_version so locked-
// step changes can later be propagated. The child picks its own product.
function NewFromTemplateModal({ template, steps, onClose }: { template: WorkInstruction; steps: WIStep[]; onClose: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { profile } = useAuth();
  const [search, setSearch] = useState('');
  const [targetItemId, setTargetItemId] = useState('');
  const [title, setTitle] = useState('');
  const [productName, setProductName] = useState('');
  const [titleTouched, setTitleTouched] = useState(false);

  const lockedCount = steps.filter(s => s.locked).length;

  const { data: reagents = [] } = useQuery<ReagentItem[]>({
    queryKey: ['reagent-items-active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reagent_items').select('*').eq('is_active', true).order('product_name');
      if (error) throw error;
      return data as ReagentItem[];
    },
  });

  const targetItem = reagents.find(r => r.id === targetItemId);
  const q = search.trim().toLowerCase();
  const matches = reagents
    .filter(r => !q || r.product_name.toLowerCase().includes(q) || r.item_number.toLowerCase().includes(q))
    .sort((a, b) => (a.item_type === 'FG' ? 0 : 1) - (b.item_type === 'FG' ? 0 : 1))
    .slice(0, 30);

  function pickItem(r: ReagentItem) {
    setTargetItemId(r.id);
    setProductName(r.product_name);
    if (!titleTouched) setTitle(r.product_name);
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      const cleanTitle = title.trim();
      const cleanProduct = productName.trim();
      if (!cleanTitle) throw new Error('Give the new work instruction a title.');
      if (!cleanProduct) throw new Error('Pick a target item or enter a product name.');

      // Block a title/product that would merge into an existing version lineage.
      const targetKey = wiLineageKey({ reagent_item_id: targetItemId || null, product_name: cleanProduct, title: cleanTitle });
      const { data: sameTitle, error: e0 } = await supabase
        .from('work_instructions').select('id, title, product_name, reagent_item_id').eq('title', cleanTitle);
      if (e0) throw e0;
      if ((sameTitle ?? []).some(w => wiLineageKey(w) === targetKey)) {
        throw new Error('A work instruction with this title already exists for the target item — change the title.');
      }

      const { data: newWI, error: e1 } = await supabase
        .from('work_instructions')
        .insert({
          title: cleanTitle,
          description: template.description ?? null,
          product_name: cleanProduct,
          reagent_item_id: targetItemId || null,
          is_template: false,
          template_id: template.id,
          template_version: template.version,
          scheduled_minutes: template.scheduled_minutes ?? null,
          version: 1,
          status: 'draft',
          created_by: profile!.id,
        })
        .select().single();
      if (e1) throw e1;

      if (steps.length > 0) {
        const newSteps = steps.map(s => ({
          work_instruction_id: newWI.id,
          step_template_id: s.step_template_id ?? null,
          // Carry the lineage token so a locked-step change on the template can
          // find this child step later.
          source_step_id: s.source_step_id ?? s.id,
          step_order: s.step_order,
          name: s.name,
          description: s.description ?? null,
          locked: s.locked ?? false,
          parameters: s.parameters,
        }));
        const { error: e2 } = await supabase.from('wi_steps').insert(newSteps);
        if (e2) throw e2;
      }
      return newWI;
    },
    onSuccess: (newWI) => {
      qc.invalidateQueries({ queryKey: ['work-instructions'] });
      qc.invalidateQueries({ queryKey: ['wi-derived', template.id] });
      navigate(`/work-instructions/${newWI.id}/edit`);
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100">
            <FilePlus size={17} className="text-indigo-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-gray-900">New from Template</h2>
            <p className="text-xs text-gray-500 truncate">
              {template.title} (v{template.version}) · {steps.length} step{steps.length === 1 ? '' : 's'} ({lockedCount} locked) will be copied
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Product / item *</label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by product name or item number…"
                className="w-full border border-gray-300 rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="mt-2 border border-gray-200 rounded-lg max-h-44 overflow-y-auto divide-y divide-gray-50">
              {matches.length === 0 ? (
                <p className="px-3 py-3 text-sm text-gray-400">No matching items.</p>
              ) : matches.map(r => (
                <button
                  key={r.id}
                  onClick={() => pickItem(r)}
                  className={cn(
                    'w-full flex items-baseline gap-2 px-3 py-2 text-left text-sm transition-colors',
                    r.id === targetItemId ? 'bg-blue-50 text-blue-800' : 'hover:bg-gray-50 text-gray-800'
                  )}
                >
                  <span className="font-medium truncate">{r.product_name}</span>
                  <span className="text-xs text-gray-400 font-mono shrink-0">{r.item_number}</span>
                  {r.item_type === 'FG' && <span className="ml-auto text-[10px] font-semibold text-emerald-600 shrink-0">FG</span>}
                </button>
              ))}
            </div>
            {targetItem && (
              <p className="text-xs text-gray-500 mt-1.5">
                Selected: <span className="font-medium text-gray-700">{targetItem.product_name}</span> · {targetItem.item_number}
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">New title *</label>
            <input
              value={title}
              onChange={e => { setTitle(e.target.value); setTitleTouched(true); }}
              placeholder="e.g. 1.0 M EDTA Solution, pH 8.0"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Product name *</label>
            <input
              value={productName}
              onChange={e => setProductName(e.target.value)}
              placeholder="Filled from the target item, or type your own"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {createMutation.isError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {(createMutation.error as Error).message}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">
              Cancel
            </button>
            <button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || !title.trim() || !productName.trim()}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              <FilePlus size={14} />
              {createMutation.isPending ? 'Creating…' : 'Create Work Instruction'}
            </button>
          </div>
          <p className="text-xs text-gray-400">
            Locked steps are read-only on the new WI; you fill in the unlocked steps (reagents, pH, …), then submit for approval.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Propagate locked-step changes modal ──────────────────────────────────────
// Pushes the template's CURRENT locked steps to its derived WIs. Draft/rejected
// children are updated in place (matched by lineage token); approved / in-review
// children are flagged (template_needs_review) rather than mutated.
function PropagateTemplateModal({
  template, templateSteps, derived, onClose,
}: {
  template: WorkInstruction;
  templateSteps: WIStep[];
  derived: WorkInstruction[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const [note, setNote] = useState('');

  const lockedSteps = templateSteps.filter(s => s.locked);
  const draftLike = derived.filter(d => d.status === 'draft' || d.status === 'rejected');
  const flagged = derived.filter(d => d.status !== 'draft' && d.status !== 'rejected');

  const syncMutation = useMutation({
    mutationFn: async () => {
      const changeNote = note.trim();
      if (!changeNote) throw new Error('Describe the change before pushing it.');
      const nowIso = new Date().toISOString();

      // 1) Update locked steps on draft/rejected children in place.
      const draftIds = draftLike.map(d => d.id);
      if (draftIds.length > 0 && lockedSteps.length > 0) {
        const { data: childSteps, error: eSteps } = await supabase
          .from('wi_steps')
          .select('id, work_instruction_id, source_step_id')
          .in('work_instruction_id', draftIds);
        if (eSteps) throw eSteps;

        const byWi = new Map<string, { id: string; source_step_id: string | null }[]>();
        for (const cs of (childSteps ?? []) as { id: string; work_instruction_id: string; source_step_id: string | null }[]) {
          const arr = byWi.get(cs.work_instruction_id) ?? [];
          arr.push({ id: cs.id, source_step_id: cs.source_step_id });
          byWi.set(cs.work_instruction_id, arr);
        }

        for (const child of draftLike) {
          const csList = byWi.get(child.id) ?? [];
          for (const ts of lockedSteps) {
            const token = ts.source_step_id ?? ts.id;
            const cs = csList.find(c => (c.source_step_id ?? c.id) === token);
            if (!cs) continue;
            const { error } = await supabase.from('wi_steps').update({
              name: ts.name,
              description: ts.description ?? null,
              parameters: ts.parameters,
              locked: true,
            }).eq('id', cs.id);
            if (error) throw error;
          }
        }
      }
      // Mark the updated children as synced to this template version.
      if (draftIds.length > 0) {
        const { error } = await supabase.from('work_instructions')
          .update({ template_version: template.version, updated_at: nowIso }).in('id', draftIds);
        if (error) throw error;
      }

      // 2) Flag approved / in-review children for a deliberate re-version.
      const flaggedIds = flagged.map(d => d.id);
      if (flaggedIds.length > 0) {
        const { error } = await supabase.from('work_instructions')
          .update({ template_needs_review: true, updated_at: nowIso }).in('id', flaggedIds);
        if (error) throw error;
      }

      // 3) Audit log.
      const { error: eLog } = await supabase.from('wi_template_syncs').insert({
        template_id: template.id,
        change_note: changeNote,
        applied_count: draftLike.length,
        flagged_count: flagged.length,
        created_by: profile!.id,
      });
      if (eLog) throw eLog;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wi-derived', template.id] });
      qc.invalidateQueries({ queryKey: ['work-instructions'] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100">
            <RefreshCw size={17} className="text-indigo-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-gray-900">Sync locked steps to derived WIs</h2>
            <p className="text-xs text-gray-500 truncate">{template.title} (v{template.version})</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4">
          {lockedSteps.length === 0 ? (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
              This template has no locked steps, so there is nothing to propagate. Lock a step in the editor first.
            </div>
          ) : (
            <div className="rounded-lg border border-gray-200 divide-y divide-gray-50 text-sm">
              <div className="flex items-center gap-2 px-3 py-2">
                <Lock size={14} className="text-amber-600" />
                <span className="text-gray-700">{lockedSteps.length} locked step{lockedSteps.length === 1 ? '' : 's'} will be pushed</span>
              </div>
              <div className="flex items-center gap-2 px-3 py-2">
                <RefreshCw size={14} className="text-green-600" />
                <span className="text-gray-700"><strong>{draftLike.length}</strong> draft / rejected WI{draftLike.length === 1 ? '' : 's'} updated in place</span>
              </div>
              <div className="flex items-center gap-2 px-3 py-2">
                <AlertTriangle size={14} className="text-amber-500" />
                <span className="text-gray-700"><strong>{flagged.length}</strong> approved / in-review WI{flagged.length === 1 ? '' : 's'} flagged for review</span>
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Change note *</label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={3}
              placeholder="What changed on the locked step(s), and why — recorded on the sync history."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {syncMutation.isError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {(syncMutation.error as Error).message}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">
              Cancel
            </button>
            <button
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending || !note.trim() || lockedSteps.length === 0}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              <RefreshCw size={14} />
              {syncMutation.isPending ? 'Syncing…' : 'Push to derived WIs'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
