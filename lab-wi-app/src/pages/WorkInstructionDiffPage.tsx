import { Fragment, useMemo, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft, GitCompare, Plus, Minus, Pencil, MoveVertical, ChevronDown, ChevronRight,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { cn, wiLineageKey } from '../lib/utils';
import {
  diffSteps, diffHeader, summarize, authoredParams, stepTypeOf, labelize,
  type StepDiffRow,
} from '../lib/wiDiff';
import type { WorkInstruction, WIStep } from '../types';

/* -------------------------------------------------------------------------- */

const STATUS_STYLES: Record<string, string> = {
  draft:          'bg-gray-100 text-gray-600',
  pending_review: 'bg-yellow-100 text-yellow-700',
  approved:       'bg-green-100 text-green-700',
  rejected:       'bg-red-100 text-red-700',
};

function useWI(id: string | undefined) {
  return useQuery<WorkInstruction>({
    queryKey: ['work-instruction-detail', id],
    enabled: !!id,
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
}

function useWISteps(id: string | undefined) {
  return useQuery<WIStep[]>({
    queryKey: ['wi-steps-detail', id],
    enabled: !!id,
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
}

/* -------------------------------------------------------------------------- */

export default function WorkInstructionDiffPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());

  const { data: target, isLoading } = useWI(id);

  // Every version in this WI's lineage (same rule as the detail page).
  const { data: versions = [] } = useQuery<WorkInstruction[]>({
    queryKey: ['wi-versions', target?.title, target?.reagent_item_id, target?.product_name],
    enabled: !!target,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('work_instructions')
        .select('*, creator:profiles!created_by(full_name)')
        .eq('title', target!.title)
        .order('version', { ascending: false });
      if (error) throw error;
      const key = wiLineageKey(target!);
      return (data as WorkInstruction[]).filter(v => wiLineageKey(v) === key);
    },
  });

  /* Base version: ?base=<id> when present, else the currently active
   * (approved) version, else the next version below the target. */
  const base = useMemo(() => {
    const others = versions.filter(v => v.id !== id);
    const fromUrl = others.find(v => v.id === searchParams.get('base'));
    if (fromUrl) return fromUrl;
    return (
      others.find(v => v.status === 'approved') ??      // versions are newest-first
      others.find(v => v.version < (target?.version ?? 0)) ??
      others[0] ??
      null
    );
  }, [versions, id, searchParams, target?.version]);

  const { data: targetSteps = [] } = useWISteps(id);
  const { data: baseSteps = [] } = useWISteps(base?.id);

  const rows = useMemo(() => diffSteps(baseSteps, targetSteps), [baseSteps, targetSteps]);
  const counts = useMemo(() => summarize(rows), [rows]);
  const headerChanges = useMemo(
    () => (base && target ? diffHeader(base, target) : []),
    [base, target]
  );

  /* Collapse runs of untouched steps so reviewers see only what changed.
   * A row is "quiet" when unchanged and not moved. */
  const groups = useMemo(() => {
    const out: { quiet: boolean; rows: StepDiffRow[] }[] = [];
    for (const row of rows) {
      const quiet = row.kind === 'unchanged' && !row.moved;
      const last = out[out.length - 1];
      if (last && last.quiet === quiet) last.rows.push(row);
      else out.push({ quiet, rows: [row] });
    }
    return out;
  }, [rows]);

  if (isLoading || !target) {
    return <div className="text-center py-12 text-gray-400">Loading…</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <button onClick={() => navigate(`/work-instructions/${id}`)} className="text-gray-400 hover:text-gray-700 mt-1">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <GitCompare size={20} className="text-indigo-600" />
            Compare Versions — {target.title}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Changes only — matching steps are collapsed so reviewers don&apos;t re-read the whole instruction.
          </p>
        </div>
      </div>

      {versions.length < 2 || !base ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
          <GitCompare size={28} className="text-gray-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-900">This is the only version</p>
          <p className="text-xs text-gray-500 mt-1">Create a new version to compare changes against it.</p>
        </div>
      ) : (
        <>
          {/* Version pickers + change summary */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Base (old)</span>
              <select
                value={base.id}
                onChange={e => setSearchParams({ base: e.target.value }, { replace: true })}
                className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {versions.filter(v => v.id !== id).map(v => (
                  <option key={v.id} value={v.id}>v{v.version} · {v.status.replace('_', ' ')}</option>
                ))}
              </select>
            </label>
            <span className="pb-2 text-gray-300">→</span>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Comparing (new)</span>
              <select
                value={id}
                onChange={e => navigate(`/work-instructions/${e.target.value}/diff`, { replace: true })}
                className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {versions.map(v => (
                  <option key={v.id} value={v.id}>v{v.version} · {v.status.replace('_', ' ')}</option>
                ))}
              </select>
            </label>

            <div className="ml-auto flex flex-wrap items-center gap-2 text-xs font-medium">
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-100 text-emerald-800">
                <Plus size={11} /> {counts.added} added
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-rose-100 text-rose-700">
                <Minus size={11} /> {counts.removed} removed
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-100 text-amber-800">
                <Pencil size={11} /> {counts.modified} modified
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-indigo-100 text-indigo-700">
                <MoveVertical size={11} /> {counts.moved} moved
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-gray-100 text-gray-500">
                {counts.unchanged} unchanged
              </span>
            </div>
          </div>

          {/* Header-field changes */}
          {headerChanges.length > 0 && (
            <div className="bg-white rounded-xl border border-amber-200 overflow-hidden">
              <div className="px-4 py-2 bg-amber-50/70 border-b border-amber-100">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Header changes</p>
              </div>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-gray-50">
                  {headerChanges.map(c => (
                    <tr key={c.label}>
                      <td className="px-4 py-2 w-44 text-gray-500">{c.label}</td>
                      <td className="px-4 py-2 text-rose-700 line-through decoration-rose-300">{c.from}</td>
                      <td className="px-4 py-2 text-emerald-800 font-medium">{c.to}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Side-by-side steps */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="grid grid-cols-2 border-b border-gray-100 bg-gray-50 text-sm font-semibold text-gray-700">
              <div className="px-4 py-2.5 flex items-center gap-2 border-r border-gray-100">
                v{base.version}
                <span className={cn('text-[10px] font-medium px-2 py-0.5 rounded-full', STATUS_STYLES[base.status])}>
                  {base.status.replace('_', ' ')}
                </span>
                <span className="text-xs font-normal text-gray-400">base</span>
              </div>
              <div className="px-4 py-2.5 flex items-center gap-2">
                v{target.version}
                <span className={cn('text-[10px] font-medium px-2 py-0.5 rounded-full', STATUS_STYLES[target.status])}>
                  {target.status.replace('_', ' ')}
                </span>
                <span className="text-xs font-normal text-gray-400">comparing</span>
              </div>
            </div>

            <div className="divide-y divide-gray-50">
              {groups.map((g, gi) =>
                g.quiet && g.rows.length > 1 && !expandedGroups.has(gi) ? (
                  <button
                    key={gi}
                    onClick={() => setExpandedGroups(prev => new Set(prev).add(gi))}
                    className="w-full px-4 py-2 flex items-center justify-center gap-1.5 text-xs text-gray-400 hover:bg-gray-50 hover:text-gray-600 transition-colors"
                  >
                    <ChevronRight size={12} />
                    {g.rows.length} unchanged step{g.rows.length === 1 ? '' : 's'} — click to show
                  </button>
                ) : (
                  <Fragment key={gi}>
                    {g.quiet && g.rows.length > 1 && (
                      <button
                        onClick={() => setExpandedGroups(prev => { const n = new Set(prev); n.delete(gi); return n; })}
                        className="w-full px-4 py-1.5 flex items-center justify-center gap-1.5 text-xs text-gray-400 hover:bg-gray-50 transition-colors"
                      >
                        <ChevronDown size={12} /> hide unchanged
                      </button>
                    )}
                    {g.rows.map((row, ri) => <DiffRow key={`${gi}-${ri}`} row={row} />)}
                  </Fragment>
                )
              )}
              {rows.length === 0 && (
                <p className="px-4 py-8 text-center text-sm text-gray-400">Neither version has steps.</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ── One aligned pair of step cards ─────────────────────────────────────── */

function DiffRow({ row }: { row: StepDiffRow }) {
  return (
    <div className={cn(
      'grid grid-cols-2',
      row.kind === 'added'    && 'bg-emerald-50/40',
      row.kind === 'removed'  && 'bg-rose-50/40',
      row.kind === 'modified' && 'bg-amber-50/40',
    )}>
      {/* Base side */}
      <div className="px-4 py-3 border-r border-gray-100">
        {row.base ? (
          <StepCard
            step={row.base}
            tone={row.kind === 'removed' ? 'removed' : row.kind === 'modified' ? 'modified' : 'plain'}
            showParams={row.kind === 'removed'}
          />
        ) : (
          <p className="text-xs text-gray-300 italic py-2">— not in this version —</p>
        )}
      </div>

      {/* Target side */}
      <div className="px-4 py-3">
        {row.target ? (
          <>
            <StepCard
              step={row.target}
              tone={row.kind === 'added' ? 'added' : row.kind === 'modified' ? 'modified' : 'plain'}
              showParams={row.kind === 'added'}
              moved={row.moved ? { from: row.base!.step_order, to: row.target.step_order } : undefined}
            />
            {row.changes.length > 0 && (
              <ul className="mt-2 space-y-1">
                {row.changes.map(c => (
                  <li key={c.label} className="text-xs">
                    <span className="font-medium text-gray-600">{c.label}:</span>{' '}
                    <span className="text-rose-700 line-through decoration-rose-300">{c.from}</span>
                    <span className="text-gray-400 mx-1">→</span>
                    <span className="text-emerald-800 font-medium">{c.to}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="text-xs text-gray-300 italic py-2">— removed in this version —</p>
        )}
      </div>
    </div>
  );
}

function StepCard({
  step, tone, showParams, moved,
}: {
  step: WIStep;
  tone: 'plain' | 'added' | 'removed' | 'modified';
  showParams?: boolean;
  moved?: { from: number; to: number };
}) {
  const params = showParams ? authoredParams(step) : [];
  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className={cn(
          'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold shrink-0',
          tone === 'added'    ? 'bg-emerald-100 text-emerald-700' :
          tone === 'removed'  ? 'bg-rose-100 text-rose-600' :
          tone === 'modified' ? 'bg-amber-100 text-amber-700' :
                                'bg-gray-100 text-gray-500'
        )}>
          {step.step_order}
        </span>
        <span className={cn(
          'text-sm font-medium',
          tone === 'removed' ? 'text-rose-700 line-through decoration-rose-300' : 'text-gray-900'
        )}>
          {step.name}
        </span>
        <span className="text-[10px] text-gray-400 uppercase tracking-wide">{labelize(stepTypeOf(step))}</span>
        {tone === 'added' && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">NEW</span>
        )}
        {moved && (
          <span
            className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700"
            title={`Moved from position ${moved.from} to ${moved.to}`}
          >
            <MoveVertical size={10} /> #{moved.from} → #{moved.to}
          </span>
        )}
      </div>
      {step.description && (
        <p className="text-xs text-gray-500 mt-0.5 ml-7">{step.description}</p>
      )}
      {params.length > 0 && (
        <ul className="mt-1.5 ml-7 space-y-0.5">
          {params.map(p => (
            <li key={p.label} className="text-xs text-gray-600">
              <span className="text-gray-400">{p.label}:</span> {p.value}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
