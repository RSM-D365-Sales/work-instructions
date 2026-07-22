import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Wrench, AlertTriangle, TrendingUp, CheckCircle2, Activity } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { cn } from '../lib/utils';
import type { Scale } from '../types';
import FlagCalibrationModal from './FlagCalibrationModal';

/* ────────────────────────────────────────────────────────────────────────────
 * Equipment health — every instrument with QC results, ACROSS ALL PRODUCTS.
 *
 * The per-item instrument pivot on Quality Trends answers "how did this meter
 * do on this product"; a supervisor needs the opposite — "which instrument
 * should I be worried about", without checking each product in turn.
 *
 * Two signals, because out-of-spec alone is a lagging indicator:
 *   • out of spec — results that already failed (passed = false)
 *   • drift       — how close recent readings sit to their spec limit, and
 *                   whether that is getting worse. Catches a meter walking
 *                   toward a limit while every reading still passes.
 * ──────────────────────────────────────────────────────────────────────────── */

interface HealthRow {
  instrument: string | null;
  name: string;
  passed: boolean | null;
  result_numeric: number | null;
  lower_limit: number | null;
  upper_limit: number | null;
  tested_at: string | null;
}

/** Readings per trend window — the recent window is compared with the one before it. */
const WINDOW = 5;
/** |position| at or above this is "hugging the limit" (1.0 = exactly on the limit). */
const NEAR_LIMIT = 0.7;
/** Worsening by this much between windows, from a non-trivial base, is a trend. */
const TREND_DELTA = 0.15;
const TREND_FLOOR = 0.4;

type Status = 'out_of_spec' | 'near_limit' | 'trending' | 'ok';

const STATUS_RANK: Record<Status, number> = {
  out_of_spec: 0, near_limit: 1, trending: 2, ok: 3,
};

const STATUS_STYLE: Record<Status, { label: string; className: string; icon: React.ReactNode }> = {
  out_of_spec: { label: 'Out of spec', className: 'bg-red-100 text-red-700',       icon: <AlertTriangle size={12} /> },
  near_limit:  { label: 'Near limit',  className: 'bg-amber-100 text-amber-700',   icon: <Activity size={12} /> },
  trending:    { label: 'Trending',    className: 'bg-yellow-100 text-yellow-800', icon: <TrendingUp size={12} /> },
  ok:          { label: 'In control',  className: 'bg-emerald-100 text-emerald-700', icon: <CheckCircle2 size={12} /> },
};

/** Where a reading sits in its spec: 0 = dead centre, ±1 = exactly on a limit. */
function position(r: HealthRow): number | null {
  if (r.result_numeric == null || r.lower_limit == null || r.upper_limit == null) return null;
  const half = (r.upper_limit - r.lower_limit) / 2;
  if (!(half > 0)) return null;
  const centre = (r.lower_limit + r.upper_limit) / 2;
  return (r.result_numeric - centre) / half;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export default function EquipmentHealthSummary() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [flagTarget, setFlagTarget] = useState<{ label: string; scaleId: string } | null>(null);

  // Every QC result that named an instrument, oldest first (the trend windows
  // depend on the ordering).
  const { data: results = [], isLoading } = useQuery<HealthRow[]>({
    queryKey: ['equipment-health'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('qc_results')
        .select('instrument, name, passed, result_numeric, lower_limit, upper_limit, tested_at')
        .not('instrument', 'is', null)
        .order('tested_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as HealthRow[];
    },
  });

  const { data: scales = [] } = useQuery<Scale[]>({
    queryKey: ['scales'],
    queryFn: async () => {
      const { data, error } = await supabase.from('scales').select('*').order('name');
      if (error) throw error;
      return data as Scale[];
    },
  });

  /** Exact-match a free-text instrument label against the equipment master. */
  function matchScale(key: string): Scale | undefined {
    return scales.find(s =>
      s.name.trim().toLowerCase() === key ||
      (s.serial_number ?? '').trim().toLowerCase() === key ||
      (s.barcode ?? '').trim().toLowerCase() === key
    );
  }

  const rows = useMemo(() => {
    const byInstrument = new Map<string, { label: string; items: HealthRow[] }>();
    for (const r of results) {
      const label = (r.instrument ?? '').trim();
      if (!label) continue;
      const key = label.toLowerCase();
      const bucket = byInstrument.get(key);
      if (bucket) bucket.items.push(r);
      else byInstrument.set(key, { label, items: [r] });
    }

    return Array.from(byInstrument.entries()).map(([key, { label, items }]) => {
      const oos = items.filter(r => r.passed === false).length;
      const positions = items.map(position).filter((p): p is number => p != null);
      const recent = positions.slice(-WINDOW).map(Math.abs);
      const prior  = positions.slice(-2 * WINDOW, -WINDOW).map(Math.abs);
      const driftNow  = mean(recent);
      const driftPrior = mean(prior);
      const worst = positions.length ? Math.max(...positions.map(Math.abs)) : null;

      // Which test is the one drifting — the supervisor's next question.
      let worstTest: string | null = null;
      let worstAbs = -1;
      for (const r of items) {
        const p = position(r);
        if (p != null && Math.abs(p) > worstAbs) { worstAbs = Math.abs(p); worstTest = r.name; }
      }

      const status: Status =
        oos > 0                                   ? 'out_of_spec'
        : driftNow != null && driftNow >= NEAR_LIMIT ? 'near_limit'
        : driftNow != null && driftPrior != null
          && driftNow - driftPrior >= TREND_DELTA
          && driftNow >= TREND_FLOOR              ? 'trending'
                                                  : 'ok';

      const lastAt = items.reduce<string | null>(
        (acc, r) => (r.tested_at && (!acc || r.tested_at > acc) ? r.tested_at : acc), null
      );

      return {
        key, label, readings: items.length, oos, driftNow, worst, worstTest, lastAt,
        status, scale: matchScale(key),
      };
    }).sort((a, b) =>
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      (b.driftNow ?? 0) - (a.driftNow ?? 0) ||
      a.label.localeCompare(b.label)
    );
  }, [results, scales]);

  const attention = rows.filter(r => r.status !== 'ok').length;

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-4 text-sm text-gray-400">
        Loading equipment health…
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="p-4 border-b border-gray-100 flex items-center gap-2 flex-wrap">
        <Wrench size={16} className="text-gray-500" />
        <h2 className="font-semibold text-gray-900 text-sm">Equipment health</h2>
        <span className="text-xs text-gray-400">across all products</span>
        {attention > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
            <AlertTriangle size={12} /> {attention} need{attention === 1 ? 's' : ''} review
          </span>
        )}
        <span className="text-xs text-gray-400 ml-auto">
          Drift = how close recent readings sit to their spec limit (100% = on the limit)
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-gray-400">
          No QC results have a recorded instrument yet — capture the instrument on a QC
          result and it will appear here.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-600">
                <th className="text-left  px-4 py-2.5 font-medium">Instrument</th>
                <th className="text-left  px-4 py-2.5 font-medium">Status</th>
                <th className="text-right px-4 py-2.5 font-medium">Readings</th>
                <th className="text-right px-4 py-2.5 font-medium">Out of spec</th>
                <th className="text-right px-4 py-2.5 font-medium">Recent drift</th>
                <th className="text-left  px-4 py-2.5 font-medium">Closest test</th>
                <th className="text-left  px-4 py-2.5 font-medium">Last reading</th>
                <th className="text-left  px-4 py-2.5 font-medium">Calibration</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map(r => {
                const style = STATUS_STYLE[r.status];
                return (
                  <tr key={r.key} className={cn(r.status !== 'ok' && 'bg-amber-50/30')}>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-gray-900">{r.label}</p>
                      {!r.scale && (
                        <p className="text-xs text-gray-300">no equipment record matched</p>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={cn(
                        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
                        style.className
                      )}>
                        {style.icon} {style.label}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-500 tabular-nums">{r.readings}</td>
                    <td className={cn(
                      'px-4 py-2.5 text-right tabular-nums',
                      r.oos > 0 ? 'text-red-600 font-semibold' : 'text-gray-400'
                    )}>
                      {r.oos}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">
                      {r.driftNow == null ? <span className="text-gray-300">—</span>
                        : `${Math.round(r.driftNow * 100)}%`}
                      {r.worst != null && (
                        <span className="block text-[10px] text-gray-400">
                          worst {Math.round(r.worst * 100)}%
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500">
                      {r.worstTest ?? <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500">
                      {r.lastAt ? new Date(r.lastAt).toLocaleDateString() : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      {r.scale?.calibration_flagged_at ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                          <Wrench size={12} /> Flagged {new Date(r.scale.calibration_flagged_at).toLocaleDateString()}
                        </span>
                      ) : isAdmin ? (
                        <button
                          onClick={() => setFlagTarget({ label: r.label, scaleId: r.scale?.id ?? '' })}
                          className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 hover:text-amber-900 hover:underline"
                        >
                          <Wrench size={12} /> Flag for calibration
                        </button>
                      ) : r.scale?.last_calibrated_at ? (
                        <span className="text-xs text-gray-400">
                          Calibrated {new Date(r.scale.last_calibrated_at).toLocaleDateString()}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {flagTarget && (
        <FlagCalibrationModal
          instrumentLabel={flagTarget.label}
          defaultScaleId={flagTarget.scaleId}
          scales={scales}
          context="the equipment health review"
          onClose={() => setFlagTarget(null)}
        />
      )}
    </div>
  );
}
