import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { WorkInstruction, WIStep, WIApproval, StepType } from '../types';
import {
  ArrowLeft, Pencil, CheckCircle, XCircle, RotateCcw, PlayCircle, GitBranch,
  FlaskConical, Scale, Timer, ArrowRightLeft, Thermometer, Snowflake, TestTube, Eye, Settings, Trash2,
  Wrench, Beaker, Printer, StickyNote, Milestone, AlertTriangle, ChevronRight,
} from 'lucide-react';
import { formatDate, cn, wiLineageKey } from '../lib/utils';

const STEP_ICONS: Record<StepType, React.ReactNode> = {
  gather_inputs:    <FlaskConical size={15} />,
  gather_equipment: <Wrench size={15} />,
  gather_reagents:  <Beaker size={15} />,
  weigh:            <Scale size={15} />,
  mix:              <Timer size={15} />,
  transfer:         <ArrowRightLeft size={15} />,
  ph_adjust:        <TestTube size={15} />,
  heat:             <Thermometer size={15} />,
  cool:             <Snowflake size={15} />,
  observe:       <Eye size={15} />,  print_labels:     <Printer size={15} />,  custom:        <Settings size={15} />,
  notes:            <StickyNote size={15} />,
  production_break: <Milestone size={15} />,
  possible_deviation: <AlertTriangle size={15} />,
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
    case 'mix':
      return `Mix for ${p.duration_minutes} min at ${p.speed} speed`;
    case 'heat':
      return `Heat to ${p.target_temp_c}°C for ${p.duration_minutes} min`;
    case 'cool':
      return `Cool to ${p.target_temp_c}°C`;
    case 'ph_adjust':
      return `Target pH ${p.target_ph} ± ${p.tolerance} using ${p.reagent}`;
    case 'observe':
      return p.prompt as string ?? '';
    case 'transfer':
      return `From ${p.from_vessel} to ${p.to_vessel}`;
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
    case 'possible_deviation':
      return (p.prompt as string)?.trim()
        ? (p.prompt as string)
        : `Capture impacted quantity${p.unit ? ` (${p.unit})` : ''} and notify supervisor`;
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
        .select('id, title, product_name, reagent_item_id, version, status, updated_at, creator:profiles!created_by(full_name)')
        .eq('title', wi!.title)
        .order('version', { ascending: false });
      if (error) throw error;
      const key = wiLineageKey(wi!);
      return (data as WorkInstruction[]).filter(v => wiLineageKey(v) === key);
    },
  });

  const newVersionMutation = useMutation({
    mutationFn: async () => {
      // Insert next version as a new draft
      const { data: newWI, error: e1 } = await supabase
        .from('work_instructions')
        .insert({
          title: wi!.title,
          description: wi!.description ?? null,
          product_name: wi!.product_name,
          reagent_item_id: wi!.reagent_item_id ?? null,
          target_molarity: wi!.target_molarity ?? null,
          scheduled_minutes: wi!.scheduled_minutes ?? null,
          version: wi!.version + 1,
          status: 'draft',
          created_by: profile!.id,
        })
        .select()
        .single();
      if (e1) throw e1;

      // Copy all steps from the current WI to the new one
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

  return (
    <div className="max-w-3xl mx-auto space-y-6">
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
            <span className="text-xs text-gray-400">v{wi.version}</span>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            {wi.product_name}
            {wi.target_molarity != null && <span className="ml-1">— {wi.target_molarity} M</span>}
            {wi.scheduled_minutes != null && <span className="ml-1">— {wi.scheduled_minutes} min scheduled</span>}
          </p>
          {wi.description && <p className="text-sm text-gray-600 mt-1">{wi.description}</p>}
        </div>
        <div className="flex gap-2 shrink-0">
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
          {canStartProduction && (
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
                <li key={step.id} className="flex items-start gap-4 px-5 py-4">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-100 text-blue-700 text-xs font-bold shrink-0">
                    {i + 1}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500">{STEP_ICONS[stepType]}</span>
                      <span className="font-medium text-gray-900 text-sm">{step.name}</span>
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
  );
}
