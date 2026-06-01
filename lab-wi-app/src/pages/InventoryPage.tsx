import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { InventoryOnHand, ItemType, Lab } from '../types';
import { cn } from '../lib/utils';
import { Boxes, Search, X, RefreshCw, Layers, Building2, Package } from 'lucide-react';

// ─── Item-type presentation ──────────────────────────────────────────────────
const TYPE_LABELS: Record<ItemType, string> = {
  FG: 'Finished Good',
  RM: 'Raw Material',
  PKG: 'Packaging',
};

const TYPE_BADGE: Record<ItemType, string> = {
  FG: 'bg-emerald-100 text-emerald-800',
  RM: 'bg-amber-100 text-amber-800',
  PKG: 'bg-purple-100 text-purple-800',
};

type TypeFilter = 'ALL' | ItemType;
type GroupMode = 'lab' | 'item';

const num = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

// A flattened, display-ready inventory line.
interface Line {
  key: string;
  itemId: string;
  itemNumber: string;
  productName: string;
  itemType: ItemType;
  uom: string;
  labLabel: string;          // single lab name, or "N labs" when grouped by item
  physical: number;
  reserved: number;
  orderedIn: number;
  onOrder: number;
}

const availablePhysical = (l: Line) => l.physical - l.reserved;
const totalAvailable = (l: Line) => availablePhysical(l) + l.orderedIn + l.onOrder;

export default function InventoryPage() {
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');
  const [labFilter, setLabFilter] = useState<string>('ALL');
  const [group, setGroup] = useState<GroupMode>('lab');
  const [search, setSearch] = useState('');

  const { data: rows = [], isLoading } = useQuery<InventoryOnHand[]>({
    queryKey: ['inventory-on-hand'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_on_hand')
        .select('*, reagent_item:reagent_items(id, item_number, product_name, item_type, unit_of_measure), lab:labs(id, name, warehouse_id)');
      if (error) throw error;
      return data as InventoryOnHand[];
    },
  });

  const { data: labs = [] } = useQuery<Lab[]>({
    queryKey: ['labs-active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('labs')
        .select('*')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data as Lab[];
    },
  });

  // Most-recent "sync" timestamp, to sell the D365 story.
  const lastSync = useMemo(() => {
    let max = 0;
    for (const r of rows) {
      const t = new Date(r.d365_synced_at).getTime();
      if (t > max) max = t;
    }
    return max ? new Date(max) : null;
  }, [rows]);

  // Apply type + lab + search filters to the raw rows first.
  const filteredRows = useMemo(() => {
    const q = search.toLowerCase().trim();
    return rows.filter(r => {
      const item = r.reagent_item;
      if (!item) return false;
      if (typeFilter !== 'ALL' && item.item_type !== typeFilter) return false;
      if (labFilter !== 'ALL' && r.lab_id !== labFilter) return false;
      if (q) {
        const hit =
          item.item_number.toLowerCase().includes(q) ||
          item.product_name.toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [rows, typeFilter, labFilter, search]);

  // Build display lines, either per item×lab or aggregated per item.
  const lines = useMemo<Line[]>(() => {
    if (group === 'lab') {
      return filteredRows
        .map<Line>(r => ({
          key: r.id,
          itemId: r.reagent_item_id,
          itemNumber: r.reagent_item!.item_number,
          productName: r.reagent_item!.product_name,
          itemType: r.reagent_item!.item_type,
          uom: r.reagent_item!.unit_of_measure,
          labLabel: r.lab?.name ?? r.lab?.warehouse_id ?? '—',
          physical: r.physical_inventory,
          reserved: r.physical_reserved,
          orderedIn: r.ordered_in,
          onOrder: r.on_order,
        }))
        .sort((a, b) =>
          a.itemNumber.localeCompare(b.itemNumber) || a.labLabel.localeCompare(b.labLabel));
    }

    // Aggregate across labs, one line per item.
    const byItem = new Map<string, Line & { labIds: Set<string> }>();
    for (const r of filteredRows) {
      const item = r.reagent_item!;
      let acc = byItem.get(item.id);
      if (!acc) {
        acc = {
          key: item.id,
          itemId: item.id,
          itemNumber: item.item_number,
          productName: item.product_name,
          itemType: item.item_type,
          uom: item.unit_of_measure,
          labLabel: '',
          physical: 0, reserved: 0, orderedIn: 0, onOrder: 0,
          labIds: new Set<string>(),
        };
        byItem.set(item.id, acc);
      }
      acc.physical += r.physical_inventory;
      acc.reserved += r.physical_reserved;
      acc.orderedIn += r.ordered_in;
      acc.onOrder += r.on_order;
      acc.labIds.add(r.lab_id);
    }
    return [...byItem.values()]
      .map<Line>(a => ({ ...a, labLabel: `${a.labIds.size} lab${a.labIds.size !== 1 ? 's' : ''}` }))
      .sort((a, b) => a.itemNumber.localeCompare(b.itemNumber));
  }, [filteredRows, group]);

  // Type-filter pill counts (based on the lab + search filtered set, ignoring the type pill itself).
  const typeCounts = useMemo(() => {
    const base = rows.filter(r => {
      const item = r.reagent_item;
      if (!item) return false;
      if (labFilter !== 'ALL' && r.lab_id !== labFilter) return false;
      const q = search.toLowerCase().trim();
      if (q && !(item.item_number.toLowerCase().includes(q) || item.product_name.toLowerCase().includes(q)))
        return false;
      return true;
    });
    const items = (pred: (t: ItemType) => boolean) =>
      new Set(base.filter(r => pred(r.reagent_item!.item_type)).map(r => r.reagent_item_id)).size;
    return {
      ALL: items(() => true),
      FG: items(t => t === 'FG'),
      RM: items(t => t === 'RM'),
      PKG: items(t => t === 'PKG'),
    } as Record<TypeFilter, number>;
  }, [rows, labFilter, search]);

  const distinctItems = useMemo(() => new Set(lines.map(l => l.itemId)).size, [lines]);

  const PILLS: { key: TypeFilter; label: string }[] = [
    { key: 'ALL', label: 'All' },
    { key: 'FG', label: 'FG · Finished Goods' },
    { key: 'RM', label: 'RM · Raw Materials' },
    { key: 'PKG', label: 'PKG · Packaging' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Boxes size={24} className="text-blue-600" />
            On-hand Inventory
          </h1>
          <p className="text-sm text-gray-500 mt-1 flex items-center gap-1.5">
            <RefreshCw size={13} className="text-indigo-400" />
            Synced from D365 Finance &amp; Supply Chain
            {lastSync && (
              <span className="text-gray-400">· last sync {lastSync.toLocaleString()}</span>
            )}
          </p>
        </div>
      </div>

      {/* Type filter pills */}
      <div className="flex flex-wrap items-center gap-2">
        {PILLS.map(p => {
          const active = typeFilter === p.key;
          return (
            <button
              key={p.key}
              onClick={() => setTypeFilter(p.key)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors',
                active
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
              )}
            >
              {p.label}
              <span className={cn(
                'inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full text-xs font-semibold',
                active ? 'bg-white/25 text-white' : 'bg-gray-100 text-gray-500'
              )}>
                {typeCounts[p.key]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Secondary controls: search, lab filter, grouping */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[16rem] max-w-md">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by item # or product name…"
            className="w-full pl-9 pr-8 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="relative">
          <Building2 size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <select
            value={labFilter}
            onChange={e => setLabFilter(e.target.value)}
            className="pl-9 pr-8 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="ALL">All reagent labs</option>
            {labs.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>

        {/* Group-by toggle */}
        <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
          <button
            onClick={() => setGroup('lab')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 text-sm transition-colors',
              group === 'lab' ? 'bg-blue-50 text-blue-700' : 'bg-white text-gray-600 hover:bg-gray-50'
            )}
            title="One row per item per reagent lab"
          >
            <Layers size={14} /> By lab
          </button>
          <button
            onClick={() => setGroup('item')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 text-sm border-l border-gray-200 transition-colors',
              group === 'item' ? 'bg-blue-50 text-blue-700' : 'bg-white text-gray-600 hover:bg-gray-50'
            )}
            title="Aggregate across all labs, one row per item"
          >
            <Package size={14} /> By item
          </button>
        </div>

        <p className="text-sm text-gray-500 ml-auto">
          {distinctItems} item{distinctItems !== 1 ? 's' : ''} · {lines.length} line{lines.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="text-center py-12 text-gray-400">Loading…</div>
      ) : lines.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
          <Boxes size={36} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500">
            {rows.length === 0 ? 'No on-hand inventory found' : 'No inventory matches your filters'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-gray-600">
                  <th className="text-left px-4 py-3 font-medium whitespace-nowrap">Item #</th>
                  <th className="text-left px-4 py-3 font-medium">Product Name</th>
                  <th className="text-left px-4 py-3 font-medium">Type</th>
                  <th className="text-left px-4 py-3 font-medium whitespace-nowrap">Reagent Lab</th>
                  <th className="text-right px-4 py-3 font-medium whitespace-nowrap">Physical</th>
                  <th className="text-right px-4 py-3 font-medium whitespace-nowrap">Reserved</th>
                  <th className="text-right px-4 py-3 font-medium whitespace-nowrap">Ordered In</th>
                  <th className="text-right px-4 py-3 font-medium whitespace-nowrap">On Order</th>
                  <th className="text-right px-4 py-3 font-medium whitespace-nowrap bg-blue-50/60 text-blue-800">Total Available</th>
                  <th className="text-left px-3 py-3 font-medium">UoM</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {lines.map(l => {
                  const total = totalAvailable(l);
                  return (
                    <tr key={l.key} className="hover:bg-blue-50/40 transition-colors">
                      <td className="px-4 py-2.5 font-mono font-medium text-gray-900 whitespace-nowrap">{l.itemNumber}</td>
                      <td className="px-4 py-2.5 text-gray-800">{l.productName}</td>
                      <td className="px-4 py-2.5">
                        <span
                          className={cn('px-2 py-0.5 rounded-full text-xs font-semibold', TYPE_BADGE[l.itemType])}
                          title={TYPE_LABELS[l.itemType]}
                        >
                          {l.itemType}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{l.labLabel}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-gray-800">{num(l.physical)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">{num(l.reserved)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">{num(l.orderedIn)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">{num(l.onOrder)}</td>
                      <td className={cn(
                        'px-4 py-2.5 text-right tabular-nums font-semibold bg-blue-50/40',
                        total <= 0 ? 'text-red-600' : 'text-blue-800'
                      )}>
                        {num(total)}
                      </td>
                      <td className="px-3 py-2.5 text-gray-400">{l.uom}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="text-xs text-gray-400">
        Total Available = Physical inventory − Physical reserved + Ordered in + On order, per the D365
        on-hand calculation. Physical reserved is committed against open orders and is excluded from availability.
      </p>
    </div>
  );
}
