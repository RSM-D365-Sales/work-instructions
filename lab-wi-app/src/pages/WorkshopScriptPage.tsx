import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { cn } from '../lib/utils';
import {
  SCRIPT_SLUG, META, INTRO_LEDE, PRE_SECTIONS, SCHEDULE, APPENDICES,
  type Node as ScriptNode, type Block, type Section,
} from '../data/workshopScriptDay1';
import {
  Printer, Link2, Check, Loader2, CloudOff, NotebookPen, Users2,
} from 'lucide-react';

// ── Shared notes ────────────────────────────────────────────────────────────
// Notes live in Supabase rather than localStorage: whoever prepares the script
// the night before types once, and every facilitator opening the URL sees the
// same notes on their own device. Realtime keeps co-editors in sync.

type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

interface StoredNote {
  body: string;
  editor: string | null;
  updatedAt: string | null;
}

export interface NoteRow extends StoredNote {
  status: SaveStatus;
}

const SAVE_DEBOUNCE_MS = 700;
const NOTES_KEY = ['workshop-notes', SCRIPT_SLUG];

type NoteMap = Record<string, StoredNote>;

function useWorkshopNotes() {
  const { profile } = useAuth();
  const qc = useQueryClient();

  // Server state. Realtime invalidates this so co-editors' changes land live.
  const { data: stored = {}, isLoading, isError } = useQuery<NoteMap>({
    queryKey: NOTES_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workshop_notes')
        .select('section_key, body, updated_at, editor:profiles!workshop_notes_updated_by_fkey(full_name)')
        .eq('script_slug', SCRIPT_SLUG);
      if (error) throw error;
      const map: NoteMap = {};
      for (const r of data ?? []) {
        const ed = r.editor as { full_name?: string } | { full_name?: string }[] | null;
        map[r.section_key as string] = {
          body: (r.body as string) ?? '',
          editor: Array.isArray(ed) ? ed[0]?.full_name ?? null : ed?.full_name ?? null,
          updatedAt: (r.updated_at as string) ?? null,
        };
      }
      return map;
    },
  });

  // Local edits in flight. A draft always wins over server state for that box,
  // so an incoming realtime refresh can never overwrite what someone is typing.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Record<string, SaveStatus>>({});
  const dirtyRef = useRef<Set<string>>(new Set());
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    const ch = supabase
      .channel('workshop-notes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workshop_notes' }, () => {
        void qc.invalidateQueries({ queryKey: NOTES_KEY });
      })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [qc]);

  const save = useCallback(async (key: string, body: string) => {
    if (!profile) return;
    setStatus(s => ({ ...s, [key]: 'saving' }));
    const { error } = await supabase
      .from('workshop_notes')
      .upsert(
        { script_slug: SCRIPT_SLUG, section_key: key, body, updated_by: profile.id },
        { onConflict: 'script_slug,section_key' },
      );
    if (error) {
      setStatus(s => ({ ...s, [key]: 'error' }));
      return;
    }
    dirtyRef.current.delete(key);
    // Seed the cache with what we just wrote, then drop the draft — the box keeps
    // showing the same text, so handing control back to server state can't flicker.
    qc.setQueryData<NoteMap>(NOTES_KEY, prev => ({
      ...(prev ?? {}),
      [key]: { body, editor: profile.full_name ?? null, updatedAt: new Date().toISOString() },
    }));
    setDrafts(d => { const rest = { ...d }; delete rest[key]; return rest; });
    setStatus(s => ({ ...s, [key]: 'saved' }));
  }, [profile, qc]);

  const change = useCallback((key: string, body: string) => {
    dirtyRef.current.add(key);
    setDrafts(d => ({ ...d, [key]: body }));
    setStatus(s => ({ ...s, [key]: 'dirty' }));
    clearTimeout(timersRef.current[key]);
    timersRef.current[key] = setTimeout(() => { void save(key, body); }, SAVE_DEBOUNCE_MS);
  }, [save]);

  /** Write immediately — used on blur so nothing is lost when attention moves. */
  const flush = useCallback((key: string) => {
    if (!dirtyRef.current.has(key)) return;
    clearTimeout(timersRef.current[key]);
    void save(key, drafts[key] ?? '');
  }, [save, drafts]);

  // Last line of defence against closing the tab mid-edit.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current.size > 0) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  const rowFor = useCallback((key: string): NoteRow => {
    const s = stored[key];
    const draft = drafts[key];
    return {
      body: draft !== undefined ? draft : s?.body ?? '',
      status: status[key] ?? 'idle',
      editor: s?.editor ?? null,
      updatedAt: s?.updatedAt ?? null,
    };
  }, [stored, drafts, status]);

  return { rowFor, loaded: !isLoading, offline: isError, change, flush };
}

// ── Note box ────────────────────────────────────────────────────────────────

interface NoteBoxProps {
  noteKey: string;
  label: string;
  row: NoteRow;
  onChange: (key: string, body: string) => void;
  onBlur: (key: string) => void;
}

function NoteBox({ noteKey, label, row, onChange, onBlur }: NoteBoxProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Grow to fit so nothing is hidden behind a scrollbar — and so it prints whole.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight, 76)}px`;
  }, [row.body]);

  return (
    <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50/60 p-3 print:bg-white">
      <div className="mb-1.5 flex items-center gap-2">
        <NotebookPen size={13} className="text-amber-700" />
        <span className="text-[11px] font-bold uppercase tracking-wider text-amber-800">{label}</span>
        <span className="ml-auto flex items-center gap-1.5 text-[11px] text-amber-700/80 print:hidden">
          {row.status === 'saving' && <><Loader2 size={11} className="animate-spin" /> Saving…</>}
          {row.status === 'saved' && <><Check size={11} /> Saved</>}
          {row.status === 'dirty' && <span className="text-amber-600">Unsaved…</span>}
          {row.status === 'error' && <span className="font-semibold text-red-600">Not saved — check connection</span>}
          {row.status === 'idle' && row.editor && <span>Last edit by {row.editor}</span>}
        </span>
      </div>
      <textarea
        ref={ref}
        value={row.body}
        onChange={e => onChange(noteKey, e.target.value)}
        onBlur={() => onBlur(noteKey)}
        rows={3}
        placeholder="Notes for the team — who leads, what to emphasise, what to skip…"
        className="w-full resize-none rounded-md border border-amber-200 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-amber-700/40 focus:outline-none focus:ring-2 focus:ring-amber-400"
      />
    </div>
  );
}

// ── Content renderer ────────────────────────────────────────────────────────

const PART_STYLES = {
  overview: 'text-blue-700',
  hands: 'text-emerald-700',
  qa: 'text-amber-700',
} as const;

const CALLOUT_STYLES = {
  warn: 'bg-amber-50 border-amber-200 text-amber-900',
  info: 'bg-blue-50 border-blue-200 text-blue-900',
  stop: 'bg-red-50 border-red-200 text-red-900',
} as const;

function html(s: string) {
  return { __html: s };
}

function Nodes({ nodes }: { nodes: ScriptNode[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.t) {
          case 'p':
            return <p key={i} className="mt-2 text-[14.5px] text-gray-600" dangerouslySetInnerHTML={html(n.html)} />;
          case 'h':
            return <h4 key={i} className="mt-5 text-[15px] font-bold text-gray-900" dangerouslySetInnerHTML={html(n.html)} />;
          case 'say':
            return (
              <div key={i} className="my-3 rounded-r-lg border-l-[3px] border-blue-400 bg-blue-50 px-4 py-2.5">
                <span className="mr-1 text-[10.5px] font-bold tracking-widest text-blue-500">SAY</span>
                <span className="text-[14.5px] italic text-blue-900" dangerouslySetInnerHTML={html(n.html)} />
              </div>
            );
          case 'do':
            return (
              <div key={i} className="my-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5">
                <div className="mb-1 text-[10.5px] font-bold tracking-widest text-gray-400">DO</div>
                <div className="text-sm text-gray-600" dangerouslySetInnerHTML={html(n.html)} />
              </div>
            );
          case 'ul':
            return (
              <ul key={i} className="mt-2 list-disc space-y-1.5 pl-5 text-[14.5px] text-gray-600">
                {n.items.map((it, j) => <li key={j} dangerouslySetInnerHTML={html(it)} />)}
              </ul>
            );
          case 'callout':
            return (
              <div key={i} className={cn('mt-3.5 rounded-lg border px-4 py-3 text-sm', CALLOUT_STYLES[n.kind])}>
                <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider">{n.title}</span>
                <span dangerouslySetInnerHTML={html(n.html)} />
              </div>
            );
          case 'table':
            return (
              <div key={i} className="mt-3 overflow-x-auto">
                <table className="w-full border-collapse text-[13.5px]">
                  <thead>
                    <tr>
                      {n.head.map((h, j) => (
                        <th key={j} className={cn(
                          'border border-gray-200 bg-gray-100 px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-600',
                          j === 0 ? 'text-left' : n.matrix ? 'text-center' : 'text-left',
                        )}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {n.rows.map((r, j) => (
                      <tr key={j} className={j % 2 ? 'bg-gray-50/60' : undefined}>
                        {r.map((c, k) => {
                          if (n.matrix && k > 0) {
                            return (
                              <td key={k} className={cn(
                                'border border-gray-200 px-2.5 py-1.5 text-center font-bold',
                                c === '1' ? 'text-emerald-600' : 'text-gray-300',
                              )}>{c === '1' ? '✓' : '·'}</td>
                            );
                          }
                          return (
                            <td key={k} className="border border-gray-200 px-2.5 py-1.5 align-top text-gray-600"
                                dangerouslySetInnerHTML={html(c)} />
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case 'part':
            return (
              <div key={i} className="mt-5">
                <div className={cn('mb-2 text-[12px] font-bold uppercase tracking-wider', PART_STYLES[n.kind])}>
                  {n.label}
                </div>
                {n.roles && (
                  <div className="mb-2.5 flex flex-wrap gap-2">
                    {n.roles.map(r => (
                      <span key={r} className="rounded-full bg-blue-50 px-3 py-1 text-[12.5px] font-semibold text-blue-700">{r}</span>
                    ))}
                  </div>
                )}
                <Nodes nodes={n.nodes} />
              </div>
            );
        }
      })}
    </>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

const JUMP = [
  { id: 'preflight', label: 'Pre-flight' },
  { id: 'rhythm', label: 'Rhythm' },
  { id: 'b1', label: '10:00 Roles' },
  { id: 'b2', label: '11:20 Work Instructions' },
  { id: 'b3', label: '1:15 Execution' },
  { id: 'b4', label: '2:25 Planning' },
  { id: 'b5', label: '2:45 Wrap-up' },
  { id: 'matrix', label: 'Role matrix' },
  { id: 'recovery', label: 'Recovery' },
  { id: 'day2', label: 'Day 2' },
];

export default function WorkshopScriptPage() {
  const { rowFor, loaded, offline, change, flush } = useWorkshopNotes();
  const [copied, setCopied] = useState(false);

  const noteFor = rowFor;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked — the URL bar still works */ }
  }

  function renderSection(s: Section) {
    return (
      <section key={s.key} id={s.key} className="mt-10 scroll-mt-20">
        <h2 className="mb-4 flex items-center gap-2.5 text-xl font-bold text-gray-900">
          <span className="h-5 w-1.5 rounded bg-emerald-700" />
          {s.title}
        </h2>
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <Nodes nodes={s.nodes} />
          {s.noteKey && (
            <NoteBox
              noteKey={s.noteKey} label={`Notes — ${s.title.split('—')[0].trim()}`}
              row={noteFor(s.noteKey)} onChange={change} onBlur={flush}
            />
          )}
        </div>
      </section>
    );
  }

  function renderBlock(b: Block) {
    return (
      <div key={b.key} id={b.key} className="mb-5 scroll-mt-20 overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="flex flex-wrap items-baseline gap-4 border-b border-gray-200 bg-slate-50/70 px-5 py-4">
          <span className="text-lg font-bold tabular-nums text-emerald-700">{b.time}</span>
          <h3 className="flex-1 basis-64 text-[17px] font-bold text-gray-900">{b.title}</h3>
          <span className="text-[12.5px] text-gray-400">{b.dur}</span>
          <span className="text-[13px] text-gray-500">RSM Lead: <b className="tracking-widest">________</b></span>
        </div>
        <div className="px-5 pb-5 pt-2">
          <div className="my-3 rounded-r-lg border-l-[3px] border-emerald-600 bg-emerald-50 px-3.5 py-2.5 text-[14.5px] text-emerald-900"
               dangerouslySetInnerHTML={html(b.goal)} />

          <table className="mt-3 w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="w-[104px] border-b border-gray-200 pb-1.5 pr-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-400">Clock</th>
                <th className="hidden w-[92px] border-b border-gray-200 pb-1.5 pr-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-400 sm:table-cell">Who</th>
                <th className="border-b border-gray-200 pb-1.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-400">What happens</th>
              </tr>
            </thead>
            <tbody>
              {b.run.map((r, i) => (
                <tr key={i}>
                  <td className="border-b border-gray-100 py-2 pr-2.5 align-top text-[13.5px] font-bold tabular-nums text-emerald-700">{r.clock}</td>
                  <td className="hidden border-b border-gray-100 py-2 pr-2.5 align-top text-xs text-gray-500 sm:table-cell">{r.who}</td>
                  <td className="border-b border-gray-100 py-2 align-top text-gray-600" dangerouslySetInnerHTML={html(r.what)} />
                </tr>
              ))}
            </tbody>
          </table>

          <Nodes nodes={b.nodes} />

          {b.cut && (
            <div className="mt-4 rounded-lg border border-dashed border-gray-300 bg-slate-50/70 px-4 py-3 text-[13.5px] text-gray-600">
              <b className="mb-1 block text-[11px] uppercase tracking-wider text-red-600">{b.cut.title}</b>
              <span dangerouslySetInnerHTML={html(b.cut.html)} />
            </div>
          )}

          <NoteBox
            noteKey={b.key} label={`Notes — ${b.time} ${b.title}`}
            row={noteFor(b.key)} onChange={change} onBlur={flush}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="wsdoc mx-auto max-w-4xl pb-16">
      {/* Styles for the authored HTML fragments + print behaviour */}
      <style>{`
        .wsdoc b{color:#1c2430;font-weight:600}
        .wsdoc .path{font-family:ui-monospace,Consolas,monospace;font-size:.88em;background:#eef2f7;
          border:1px solid #dde4ed;border-radius:4px;padding:1px 6px;color:#31465f;white-space:nowrap}
        .wsdoc .muted{color:#8492a6;font-weight:400}
        .wsdoc i{font-style:italic}
        @media print{
          .wsdoc textarea{border:1px solid #ccc!important;background:#fff!important;overflow:visible!important}
          .print\\:hidden{display:none!important}
        }
      `}</style>

      {/* Header */}
      <div className="flex flex-wrap items-start gap-3">
        <div className="rounded-lg bg-emerald-700 p-2 text-white"><NotebookPen size={20} /></div>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold text-gray-900">Solution Review Session — Day 1 Facilitator Script</h1>
          <p className="text-sm text-gray-500">Internal run-of-show · notes are shared with everyone who opens this page</p>
        </div>
        <div className="flex gap-2 print:hidden">
          <button onClick={copyLink}
                  className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
            {copied ? <Check size={15} className="text-emerald-600" /> : <Link2 size={15} />}
            {copied ? 'Copied' : 'Copy link'}
          </button>
          <button onClick={() => window.print()}
                  className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
            <Printer size={15} /> Print
          </button>
        </div>
      </div>

      {/* Jump nav */}
      <nav className="sticky top-0 z-20 -mx-2 mt-4 overflow-x-auto border-b border-gray-200 bg-white/95 px-2 py-2 backdrop-blur print:hidden">
        <div className="flex gap-1.5">
          {JUMP.map(j => (
            <a key={j.id} href={`#${j.id}`}
               className="flex-none whitespace-nowrap rounded-full bg-blue-50 px-3 py-1 text-[12.5px] font-semibold text-blue-700 hover:bg-blue-100">
              {j.label}
            </a>
          ))}
        </div>
      </nav>

      {/* Shared-notes banner */}
      <div className={cn(
        'mt-4 flex items-start gap-2 rounded-lg border px-4 py-3 text-sm print:hidden',
        offline ? 'border-red-200 bg-red-50 text-red-800' : 'border-blue-200 bg-blue-50 text-blue-900',
      )}>
        {offline ? <CloudOff size={15} className="mt-0.5 shrink-0" /> : <Users2 size={15} className="mt-0.5 shrink-0" />}
        <span>
          {offline ? (
            <><b>Notes aren’t loading.</b> The <code>workshop_notes</code> table may not exist yet — run migration
              <b> 057_workshop_notes.sql</b> in the Supabase SQL Editor. Anything you type now will not be saved.</>
          ) : (
            <><b>These notes are shared.</b> Type once and every facilitator who opens this URL sees them, on any device.
              Edits save automatically and appear live for anyone else reading.</>
          )}
        </span>
      </div>

      {/* Lede + meta */}
      <p className="mt-5 max-w-3xl text-[15px] text-gray-600" dangerouslySetInnerHTML={html(INTRO_LEDE)} />
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {META.map(m => (
          <div key={m.k} className="rounded-xl border border-gray-200 bg-white px-4 py-3">
            <div className="mb-1 text-[11.5px] font-medium uppercase tracking-wider text-gray-400">{m.k}</div>
            <div className="text-[15px] font-semibold text-gray-900">{m.v}</div>
            <small className="mt-0.5 block text-[12.5px] font-normal text-gray-500">{m.sub}</small>
          </div>
        ))}
      </div>

      {/* General notes */}
      <div className="mt-5 rounded-xl border border-gray-200 bg-white p-5">
        <NoteBox
          noteKey="general" label="Notes for the whole session"
          row={noteFor('general')} onChange={change} onBlur={flush}
        />
      </div>

      {!loaded && (
        <p className="mt-4 text-center text-sm text-gray-400">Loading shared notes…</p>
      )}

      {PRE_SECTIONS.map(renderSection)}

      <section className="mt-10">
        <h2 className="mb-4 flex items-center gap-2.5 text-xl font-bold text-gray-900">
          <span className="h-5 w-1.5 rounded bg-emerald-700" />
          Run of show — Day 1
        </h2>
        {SCHEDULE.map(item =>
          item.kind === 'lunch' ? (
            <div key="lunch" className="mb-5 rounded-xl border border-gray-200 bg-white px-5 py-4 text-center">
              <span className="font-bold tabular-nums text-emerald-700">{item.time}</span>
              <span className="ml-3 font-semibold text-gray-600">{item.label}</span>
              <p className="mt-2 text-[13.5px] text-gray-400">{item.note}</p>
            </div>
          ) : renderBlock(item),
        )}
      </section>

      {APPENDICES.map(renderSection)}

      <p className="mt-12 border-t border-gray-200 pt-5 text-center text-[12.5px] text-gray-400">
        Internal facilitator script — not for distribution to the client · Built from the agenda of July 22, 2026
      </p>
    </div>
  );
}
