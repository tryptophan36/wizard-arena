import spellRecords from "@/data/spells.json";

export type SpellId = (typeof spellRecords)[number]["id"];
export type SpellData = (typeof spellRecords)[number];

export const SPELLS = spellRecords as readonly SpellData[];

export function getSpell(spellId: SpellId) {
  return SPELLS.find((spell) => spell.id === spellId) ?? SPELLS[0];
}

export function isSpellId(value: string | null): value is SpellId {
  return value !== null && SPELLS.some((spell) => spell.id === value);
}
