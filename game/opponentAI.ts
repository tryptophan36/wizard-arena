import { SPELLS, type SpellData, type SpellId } from "@/game/spellData";

export type OpponentPhase = "ready" | "charging" | "flying" | "impact";

export type OpponentDecision = {
  action: "wait" | "cast";
  reason: "opening-ritual" | "recharging" | "cooldown" | "phase" | "stunned" | "pressure" | "execute";
  spellId?: SpellId;
};

export type OpponentAIState = {
  now: number;
  mana: number;
  cooldownUntil: number;
  phase: OpponentPhase;
  playerHealth: number;
  opponentHealth: number;
  playerShieldActive: boolean;
  hasActiveProjectile: boolean;
  stunned?: boolean;
  availableSpells?: readonly SpellData[];
};

/** Tunable, deterministic pacing for the local Ashen Warden opponent. */
export const OPPONENT_AI_CONFIG = {
  openingDelayMs: 1400,
  decisionIntervalMs: 260,
  lowManaThreshold: 25,
  pressureHealth: 42,
} as const;

export function decideOpponentAction(state: OpponentAIState, spell: SpellData): OpponentDecision {
  if (state.stunned) return { action: "wait", reason: "stunned" };
  if (state.now < OPPONENT_AI_CONFIG.openingDelayMs) return { action: "wait", reason: "opening-ritual" };
  if (state.phase !== "ready" || state.hasActiveProjectile) return { action: "wait", reason: "phase" };
  if (state.now < state.cooldownUntil) return { action: "wait", reason: "cooldown" };
  if (state.mana < spell.manaCost) return { action: "wait", reason: "recharging" };

  const availableSpells = state.availableSpells ?? SPELLS;
  const emberLance = availableSpells.find((candidate) => candidate.id === "ember-lance") ?? spell;
  const lightning = availableSpells.find((candidate) => candidate.id === "lightning");
  const aegis = availableSpells.find((candidate) => candidate.id === "aegis");

  // The Warden rotates through its kit based on the tactical state rather than
  // firing the same projectile on a fixed timer. Aegis answers a healthy player
  // who is already pressuring the core; Lightning is the expensive finisher.
  if (aegis && state.opponentHealth <= 35 && state.playerHealth > OPPONENT_AI_CONFIG.pressureHealth && state.mana >= aegis.manaCost) {
    return { action: "cast", reason: "pressure", spellId: aegis.id };
  }
  if (lightning && state.playerHealth <= OPPONENT_AI_CONFIG.pressureHealth && state.mana >= lightning.manaCost) {
    return { action: "cast", reason: "execute", spellId: lightning.id };
  }

  // Ember Lance is intentionally held for a readable turn: fire when the player
  // is vulnerable, or when the Warden has enough mana to commit to pressure.
  if (state.playerShieldActive && state.playerHealth > OPPONENT_AI_CONFIG.pressureHealth) {
    return { action: "wait", reason: "pressure" };
  }
  if (state.playerHealth <= OPPONENT_AI_CONFIG.pressureHealth || state.opponentHealth <= 35 || state.mana >= 75) {
    const chosenSpell = lightning && state.mana >= lightning.manaCost && (state.playerHealth <= 62 || state.opponentHealth <= 35)
      ? lightning
      : emberLance;
    if (state.mana < chosenSpell.manaCost) return { action: "wait", reason: "recharging" };
    return { action: "cast", reason: state.playerHealth <= OPPONENT_AI_CONFIG.pressureHealth ? "execute" : "pressure", spellId: chosenSpell.id };
  }
  return { action: "wait", reason: "recharging" };
}
