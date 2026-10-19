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
  playerPhase?: OpponentPhase;
  hasActiveProjectile: boolean;
  lastSpellId?: SpellId | null;
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

  const availableSpells = state.availableSpells ?? SPELLS;
  const emberLance = availableSpells.find((candidate) => candidate.id === "ember-lance") ?? spell;
  const lightning = availableSpells.find((candidate) => candidate.id === "lightning");
  const aegis = availableSpells.find((candidate) => candidate.id === "aegis");
  const freeze = availableSpells.find((candidate) => (candidate.id as string) === "freeze");
  const ghostPortal = availableSpells.find((candidate) => (candidate.id as string) === "ghost-portal");
  const playerIsCasting = state.playerPhase === "charging" || state.playerPhase === "flying";
  const tacticalChoices: { spell: SpellData; reason: OpponentDecision["reason"] }[] = [];

  // Aegis answers an incoming player cast or a critically damaged Warden.
  if (aegis && (playerIsCasting || state.opponentHealth <= 35) && state.playerHealth > OPPONENT_AI_CONFIG.pressureHealth) {
    tacticalChoices.push({ spell: aegis, reason: "pressure" });
  }
  // Freeze is a control answer, not a default attack. Avoid using it into an
  // active player ward because the ward already reduces its effect.
  if (freeze && playerIsCasting && !state.playerShieldActive) {
    tacticalChoices.push({ spell: freeze, reason: "pressure" });
  }
  // The portal punishes an exposed caster by stripping their remaining mana.
  if (ghostPortal && playerIsCasting && !state.playerShieldActive) {
    tacticalChoices.push({ spell: ghostPortal, reason: "pressure" });
  }
  if (lightning && state.playerHealth <= OPPONENT_AI_CONFIG.pressureHealth) {
    tacticalChoices.push({ spell: lightning, reason: "execute" });
  }

  // Outside emergencies, alternate direct attacks instead of repeatedly
  // selecting the most expensive control spell.
  const rotation = state.lastSpellId === "ember-lance" ? [lightning, emberLance] : [emberLance, lightning];
  const choices = [...tacticalChoices, ...rotation.filter((candidate): candidate is SpellData => candidate !== undefined).map((candidate) => ({ spell: candidate, reason: "pressure" as const }))];
  const affordableChoices = choices.filter(({ spell: candidate }) => state.mana >= candidate.manaCost);
  const nextChoice = affordableChoices.find(({ spell: candidate }) => candidate.id !== state.lastSpellId) ?? affordableChoices[0];
  if (nextChoice) {
    return { action: "cast", reason: nextChoice.reason, spellId: nextChoice.spell.id };
  }
  return { action: "wait", reason: "recharging" };
}
