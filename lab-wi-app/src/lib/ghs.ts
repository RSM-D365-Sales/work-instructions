/** GHS hazard pictogram codes — shared by the Reagent Items catalog and the
 *  production order materials summary. */
export const GHS_LABELS: Record<string, string> = {
  GHS01: 'Explosive',
  GHS02: 'Flammable',
  GHS03: 'Oxidising',
  GHS04: 'Compressed Gas',
  GHS05: 'Corrosive',
  GHS06: 'Toxic',
  GHS07: 'Harmful/Irritant',
  GHS08: 'Health Hazard',
  GHS09: 'Environmental',
};

export const GHS_COLORS: Record<string, string> = {
  GHS01: 'bg-red-100 text-red-800',
  GHS02: 'bg-orange-100 text-orange-800',
  GHS03: 'bg-yellow-100 text-yellow-800',
  GHS04: 'bg-blue-100 text-blue-800',
  GHS05: 'bg-purple-100 text-purple-800',
  GHS06: 'bg-red-100 text-red-900',
  GHS07: 'bg-amber-100 text-amber-800',
  GHS08: 'bg-pink-100 text-pink-800',
  GHS09: 'bg-green-100 text-green-800',
};
