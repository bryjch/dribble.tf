import { loadManifest, ViewmodelManifest } from '@components/Scene/Viewmodel'

import itemNames from './itemNames.json'
import { CLASS_NAMES } from './scenario'

//
// ─── WEAPON CATALOG ─────────────────────────────────────────────────────────────
//
// Every weapon a class can hold, for the viewmodel browser: the viewmodel manifest's items
// (public/models/viewmodels/manifest.json, by item definition index) with their names and slots
// from TF2's items_game.txt (itemNames.json, written by scripts/debug/item-names.mjs), and the
// weapons that have no viewmodel built, flagged.
//

/** [name, slot per class], by item definition index. */
const NAMES = itemNames as unknown as Record<string, [string, Record<string, string>]>

/** Models known to be wrong in the viewer, and why. */
export const KNOWN_BROKEN: Record<number, string> = {
  1179: 'No bone in the weapon matches the arms: it floats where the model puts it',
  37: 'Failed to build (bsp-to-glb: "sequence layer start is not finite")',
  173: 'Failed to build (bsp-to-glb: "sequence layer start is not finite")',
  1003: 'Failed to build (bsp-to-glb: "sequence layer start is not finite")',
}

/** The browser's slots, in order; items_game's utility and action slots (and any other) are "other". */
export const SLOT_ORDER = ['primary', 'secondary', 'melee', 'pda', 'pda2', 'building', 'other']
const slotOf = (slot: string) => (SLOT_ORDER.includes(slot) ? slot : 'other')

export interface CatalogItem {
  id: number
  name: string
  /** items_game's slot for this class (primary, melee, pda …), or other. */
  slot: string
  /** The manifest's model and animation slot; null when no viewmodel was built. */
  model: string | null
  anim: string | null
  /** Why it is known not to look right, if it is. */
  broken: string | null
}

export type Catalog = Record<number, CatalogItem[]>

let catalog: Promise<Catalog | null> | null = null

/** Each class's weapons (by class id), in slot then id order. */
export const loadCatalog = () =>
  (catalog ??= loadManifest().then(manifest => (manifest ? buildCatalog(manifest) : null)))

function buildCatalog(manifest: ViewmodelManifest): Catalog {
  const out: Catalog = {}
  for (const [classId, className] of Object.entries(CLASS_NAMES)) {
    const items: CatalogItem[] = []
    const seen = new Set<string>()
    for (const [id, byClass] of Object.entries(manifest.items)) {
      const entry = byClass[className]
      if (!entry) continue
      seen.add(id)
      const named = NAMES[id]
      items.push({
        id: Number(id),
        name: named?.[0] ?? `Item ${id}`,
        slot: slotOf(named?.[1][className] ?? entry[1].toLowerCase()),
        model: entry[0],
        anim: entry[1],
        broken: KNOWN_BROKEN[Number(id)] ?? null,
      })
    }
    // Weapons the class has with no viewmodel (the build skipped or failed them).
    for (const [id, [name, slots]] of Object.entries(NAMES)) {
      if (seen.has(id) || !slots[className]) continue
      items.push({
        id: Number(id),
        name,
        slot: slotOf(slots[className]),
        model: null,
        anim: null,
        broken: KNOWN_BROKEN[Number(id)] ?? 'No viewmodel built for it',
      })
    }
    const rank = (slot: string) => SLOT_ORDER.indexOf(slot) + 1 || SLOT_ORDER.length + 1
    items.sort((a, b) => rank(a.slot) - rank(b.slot) || a.id - b.id)
    out[Number(classId)] = items
  }
  return out
}
