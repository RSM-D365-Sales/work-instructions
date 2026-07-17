import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { WIStep, ReagentItem, StepType } from '../types';
import { cn } from '../lib/utils';
import { GHS_LABELS, GHS_COLORS } from '../lib/ghs';
import {
  Beaker, FlaskConical, Package, Wrench, ChevronDown, ChevronRight, AlertTriangle,
} from 'lucide-react';

/** One aggregated material line, rolled up across every step that consumes it. */
interface MaterialLine {
  key: string;
  itemId?: string;
  itemNumber?: string;
  name: string;
  quantity: number | null;   // null = no fixed amount anywhere (e.g. Q.S. only)
  unit: string;
  asNeeded: boolean;         // at least one step used it without a quantity (Q.S.)
  weighed: boolean;
  steps: number[];           // 1-based step numbers that consume it
  item?: ReagentItem;
}

const NUM = (v: unknown): number | null => {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000));

/** Roll the WI's steps up into a bill of materials.
 *  Reads the same parameter shapes the execution widgets render from:
 *    gather_reagents → reagents[]   ·   weigh → material_name/target_weight
 *    gather_inputs (legacy) → inputs[]   ·   gather_equipment → equipment[] */
function buildMaterials(steps: WIStep[]): { materials: MaterialLine[]; equipment: { name: string; notes?: string; steps: number[] }[] } {
  const byKey = new Map<string, MaterialLine>();
  const equipByName = new Map<string, { name: string; notes?: string; steps: number[] }>();

  function add(
    stepNo: number,
    raw: { itemId?: string; itemNumber?: string; name: string; quantity: number | null; unit: string; weighed?: boolean }
  ) {
    if (!raw.name?.trim()) return;
    // Aggregate on the catalog identity when there is one, else the name — and
    // always on the unit, so 400 mL and 1 Bottle never sum into nonsense.
    const id = raw.itemNumber || raw.itemId || raw.name.trim().toLowerCase();
    const key = `${id}::${raw.unit}`;
    const cur = byKey.get(key);
    if (cur) {
      if (raw.quantity == null) cur.asNeeded = true;
      else cur.quantity = (cur.quantity ?? 0) + raw.quantity;
      cur.weighed = cur.weighed || !!raw.weighed;
      if (!cur.steps.includes(stepNo)) cur.steps.push(stepNo);
    } else {
      byKey.set(key, {
        key,
        itemId: raw.itemId,
        itemNumber: raw.itemNumber,
        name: raw.name.trim(),
        quantity: raw.quantity,
        unit: raw.unit,
        asNeeded: raw.quantity == null,
        weighed: !!raw.weighed,
        steps: [stepNo],
      });
    }
  }

  steps.forEach((s, i) => {
    const p = (s.parameters ?? {}) as Record<string, unknown>;
    const type = (p._step_type ?? 'custom') as StepType;
    const stepNo = i + 1;

    if (type === 'gather_reagents') {
      const rows = (p.reagents ?? []) as Record<string, unknown>[];
      for (const r of rows) {
        add(stepNo, {
          itemId:     r.item_id as string | undefined,
          itemNumber: r.item_number as string | undefined,
          name:       (r.product_name as string) ?? '',
          quantity:   NUM(r.quantity),
          unit:       (r.unit as string) ?? '',
        });
      }
    } else if (type === 'weigh') {
      add(stepNo, {
        itemId:   p.material_id as string | undefined,
        name:     (p.material_name as string) ?? '',
        quantity: NUM(p.target_weight),
        unit:     (p.unit as string) ?? 'g',
        weighed:  true,
      });
    } else if (type === 'gather_inputs') {
      // Legacy step type — still present on older saved WIs.
      const rows = (p.inputs ?? []) as Record<string, unknown>[];
      for (const r of rows) {
        add(stepNo, {
          itemId:   r.material_id as string | undefined,
          name:     (r.material_name as string) ?? '',
          quantity: NUM(r.quantity),
          unit:     (r.unit as string) ?? '',
        });
      }
    } else if (type === 'gather_equipment') {
      const rows = (p.equipment ?? []) as Record<string, unknown>[];
      for (const r of rows) {
        const name = ((r.name as string) ?? '').trim();
        if (!name) continue;
        const cur = equipByName.get(name.toLowerCase());
        if (cur) { if (!cur.steps.includes(stepNo)) cur.steps.push(stepNo); }
        else equipByName.set(name.toLowerCase(), { name, notes: (r.notes as string) || undefined, steps: [stepNo] });
      }
    }
  });

  return { materials: [...byKey.values()], equipment: [...equipByName.values()] };
}

export default function OrderMaterialsSummary({ steps }: { steps: WIStep[] }) {
  const [open, setOpen] = useState(true);

  const { materials, equipment } = useMemo(() => buildMaterials(steps), [steps]);

  // Enrich with the catalog: item type (chemical vs container) + hazards.
  const itemNumbers = useMemo(
    () => [...new Set(materials.map(m => m.itemNumber).filter((v): v is string => !!v))].sort(),
    [materials]
  );
  const { data: catalog = [] } = useQuery<ReagentItem[]>({
    queryKey: ['materials-catalog', itemNumbers.join(',')],
    enabled: itemNumbers.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reagent_items')
        .select('id, item_number, product_name, item_type, unit_of_measure, hazard_class, ghs_pictograms, lot_controlled, storage_conditions')
        .in('item_number', itemNumbers);
      if (error) throw error;
      return (data ?? []) as ReagentItem[];
    },
  });

  const byNumber = useMemo(() => {
    const m = new Map<string, ReagentItem>();
    for (const r of catalog) m.set(r.item_number, r);
    return m;
  }, [catalog]);

  const enriched = materials.map(m => ({ ...m, item: m.itemNumber ? byNumber.get(m.itemNumber) : undefined }));

  // Split the way the bench thinks about it: what goes in the product vs what
  // holds it. Packaging is PKG in the catalog; anything else (or unknown) is
  // treated as a chemical, since an unclassified item is far more likely to be
  // a reagent than a bottle.
  const chemicals = enriched.filter(m => m.item?.item_type !== 'PKG');
  const containers = enriched.filter(m => m.item?.item_type === 'PKG');

  if (enriched.length === 0 && equipment.length === 0) return null;

  const hazardous = chemicals.filter(m => (m.item?.ghs_pictograms?.length ?? 0) > 0 || m.item?.hazard_class);

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-5 py-3.5 border-b border-gray-100 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
      >
        <Beaker size={18} className="text-indigo-600 shrink-0" />
        <h2 className="font-semibold text-gray-800">Materials</h2>
        <span className="text-xs text-gray-400">
          {chemicals.length} chemical{chemicals.length === 1 ? '' : 's'}
          {containers.length > 0 && ` · ${containers.length} container${containers.length === 1 ? '' : 's'}`}
          {equipment.length > 0 && ` · ${equipment.length} equipment`}
        </span>
        {hazardous.length > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700">
            <AlertTriangle size={11} /> {hazardous.length} hazardous
          </span>
        )}
        <span className="ml-auto text-gray-400 shrink-0">
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>
      </button>

      {open && (
        <div className="divide-y divide-gray-100">
          {chemicals.length > 0 && (
            <MaterialTable
              title="Chemicals & Reagents"
              icon={<FlaskConical size={13} className="text-emerald-600" />}
              rows={chemicals}
            />
          )}
          {containers.length > 0 && (
            <MaterialTable
              title="Containers & Consumables"
              icon={<Package size={13} className="text-sky-600" />}
              rows={containers}
            />
          )}
          {equipment.length > 0 && (
            <div className="px-5 py-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                <Wrench size={13} className="text-gray-500" /> Equipment
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {equipment.map(e => (
                  <li
                    key={e.name}
                    title={e.notes}
                    className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-700"
                  >
                    {e.name}
                    <span className="ml-1 text-gray-400">· step {e.steps.join(', ')}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="px-5 py-2 text-[11px] text-gray-400">
            Totals are rolled up from this work instruction's steps — amounts are per batch as authored.
          </p>
        </div>
      )}
    </div>
  );
}

function MaterialTable({ title, icon, rows }: { title: string; icon: React.ReactNode; rows: MaterialLine[] }) {
  return (
    <div className="px-5 py-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
        {icon} {title}
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase text-gray-400">
            <th className="text-left font-medium py-1">Material</th>
            <th className="text-left font-medium py-1">Description</th>
            <th className="text-right font-medium py-1">Amount</th>
            <th className="text-left font-medium py-1 pl-3">Units</th>
            <th className="text-right font-medium py-1">Step</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {rows.map(m => (
            <tr key={m.key} className="align-top">
              <td className="py-1.5 font-mono text-xs text-gray-500 whitespace-nowrap">
                {m.itemNumber ?? '—'}
              </td>
              <td className="py-1.5 pr-3">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-gray-900">{m.name}</span>
                  {m.weighed && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-100 text-violet-700 uppercase tracking-wide">
                      Weigh
                    </span>
                  )}
                  {m.item?.lot_controlled && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-teal-100 text-teal-700 uppercase tracking-wide">
                      Lot
                    </span>
                  )}
                  {(m.item?.ghs_pictograms ?? []).map(code => (
                    <span
                      key={code}
                      title={GHS_LABELS[code] ?? code}
                      className={cn('px-1.5 py-0.5 rounded text-[10px] font-semibold', GHS_COLORS[code] ?? 'bg-gray-100 text-gray-700')}
                    >
                      {GHS_LABELS[code] ?? code}
                    </span>
                  ))}
                </div>
                {m.item?.storage_conditions && (
                  <p className="text-[11px] text-gray-400 mt-0.5">{m.item.storage_conditions}</p>
                )}
              </td>
              <td className="py-1.5 text-right text-gray-900 tabular-nums whitespace-nowrap">
                {m.quantity != null ? fmtQty(m.quantity) : <span className="text-gray-400">—</span>}
                {m.asNeeded && m.quantity != null && <span className="text-gray-400"> +</span>}
              </td>
              <td className="py-1.5 pl-3 text-gray-500 whitespace-nowrap">
                {m.unit}
                {m.asNeeded && <span className="text-[10px] text-gray-400 ml-1">as needed</span>}
              </td>
              <td className="py-1.5 text-right text-gray-400 text-xs whitespace-nowrap">{m.steps.join(', ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
