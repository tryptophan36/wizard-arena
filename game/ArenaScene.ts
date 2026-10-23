import Phaser from "phaser";
import { type RunePoint, type RuneStroke } from "@/game/runeGesture";
import { EMBER_LANCE_ASSET } from "@/game/emberLanceAsset";
import { LIGHTNING_BOLT_ASSET } from "@/game/lightningBoltAsset";
import { SHIELD_ASSET } from "@/game/shieldAsset";
import { FREEZE_ASSET } from "@/game/freezeAsset";
import { GHOST_PORTAL_ASSET } from "@/game/ghostPortalAsset";
import { DEFAULT_DRAWING_TOOL, normalizeDrawingStroke, type DrawingTool, type DrawingToolState } from "@/game/drawingTool";
import { getSpell, SPELLS, type SpellData, type SpellId } from "@/game/spellData";
import { recognizeAnySpell } from "@/game/spellRecognition";
import { decideOpponentAction, OPPONENT_AI_CONFIG, type OpponentPhase } from "@/game/opponentAI";

export type GestureStatus = "idle" | "drawing" | "recognized" | "failed";

export type GestureFeedback = {
  status: GestureStatus;
  message: string;
  hint: string;
};

export type ArenaGameState = "playing" | "victory" | "defeat";
export type EnemyActivity = "waiting" | "charging" | "flying" | "impact" | "stunned" | "frozen";
export type ArenaMode = "duel" | "practice";

export type ArenaCallbacks = {
  onManaChange: (mana: number) => void;
  onEnemyManaChange: (mana: number) => void;
  onTargetHealthChange: (health: number) => void;
  onPlayerHealthChange: (health: number) => void;
  onEnemyActivityChange: (activity: EnemyActivity) => void;
  onGameStateChange: (state: ArenaGameState) => void;
  onCountdownChange: (seconds: number | null) => void;
  onCooldownChange: (seconds: number) => void;
  onEnemyCooldownChange: (seconds: number) => void;
  onPhaseChange: (phase: "ready" | "charging" | "flying" | "impact") => void;
  onGestureChange: (feedback: GestureFeedback) => void;
  onSpellChange: (spellId: SpellId) => void;
};

const MAX_MANA = 100;
const MAX_HEALTH = 100;
const DUEL_COUNTDOWN_DURATION_MS = 3000;
const MANA_REGEN_PER_SECOND = 5;
const DEFAULT_FREEZE_DURATION_MS = 2500;
const SHIELDED_FREEZE_DURATION_MS = 1000;
type Point = { x: number; y: number };

function isFreezeSpell(spell: SpellData) {
  return (spell.visualKind as string) === "freeze";
}

function isGhostPortalSpell(spell: SpellData) {
  return (spell.visualKind as string) === "ghost-portal";
}

function getFreezeDuration(spell: SpellData) {
  const duration = (spell as SpellData & { freezeDurationMs?: unknown }).freezeDurationMs;
  return typeof duration === "number" && Number.isFinite(duration) && duration > 0 ? duration : DEFAULT_FREEZE_DURATION_MS;
}

export class ArenaScene extends Phaser.Scene {
  private callbacks: ArenaCallbacks;
  private spell: SpellData;
  private mode: ArenaMode;
  private phase: "ready" | "charging" | "flying" | "impact" = "ready";
  private phaseStarted = 0;
  private cooldownUntil = 0;
  private mana = MAX_MANA;
  private targetHealth = MAX_HEALTH;
  private playerHealth = MAX_HEALTH;
  private gameState: ArenaGameState = "playing";
  private projectileSpell: SpellData | null = null;
  private shieldActive = false;
  private shieldUntil = 0;
  private shieldBlockedUntil = 0;
  private enemyShieldActive = false;
  private enemyShieldUntil = 0;
  private enemyShieldBlockedUntil = 0;
  private lastUiUpdate = -1;
  private lastEnemyUiUpdate = -1;
  private art!: Phaser.GameObjects.Graphics;
  private emberLance!: Phaser.GameObjects.Image;
  private enemyEmberLance!: Phaser.GameObjects.Image;
  private lightningBolt!: Phaser.GameObjects.Image;
  private freezeRings!: Phaser.GameObjects.Image;
  private enemyFreezeRings!: Phaser.GameObjects.Image;
  private ghostPortal!: Phaser.GameObjects.Image;
  private enemyGhostPortal!: Phaser.GameObjects.Image;
  private shield!: Phaser.GameObjects.Image;
  private enemyShield!: Phaser.GameObjects.Image;
  private gestureStrokes: RuneStroke[] = [];
  private activeStroke: RunePoint[] = [];
  private drawingTool: DrawingTool = DEFAULT_DRAWING_TOOL;
  private drawingToolState: DrawingToolState;
  private gestureActive = false;
  private matchKey: Phaser.Input.Keyboard.Key | null = null;
  private gestureFeedback: GestureFeedback = { status: "idle", message: "DRAW RUNE", hint: "DRAW A REGISTERED SPELL SYMBOL" };
  private gestureFeedbackUntil = 0;
  private enemyPhase: OpponentPhase = "ready";
  private enemyPhaseStarted = 0;
  private enemyCooldownUntil = 0;
  private enemyMana = MAX_MANA;
  private enemyProjectileSpell: SpellData | null = null;
  private enemyLastSpellId: SpellId | null = null;
  private enemyStunnedUntil = 0;
  private enemyFrozenUntil = 0;
  private playerFrozenUntil = 0;
  private countdownUntil = 0;
  private countdownValue: number | null = null;
  private nextEnemyDecisionAt: number = OPPONENT_AI_CONFIG.openingDelayMs;
  private enemyActivity: EnemyActivity = "waiting";

  constructor(callbacks: ArenaCallbacks, spellId: SpellId = "ember-lance", drawingToolState: DrawingToolState = { value: DEFAULT_DRAWING_TOOL }, mode: ArenaMode = "duel") {
    super({ key: "WizardArena" });
    this.callbacks = callbacks;
    this.spell = getSpell(spellId);
    this.drawingToolState = drawingToolState;
    this.mode = mode;
  }

  public setDrawingTool(tool: DrawingTool) {
    if (this.drawingTool === tool) return;
    const keepGestureSequence = this.gestureStrokes.length > 0;
    this.drawingTool = tool;
    this.gestureActive = false;
    this.activeStroke = [];
    if (!keepGestureSequence) {
      this.clearGestureInput();
      this.gestureFeedbackUntil = 0;
    }
    this.setGestureFeedback({ status: keepGestureSequence ? "drawing" : "idle", message: `${tool.toUpperCase()} TOOL READY`, hint: this.spell.gesture.hint });
  }

  private getInitialGesture() {
    return { status: "idle" as const, message: `DRAW ${this.spell.name} RUNE`, hint: this.spell.gesture.hint };
  }

  private syncDrawingTool() {
    if (this.drawingToolState.value !== this.drawingTool) this.setDrawingTool(this.drawingToolState.value);
  }

  private clearGestureInput() {
    this.gestureActive = false;
    this.gestureStrokes = [];
    this.activeStroke = [];
  }

  preload() {
    this.load.svg(EMBER_LANCE_ASSET.key, EMBER_LANCE_ASSET.url, {
      width: EMBER_LANCE_ASSET.width,
      height: EMBER_LANCE_ASSET.height,
    });
    this.load.svg(LIGHTNING_BOLT_ASSET.key, LIGHTNING_BOLT_ASSET.url, {
      width: LIGHTNING_BOLT_ASSET.width,
      height: LIGHTNING_BOLT_ASSET.height,
    });
    this.load.svg(SHIELD_ASSET.key, SHIELD_ASSET.url, {
      width: SHIELD_ASSET.width,
      height: SHIELD_ASSET.height,
    });
    this.load.svg(FREEZE_ASSET.key, FREEZE_ASSET.url, {
      width: FREEZE_ASSET.width,
      height: FREEZE_ASSET.height,
    });
    this.load.svg(GHOST_PORTAL_ASSET.key, GHOST_PORTAL_ASSET.url, {
      width: GHOST_PORTAL_ASSET.width,
      height: GHOST_PORTAL_ASSET.height,
    });
  }

  create() {
    this.art = this.add.graphics();
    this.emberLance = this.add.image(0, 0, EMBER_LANCE_ASSET.key)
      .setOrigin(EMBER_LANCE_ASSET.origin.x, EMBER_LANCE_ASSET.origin.y)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setVisible(false)
      .setDepth(3);
    this.enemyEmberLance = this.add.image(0, 0, EMBER_LANCE_ASSET.key)
      .setOrigin(EMBER_LANCE_ASSET.origin.x, EMBER_LANCE_ASSET.origin.y)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setVisible(false)
      .setDepth(3);
    this.lightningBolt = this.add.image(0, 0, LIGHTNING_BOLT_ASSET.key)
      .setOrigin(LIGHTNING_BOLT_ASSET.origin.x, LIGHTNING_BOLT_ASSET.origin.y)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setVisible(false)
      .setDepth(3);
    this.freezeRings = this.add.image(0, 0, FREEZE_ASSET.key)
      .setOrigin(FREEZE_ASSET.origin.x, FREEZE_ASSET.origin.y)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setVisible(false)
      .setDepth(3);
    this.enemyFreezeRings = this.add.image(0, 0, FREEZE_ASSET.key)
      .setOrigin(FREEZE_ASSET.origin.x, FREEZE_ASSET.origin.y)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setVisible(false)
      .setDepth(3);
    this.ghostPortal = this.add.image(0, 0, GHOST_PORTAL_ASSET.key)
      .setOrigin(GHOST_PORTAL_ASSET.origin.x, GHOST_PORTAL_ASSET.origin.y)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setVisible(false)
      .setDepth(2);
    this.enemyGhostPortal = this.add.image(0, 0, GHOST_PORTAL_ASSET.key)
      .setOrigin(GHOST_PORTAL_ASSET.origin.x, GHOST_PORTAL_ASSET.origin.y)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setVisible(false)
      .setDepth(2);
    this.shield = this.add.image(0, 0, SHIELD_ASSET.key)
      .setOrigin(SHIELD_ASSET.origin.x, SHIELD_ASSET.origin.y)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setVisible(false)
      .setDepth(4);
    this.enemyShield = this.add.image(0, 0, SHIELD_ASSET.key)
      .setOrigin(SHIELD_ASSET.origin.x, SHIELD_ASSET.origin.y)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setVisible(false)
      .setDepth(4);
    this.input.on("pointerdown", this.handlePointerDown, this);
    this.input.on("pointermove", this.handlePointerMove, this);
    this.input.on("pointerup", this.handlePointerUp, this);
    this.input.on("pointerupoutside", this.handlePointerUp, this);
    if (this.input.keyboard) {
      this.matchKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A, false, false);
      this.matchKey.on("down", this.handleMatchKey, this);
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.unregisterMatchKey, this);
    }
    this.scale.on("resize", () => this.drawArena(0));
    this.callbacks.onPhaseChange("ready");
    this.callbacks.onManaChange(this.mana);
    this.callbacks.onEnemyManaChange(this.enemyMana);
    this.callbacks.onEnemyCooldownChange(0);
    this.callbacks.onTargetHealthChange(this.targetHealth);
    this.callbacks.onPlayerHealthChange(this.playerHealth);
    this.callbacks.onEnemyActivityChange(this.enemyActivity);
    this.callbacks.onGameStateChange(this.gameState);
    if (this.mode === "duel") {
      this.countdownUntil = (this.game.loop?.time ?? 0) + DUEL_COUNTDOWN_DURATION_MS;
      this.countdownValue = 3;
      this.callbacks.onCountdownChange(this.countdownValue);
    } else {
      this.callbacks.onCountdownChange(null);
    }
    this.gestureFeedback = this.getInitialGesture();
    this.callbacks.onSpellChange(this.spell.id);
    this.callbacks.onGestureChange(this.gestureFeedback);
    this.drawArena(0);
  }

  update(time: number, delta: number) {
    this.syncDrawingTool();
    const dt = delta / 1000;
    if (this.gameState !== "playing") {
      this.drawArena(time);
      return;
    }
    if (this.mode === "duel" && this.countdownUntil > 0) {
      const remaining = Math.ceil((this.countdownUntil - time) / 1000);
      if (remaining > 0) {
        if (remaining !== this.countdownValue) {
          this.countdownValue = remaining;
          this.callbacks.onCountdownChange(remaining);
        }
        this.drawArena(time);
        return;
      }
      this.countdownUntil = 0;
      this.countdownValue = null;
      this.callbacks.onCountdownChange(null);
    }
    if (this.mode === "duel" && this.phase === "ready" && this.mana < MAX_MANA) this.mana = Math.min(MAX_MANA, this.mana + dt * MANA_REGEN_PER_SECOND);
    if (this.mode === "duel" && this.enemyPhase === "ready" && this.enemyMana < MAX_MANA) this.enemyMana = Math.min(MAX_MANA, this.enemyMana + dt * MANA_REGEN_PER_SECOND);
    if (this.shieldActive && time >= this.shieldUntil) this.shieldActive = false;
    if (this.enemyShieldActive && time >= this.enemyShieldUntil) {
      this.enemyShieldActive = false;
      if (this.enemyActivity === "charging") this.setEnemyActivity("waiting");
    }
    if (this.playerFrozenUntil > 0 && time >= this.playerFrozenUntil) {
      this.playerFrozenUntil = 0;
      if (!this.gestureActive) {
        this.clearGestureInput();
        this.gestureFeedbackUntil = 0;
        this.setGestureFeedback(this.getInitialGesture());
      }
    }
    if (!this.gestureActive && this.gestureFeedbackUntil > 0 && time >= this.gestureFeedbackUntil) {
      this.gestureFeedbackUntil = 0;
      this.clearGestureInput();
      this.setGestureFeedback(this.getInitialGesture());
    }
    const cooldown = Math.max(0, (this.cooldownUntil - time) / 1000);
    if (Math.abs(cooldown - this.lastUiUpdate) > 0.03 || cooldown === 0) {
      this.lastUiUpdate = cooldown;
      this.callbacks.onCooldownChange(cooldown);
      this.callbacks.onManaChange(this.mana);
    }
    const enemyCooldown = Math.max(0, (this.enemyCooldownUntil - time) / 1000);
    if (Math.abs(enemyCooldown - this.lastEnemyUiUpdate) > 0.03 || enemyCooldown === 0) {
      this.lastEnemyUiUpdate = enemyCooldown;
      this.callbacks.onEnemyCooldownChange(enemyCooldown);
      this.callbacks.onEnemyManaChange(this.enemyMana);
    }
    const activeSpell = this.projectileSpell ?? this.spell;
    if (this.phase === "charging" && time - this.phaseStarted > activeSpell.timings.charging) {
      this.phase = "flying"; this.phaseStarted = time; this.callbacks.onPhaseChange("flying");
    } else if (this.phase === "flying" && time - this.phaseStarted > activeSpell.timings.flying) {
      this.phase = "impact"; this.phaseStarted = time;
      if (this.mode === "duel" && activeSpell.kind === "offensive") {
        if (this.enemyShieldActive) {
          this.enemyShieldActive = false;
          this.enemyShieldBlockedUntil = time + 440;
          if (isFreezeSpell(activeSpell)) this.freezeOpponent(time, SHIELDED_FREEZE_DURATION_MS);
        } else {
          this.targetHealth = Math.max(0, this.targetHealth - activeSpell.damage);
          if (activeSpell.stunDurationMs) this.stunOpponent(time, activeSpell.stunDurationMs);
          if (isFreezeSpell(activeSpell)) this.freezeOpponent(time, getFreezeDuration(activeSpell));
          if (isGhostPortalSpell(activeSpell)) {
            this.enemyMana = 0;
            this.callbacks.onEnemyManaChange(this.enemyMana);
          }
        }
      }
      this.callbacks.onTargetHealthChange(this.targetHealth); this.callbacks.onPhaseChange("impact");
      if (this.mode === "duel" && this.targetHealth <= 0) this.finishGame("victory");
    } else if (this.phase === "impact" && time - this.phaseStarted > activeSpell.timings.impact) {
      this.phase = "ready"; this.projectileSpell = null; this.callbacks.onPhaseChange("ready");
    }
    if (this.mode === "duel" && this.gameState === "playing") this.updateOpponent(time);
    this.drawArena(time);
  }

  private updateOpponent(time: number) {
    if (time < this.enemyFrozenUntil) {
      this.enemyPhase = "ready";
      this.enemyPhaseStarted = time;
      this.enemyProjectileSpell = null;
      if (this.enemyActivity !== "frozen") this.setEnemyActivity("frozen");
      return;
    }
    if (this.enemyActivity === "frozen") this.setEnemyActivity(time < this.enemyStunnedUntil ? "stunned" : "waiting");
    if (time < this.enemyStunnedUntil) {
      this.enemyPhase = "ready";
      this.enemyPhaseStarted = time;
      this.enemyProjectileSpell = null;
      if (this.enemyActivity !== "stunned") this.setEnemyActivity("stunned");
      return;
    }
    if (this.enemyPhase === "ready" && !this.enemyShieldActive && time >= this.nextEnemyDecisionAt) {
      const decision = decideOpponentAction({
        now: time,
        mana: this.enemyMana,
        cooldownUntil: this.enemyCooldownUntil,
        phase: this.enemyPhase,
        playerHealth: this.playerHealth,
        opponentHealth: this.targetHealth,
        playerShieldActive: this.shieldActive,
        playerPhase: this.phase,
        hasActiveProjectile: this.enemyProjectileSpell !== null,
        lastSpellId: this.enemyLastSpellId,
        stunned: time < this.enemyStunnedUntil,
        availableSpells: SPELLS,
      }, getSpell("ember-lance"));
      this.nextEnemyDecisionAt = time + OPPONENT_AI_CONFIG.decisionIntervalMs;
      if (decision.action === "cast") this.castOpponentSpell(time, decision.spellId ?? "ember-lance");
    }
    const enemySpell = this.enemyProjectileSpell;
    if (this.enemyPhase === "charging" && enemySpell && time - this.enemyPhaseStarted >= enemySpell.timings.charging) {
      this.enemyPhase = "flying"; this.enemyPhaseStarted = time; this.setEnemyActivity("flying");
    } else if (this.enemyPhase === "flying" && enemySpell && time - this.enemyPhaseStarted >= enemySpell.timings.flying) {
      this.enemyPhase = "impact"; this.enemyPhaseStarted = time; this.setEnemyActivity("impact");
      if (this.shieldActive) {
        this.shieldActive = false;
        this.shieldBlockedUntil = time + 440;
        if (isFreezeSpell(enemySpell)) this.freezePlayer(time, SHIELDED_FREEZE_DURATION_MS);
      } else {
        this.playerHealth = Math.max(0, this.playerHealth - enemySpell.damage);
        this.callbacks.onPlayerHealthChange(this.playerHealth);
        if (isFreezeSpell(enemySpell)) this.freezePlayer(time, getFreezeDuration(enemySpell));
        if (isGhostPortalSpell(enemySpell)) {
          this.mana = 0;
          this.callbacks.onManaChange(this.mana);
        }
      }
      if (this.playerHealth <= 0) this.finishGame("defeat");
    } else if (this.enemyPhase === "impact" && enemySpell && time - this.enemyPhaseStarted >= enemySpell.timings.impact) {
      this.enemyPhase = "ready"; this.enemyProjectileSpell = null; this.setEnemyActivity("waiting");
    }
  }

  private castOpponentSpell(now: number, spellId: SpellId) {
    const spell = getSpell(spellId);
    if (this.enemyMana < spell.manaCost || this.enemyPhase !== "ready" || now < this.enemyCooldownUntil) return;
    this.enemyLastSpellId = spell.id;
    this.enemyMana -= spell.manaCost;
    this.enemyCooldownUntil = now + spell.cooldown * 1000;
    this.callbacks.onEnemyManaChange(this.enemyMana);
    this.callbacks.onEnemyCooldownChange(spell.cooldown);
    if (spell.kind === "defensive") {
      this.enemyShieldActive = true;
      this.enemyShieldUntil = now + (spell.shieldDurationMs ?? 1600);
      this.enemyShieldBlockedUntil = 0;
      this.setEnemyActivity("charging");
      return;
    }
    this.enemyProjectileSpell = spell;
    this.enemyPhase = "charging";
    this.enemyPhaseStarted = now;
    this.setEnemyActivity("charging");
  }

  private stunOpponent(now: number, durationMs: number) {
    if (!Number.isFinite(durationMs) || durationMs <= 0) return;
    this.enemyStunnedUntil = Math.max(this.enemyStunnedUntil, now + durationMs);
    this.enemyPhase = "ready";
    this.enemyPhaseStarted = now;
    this.enemyProjectileSpell = null;
    this.nextEnemyDecisionAt = Math.max(this.nextEnemyDecisionAt, this.enemyStunnedUntil);
    this.setEnemyActivity("stunned");
  }

  private freezeOpponent(now: number, durationMs: number) {
    if (!Number.isFinite(durationMs) || durationMs <= 0) return;
    this.enemyFrozenUntil = Math.max(this.enemyFrozenUntil, now + durationMs);
    this.enemyPhase = "ready";
    this.enemyPhaseStarted = now;
    this.enemyProjectileSpell = null;
    this.nextEnemyDecisionAt = Math.max(this.nextEnemyDecisionAt, this.enemyFrozenUntil);
    this.setEnemyActivity("frozen");
  }

  private freezePlayer(now: number, durationMs: number) {
    if (!Number.isFinite(durationMs) || durationMs <= 0) return;
    this.playerFrozenUntil = Math.max(this.playerFrozenUntil, now + durationMs);
    if (this.phase !== "ready") {
      this.phase = "ready";
      this.phaseStarted = now;
      this.projectileSpell = null;
      this.callbacks.onPhaseChange("ready");
    }
    this.gestureActive = false;
    this.clearGestureInput();
    this.gestureFeedbackUntil = this.playerFrozenUntil;
    this.setGestureFeedback({ status: "failed", message: "FROZEN", hint: "RUNE INPUT SEALED" });
  }

  private setEnemyActivity(activity: EnemyActivity) {
    this.enemyActivity = activity;
    this.callbacks.onEnemyActivityChange(activity);
  }

  private finishGame(state: Exclude<ArenaGameState, "playing">) {
    if (this.mode === "practice" || this.gameState !== "playing") return;
    this.gameState = state;
    this.clearGestureInput();
    this.gestureFeedbackUntil = 0;
    this.callbacks.onGameStateChange(state);
  }

  private handlePointerDown(pointer: Phaser.Input.Pointer) {
    const now = this.game.loop?.time ?? 0;
    if (this.gameState !== "playing" || this.countdownUntil > now || pointer.wasTouch || pointer.button !== 0 || now < this.playerFrozenUntil) return;
    if (this.gestureActive || (this.phase !== "ready" && this.phase !== "flying")) return;
    this.gestureActive = true;
    this.activeStroke = [{ x: pointer.worldX, y: pointer.worldY, timestamp: now }];
    this.gestureFeedbackUntil = 0;
    const strokeNumber = this.gestureStrokes.length + 1;
    this.setGestureFeedback({ status: "drawing", message: `TRACING STROKE ${strokeNumber}…`, hint: this.spell.gesture.hint });
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer) {
    if (this.countdownUntil > (this.game.loop?.time ?? 0) || !this.gestureActive || !pointer.leftButtonDown() || pointer.wasTouch) return;
    const next = { x: pointer.worldX, y: pointer.worldY, timestamp: this.game.loop?.time ?? 0 };
    const previous = this.activeStroke[this.activeStroke.length - 1];
    if (!previous || Phaser.Math.Distance.Between(previous.x, previous.y, next.x, next.y) >= 4) this.activeStroke.push(next);
  }

  private handlePointerUp(pointer: Phaser.Input.Pointer) {
    if (!this.gestureActive || pointer.wasTouch) return;
    const now = this.game.loop?.time ?? 0;
    if (this.countdownUntil > now || now < this.playerFrozenUntil) {
      this.clearGestureInput();
      return;
    }
    this.gestureActive = false;
    const finalPoint = { x: pointer.worldX, y: pointer.worldY, timestamp: now };
    const previous = this.activeStroke[this.activeStroke.length - 1];
    if (!previous || Phaser.Math.Distance.Between(previous.x, previous.y, finalPoint.x, finalPoint.y) >= 2) this.activeStroke.push(finalPoint);
    const points = normalizeDrawingStroke(this.activeStroke, this.drawingTool);
    this.gestureStrokes.push({ points, startedAt: points[0]?.timestamp, endedAt: now });
    this.activeStroke = [];
    this.setGestureFeedback({ status: "drawing", message: "RUNE READY · PRESS A TO MATCH", hint: this.spell.gesture.hint });
  }

  private handleMatchKey() {
    const now = this.game.loop?.time ?? 0;
    if (this.gameState !== "playing" || this.countdownUntil > now || this.gestureActive || now < this.playerFrozenUntil || this.gestureStrokes.length === 0) return;
    this.matchGesture(now);
  }

  private unregisterMatchKey() {
    const key = this.matchKey;
    this.matchKey = null;
    if (!key) return;
    key.off("down", this.handleMatchKey, this);
    this.input.keyboard?.removeKey(key, true);
  }

  private matchGesture(now: number) {
    if (this.gameState !== "playing" || this.countdownUntil > now || now < this.playerFrozenUntil || this.gestureStrokes.length === 0) {
      this.clearGestureInput();
      return;
    }

    const match = recognizeAnySpell(this.gestureStrokes, Math.min(this.scale.width, this.scale.height));
    const recognition = match.recognition;
    if (!recognition.recognized) {
      if (recognition.stage === "awaiting-second-stroke" || recognition.stage === "awaiting-next-stroke") {
        this.gestureFeedbackUntil = 0;
        this.setGestureFeedback({ status: "drawing", message: `${match.spell.name} STROKE ${recognition.completedStrokes} INSCRIBED`, hint: recognition.hint });
        return;
      }
      this.clearGestureInput();
      this.showGestureFeedback({ status: "failed", message: "RUNE NOT RECOGNIZED", hint: recognition.hint });
      return;
    }

    this.spell = match.spell;
    this.callbacks.onSpellChange(this.spell.id);
    const cast = this.castSpell();
    this.clearGestureInput();
    if (cast) {
      this.showGestureFeedback({ status: "recognized", message: "RUNE ACCEPTED", hint: `${this.spell.name} RELEASED` });
    }
    else this.showGestureFeedback({ status: "failed", message: "RUNE CANNOT FIRE YET", hint: this.mana < this.spell.manaCost ? "WAIT FOR MANA" : "WAIT FOR THE CURRENT CAST TO FINISH" });
  }

  private setGestureFeedback(feedback: GestureFeedback) {
    this.gestureFeedback = feedback;
    this.callbacks.onGestureChange(feedback);
  }

  private showGestureFeedback(feedback: GestureFeedback) {
    this.gestureFeedbackUntil = (this.game.loop?.time ?? 0) + 1100;
    this.setGestureFeedback(feedback);
  }

  private castSpell() {
    const now = this.game.loop?.time ?? 0;
    const isPractice = this.mode === "practice";
    if (!isPractice && now < this.playerFrozenUntil) return false;
    const isShield = this.spell.kind === "defensive";
    const canCastShield = isShield && (this.phase === "ready" || this.phase === "flying");
    if ((!isShield && this.phase !== "ready") || (isShield && !canCastShield) || (!isPractice && now < this.cooldownUntil) || (!isPractice && this.mana < this.spell.manaCost)) return false;
    if (isPractice) {
      this.mana = MAX_MANA;
      this.cooldownUntil = 0;
    } else {
      this.mana -= this.spell.manaCost;
      this.cooldownUntil = now + this.spell.cooldown * 1000;
    }
    if (isShield) {
      this.shieldActive = true;
      this.shieldUntil = now + (this.spell.shieldDurationMs ?? 1600);
      this.shieldBlockedUntil = 0;
      this.callbacks.onManaChange(this.mana); this.callbacks.onCooldownChange(isPractice ? 0 : this.spell.cooldown);
      return true;
    }
    this.projectileSpell = this.spell;
    this.phase = "charging"; this.phaseStarted = now;
    this.callbacks.onManaChange(this.mana); this.callbacks.onCooldownChange(isPractice ? 0 : this.spell.cooldown); this.callbacks.onPhaseChange("charging");
    return true;
  }

  private drawArena(time: number) {
    const width = this.scale.width; const height = this.scale.height; const t = time / 1000;
    const wizard: Point = { x: width * 0.2, y: height * 0.67 };
    const targetBase: Point = { x: width * 0.8, y: height * 0.62 };
    const activeSpell = this.projectileSpell ?? this.spell;
    const hitT = this.phase === "impact" ? Phaser.Math.Clamp((time - this.phaseStarted) / activeSpell.timings.impact, 0, 1) : 0;
    const target: Point = { x: targetBase.x + (this.phase === "impact" ? Math.sin(hitT * Math.PI * 8) * (1 - hitT) * 10 : 0), y: targetBase.y };
    this.art.clear(); this.drawBackdrop(width, height, t); this.drawArenaFloor(width, height, t);
       this.drawWizard(wizard, t); this.drawTarget(target, t, hitT); this.drawSpell(wizard, target, time, t); this.drawEnemySpell(wizard, target, time, t); this.drawShield(wizard, time, t); this.drawEnemyShield(target, time, t); this.drawFreezeStatus(wizard, target, time, t); this.drawGesture(time);
  }

  private drawGesture(time: number) {
    const previewPoints = this.activeStroke.length > 1 ? normalizeDrawingStroke(this.activeStroke, this.drawingTool) : this.activeStroke;
    const strokes = [...this.gestureStrokes, ...(previewPoints.length > 1 ? [{ points: previewPoints }] : [])];
    if (!strokes.some((stroke) => stroke.points.length > 1)) return;
    const age = this.gestureFeedbackUntil > 0 ? Math.max(0, time - (this.gestureFeedbackUntil - 1100)) : 0;
    const alpha = this.gestureActive ? 1 : Phaser.Math.Clamp(1 - age / 1100, 0.2, 1);
    const color = this.gestureFeedback.status === "failed" ? 0xff784e : this.gestureFeedback.status === "recognized" ? 0xffd166 : 0x72e6d3;
    const drawPath = (points: RunePoint[]) => {
      this.art.beginPath();
      this.art.moveTo(points[0].x, points[0].y);
      points.slice(1).forEach((point) => this.art.lineTo(point.x, point.y));
      this.art.strokePath();
    };
    strokes.forEach((stroke) => {
      if (stroke.points.length < 2) return;
      this.art.lineStyle(18, color, 0.08 * alpha); drawPath(stroke.points);
      this.art.lineStyle(8, color, 0.2 * alpha); drawPath(stroke.points);
      this.art.lineStyle(3, 0xf6fff3, 0.95 * alpha); drawPath(stroke.points);
    });
    const lastStroke = strokes[strokes.length - 1];
    const tip = lastStroke.points[lastStroke.points.length - 1];
    this.art.fillStyle(color, 0.25 * alpha); this.art.fillCircle(tip.x, tip.y, 12);
    this.art.fillStyle(0xf6fff3, 0.9 * alpha); this.art.fillCircle(tip.x, tip.y, 3);
  }

  private drawBackdrop(width: number, height: number, t: number) {
    const g = this.art;
    g.fillGradientStyle(0x0b1232, 0x131b45, 0x060918, 0x0b102b, 1); g.fillRect(0, 0, width, height);
    g.fillStyle(0x6676bf, 0.13); g.fillCircle(width * 0.79, height * 0.19, Math.min(width, height) * 0.095);
    g.fillStyle(0xb5c7ff, 0.18); g.fillCircle(width * 0.79, height * 0.19, Math.min(width, height) * 0.068);
    const stars = [[0.08, 0.2], [0.17, 0.12], [0.3, 0.2], [0.42, 0.11], [0.54, 0.24], [0.68, 0.1], [0.89, 0.28], [0.95, 0.12], [0.61, 0.34], [0.22, 0.34]];
    stars.forEach(([x, y], index) => { g.fillStyle(0xd9e4ff, 0.45 + Math.sin(t * 1.8 + index) * 0.2); g.fillCircle(width * x, height * y, index % 3 === 0 ? 2 : 1); });
    g.fillStyle(0x111a3d, 1); g.beginPath(); g.moveTo(0, height * 0.49); g.lineTo(width * 0.13, height * 0.3); g.lineTo(width * 0.25, height * 0.48); g.lineTo(width * 0.4, height * 0.27); g.lineTo(width * 0.56, height * 0.48); g.lineTo(width * 0.7, height * 0.34); g.lineTo(width * 0.84, height * 0.49); g.lineTo(width, height * 0.37); g.lineTo(width, height * 0.67); g.lineTo(0, height * 0.67); g.closePath(); g.fillPath();
    this.drawPillar(width * 0.06, height * 0.45, height * 0.29); this.drawPillar(width * 0.94, height * 0.43, height * 0.31);
  }

  private drawPillar(x: number, y: number, h: number) {
    const g = this.art; g.fillStyle(0x202a54, 1); g.fillRect(x - 15, y, 30, h); g.fillStyle(0x303d70, 1); g.fillRect(x - 21, y - 8, 42, 10); g.fillRect(x - 18, y + h - 4, 36, 11); g.lineStyle(2, 0x4d5b8d, 0.65); g.lineBetween(x - 8, y + 7, x - 8, y + h - 12); g.lineBetween(x + 8, y + 7, x + 8, y + h - 12); g.fillStyle(0x66d8d0, 0.45); g.fillCircle(x, y - 14, 7); g.fillStyle(0xb3fff0, 0.7); g.fillCircle(x, y - 14, 2);
  }

  private drawArenaFloor(width: number, height: number, t: number) {
    const g = this.art; const horizon = height * 0.55;
    g.fillGradientStyle(0x1a2850, 0x0d1634, 0x2e2548, 0x11152f, 1); g.fillRect(0, horizon, width, height - horizon); g.fillStyle(0x080d22, 0.48); g.fillEllipse(width * 0.5, height * 0.87, width * 0.88, height * 0.29);
    g.lineStyle(1, 0x6474a8, 0.18); for (let i = 0; i < 9; i += 1) { const y = horizon + Math.pow(i / 9, 1.7) * height * 0.43; g.lineBetween(0, y, width, y); } for (let i = -10; i <= 10; i += 1) g.lineBetween(width * 0.5, horizon, width * 0.5 + i * width * 0.12, height);
    const runeX = width * 0.5; const runeY = height * 0.74; const runeRadius = Math.min(width, height) * 0.19;
    g.lineStyle(2, 0x7182d3, 0.38); g.strokeCircle(runeX, runeY, runeRadius); g.strokeCircle(runeX, runeY, runeRadius * 0.75); g.lineBetween(runeX - runeRadius, runeY, runeX + runeRadius, runeY); g.lineBetween(runeX, runeY - runeRadius, runeX, runeY + runeRadius); g.lineStyle(1, 0x78dcd1, 0.32);
    for (let i = 0; i < 6; i += 1) { const a = t * 0.08 + (Math.PI * 2 * i) / 6; g.lineBetween(runeX + Math.cos(a) * runeRadius * 0.78, runeY + Math.sin(a) * runeRadius * 0.78, runeX + Math.cos(a) * runeRadius * 0.94, runeY + Math.sin(a) * runeRadius * 0.94); }
  }

  private drawWizard(p: Point, t: number) {
    const g = this.art; const bob = this.phase === "ready" ? Math.sin(t * 2.2) * 2 : Math.sin(t * 10) * 3; const x = p.x; const y = p.y + bob;
    g.fillStyle(0x050819, 0.55); g.fillEllipse(x, y + 37, 120, 24);
    if (this.phase === "charging") { const pulse = 42 + Math.sin(t * 12) * 5; g.lineStyle(2, 0x75e4d7, 0.4); g.strokeCircle(x + 31, y - 35, pulse); g.lineStyle(1, 0xffd166, 0.75); g.strokeCircle(x + 31, y - 35, pulse + 9); }
    g.fillStyle(0x263576, 1); g.beginPath(); g.moveTo(x - 37, y + 26); g.lineTo(x - 25, y - 19); g.lineTo(x + 24, y - 19); g.lineTo(x + 46, y + 28); g.lineTo(x + 17, y + 36); g.lineTo(x - 42, y + 31); g.closePath(); g.fillPath(); g.fillStyle(0x3e56ac, 1); g.beginPath(); g.moveTo(x - 23, y - 16); g.lineTo(x + 2, y - 8); g.lineTo(x + 25, y - 17); g.lineTo(x + 34, y + 26); g.lineTo(x + 3, y + 32); g.lineTo(x - 22, y + 24); g.closePath(); g.fillPath();
     g.fillStyle(0xe0a56d, 1); g.fillCircle(x + 3, y - 39, 18); g.fillStyle(0x101835, 1); g.fillTriangle(x - 15, y - 42, x + 20, y - 42, x + 2, y - 7); g.fillStyle(0x12193d, 1); g.beginPath(); g.moveTo(x - 30, y - 46); g.lineTo(x + 2, y - 95); g.lineTo(x + 42, y - 49); g.lineTo(x + 21, y - 40); g.lineTo(x - 28, y - 40); g.closePath(); g.fillPath(); g.fillStyle(0x3b4fa0, 1); g.beginPath(); g.moveTo(x - 28, y - 47); g.lineTo(x + 2, y - 91); g.lineTo(x + 37, y - 48); g.closePath(); g.fillPath(); g.fillStyle(0xf3c36d, 1); g.fillTriangle(x + 1, y - 89, x + 6, y - 76, x - 3, y - 76); g.fillStyle(0x171d43, 1); g.fillCircle(x - 3, y - 40, 2); g.fillCircle(x + 10, y - 40, 2); g.lineStyle(3, 0x6f4d32, 1); g.lineBetween(x - 39, y - 12, x - 44, y + 42); g.fillStyle(0x9fffea, 0.9); g.fillCircle(x - 44, y + 42, 4); g.fillStyle(0xffd166, 0.8); g.fillCircle(x + 32, y - 35, 7); g.fillStyle(0xfff2bd, 1); g.fillCircle(x + 32, y - 35, 3);
     g.fillStyle(0x1c2446, 1); g.fillRect(x - 48, y + 47, 96, 7); g.fillStyle(0xff784e, 1); g.fillRect(x - 44, y + 49, 88 * (this.playerHealth / MAX_HEALTH), 3);
  }

  private drawTarget(p: Point, t: number, hitT: number) {
    const g = this.art; const x = p.x; const y = p.y; const flash = this.phase === "impact" ? 0.55 * (1 - hitT) : 0; const activeSpell = this.projectileSpell ?? this.spell;
    g.fillStyle(0x050819, 0.6); g.fillEllipse(x, y + 48, 150, 30); g.fillStyle(0x3e4669, 1); g.beginPath(); g.moveTo(x - 48, y + 37); g.lineTo(x - 43, y - 23); g.lineTo(x - 25, y - 48); g.lineTo(x + 26, y - 48); g.lineTo(x + 47, y - 18); g.lineTo(x + 41, y + 39); g.closePath(); g.fillPath(); g.fillStyle(0x596487, 1); g.fillTriangle(x - 39, y - 19, x - 20, y - 47, x - 8, y - 18); g.fillTriangle(x + 4, y - 45, x + 26, y - 42, x + 39, y - 16); g.fillStyle(0x273052, 1); g.fillCircle(x - 20, y - 9, 6); g.fillCircle(x + 20, y - 9, 6); g.fillStyle(0xffa94d, 1); g.fillCircle(x - 20, y - 9, 3); g.fillCircle(x + 20, y - 9, 3); g.fillStyle(0xd86f4e, 0.9); g.fillCircle(x, y + 12, 13); g.fillStyle(0xffca63, 0.85); g.fillCircle(x, y + 12, 7 + Math.sin(t * 5) * 1.5); g.fillStyle(0x1c2446, 1); g.fillRect(x - 48, y + 30, 96, 9); g.fillStyle(0x63e3c9, 1); g.fillRect(x - 44, y + 32, 88 * (this.targetHealth / MAX_HEALTH), 5);
    if (flash > 0) { g.fillStyle(activeSpell.visualKind === "lightning" ? 0xd9faff : isFreezeSpell(activeSpell) ? 0xb7f7ff : isGhostPortalSpell(activeSpell) ? 0xd7c2ff : 0xfff4cf, flash); g.fillCircle(x, y, 62 * flash + 18); }
  }

  private drawSpell(wizard: Point, target: Point, time: number, t: number) {
    const activeSpell = this.projectileSpell ?? this.spell;
    this.freezeRings.setVisible(false);
    this.ghostPortal.setVisible(false);
    if (activeSpell.visualKind === "shield") {
      this.lightningBolt.setVisible(false); this.emberLance.setVisible(false);
      return;
    }
    if (activeSpell.visualKind === "lightning") {
      this.drawLightningSpell(wizard, target, time, t);
      return;
    }
    if (isGhostPortalSpell(activeSpell)) {
      this.drawPortalSpell(wizard, target, time, t, false);
      return;
    }
    if (isFreezeSpell(activeSpell)) {
      this.drawFreezeSpell(wizard, target, time, t, false);
      return;
    }
    this.lightningBolt.setVisible(false);
    this.emberLance.setVisible(false);
    if (this.phase === "ready") return;
    const elapsed = time - this.phaseStarted; const origin = { x: wizard.x + 32, y: wizard.y - 36 }; const destination = { x: target.x - 56, y: target.y - 5 };
    if (this.phase === "charging") {
      const p = Phaser.Math.Clamp(elapsed / activeSpell.timings.charging, 0, 1);
      this.drawMagicOrb(origin, 8 + p * 13, t, 1 - p * 0.2);
      this.emberLance.setPosition(origin.x, origin.y).setRotation(0).setScale(0.12 + p * 0.2).setAlpha(0.18 + p * 0.62).setVisible(true);
      for (let i = 0; i < 9; i += 1) {
        const a = t * 2.4 + i * 0.72; const r = 18 + (i % 3) * 8 + Math.sin(t * 4 + i) * 3;
        this.art.fillStyle(i % 2 ? 0xffa94d : 0x7ef5dc, 0.85); this.art.fillCircle(origin.x + Math.cos(a) * r, origin.y + Math.sin(a) * r, 2 + (i % 3));
      }
    } else if (this.phase === "flying") {
      const p = Phaser.Math.Clamp(elapsed / activeSpell.timings.flying, 0, 1);
      const x = Phaser.Math.Interpolation.QuadraticBezier(p, origin.x, (origin.x + destination.x) / 2, destination.x);
      const y = Phaser.Math.Interpolation.QuadraticBezier(p, origin.y, Math.min(origin.y, destination.y) - 80, destination.y);
      const angle = Phaser.Math.Angle.Between(origin.x, origin.y, destination.x, destination.y);
      for (let i = 10; i >= 1; i -= 1) {
        const trailP = Math.max(0, p - i * 0.018);
        const tx = Phaser.Math.Interpolation.QuadraticBezier(trailP, origin.x, (origin.x + destination.x) / 2, destination.x);
        const ty = Phaser.Math.Interpolation.QuadraticBezier(trailP, origin.y, Math.min(origin.y, destination.y) - 80, destination.y);
        this.art.fillStyle(i % 2 ? 0xff704d : 0xffd166, 0.08 + (11 - i) * 0.055); this.art.fillCircle(tx, ty, 4 + (11 - i) * 0.85);
        this.drawFlameRibbon(tx, ty, angle, 30 + (11 - i) * 2, t + i * 0.08, 0.32 + (11 - i) * 0.035);
      }
      this.drawMagicOrb({ x, y }, 14 + Math.sin(t * 11) * 2, t, 1);
      this.emberLance.setPosition(x, y).setRotation(angle).setScale(0.28 + Math.sin(t * 13) * 0.018).setAlpha(0.96).setVisible(true);
    } else if (this.phase === "impact") {
      const p = Phaser.Math.Clamp(elapsed / activeSpell.timings.impact, 0, 1); const radius = 20 + p * 95;
      this.art.lineStyle(5 * (1 - p), 0xffd166, 0.9 * (1 - p)); this.art.strokeCircle(destination.x, destination.y, radius);
      this.art.lineStyle(2, 0xff704d, 0.65 * (1 - p)); this.art.strokeCircle(destination.x, destination.y, radius * 0.6);
      for (let i = 0; i < 18; i += 1) {
        const a = (Math.PI * 2 * i) / 18 + 0.2; const d = 25 + p * 75 + (i % 3) * 10;
        this.art.fillStyle(i % 3 === 0 ? 0xfff2bd : 0xff704d, (1 - p) * 0.85); this.art.fillCircle(destination.x + Math.cos(a) * d, destination.y + Math.sin(a) * d, 2 + (1 - p) * 2);
      }
    }
  }

  private drawEnemySpell(wizard: Point, target: Point, time: number, t: number) {
    const activeSpell = this.enemyProjectileSpell;
    this.enemyFreezeRings.setVisible(false);
    this.enemyGhostPortal.setVisible(false);
    if (!activeSpell || this.enemyPhase === "ready") {
      this.enemyEmberLance.setVisible(false);
      if (this.projectileSpell?.visualKind !== "lightning") this.lightningBolt.setVisible(false);
      return;
    }
    if (activeSpell.visualKind === "lightning") {
      this.drawEnemyLightningSpell(wizard, target, time, t);
      return;
    }
    if (isFreezeSpell(activeSpell)) {
      this.drawFreezeSpell(wizard, target, time, t, true);
      return;
    }
    if (isGhostPortalSpell(activeSpell)) {
      this.drawPortalSpell(wizard, target, time, t, true);
      return;
    }
    const elapsed = time - this.enemyPhaseStarted;
    const origin = { x: target.x - 32, y: target.y - 36 };
    const destination = { x: wizard.x + 56, y: wizard.y - 41 };
    if (this.enemyPhase === "charging") {
      const progress = Phaser.Math.Clamp(elapsed / activeSpell.timings.charging, 0, 1);
      this.drawMagicOrb(origin, 8 + progress * 13, t, 1 - progress * 0.2);
      this.enemyEmberLance.setPosition(origin.x, origin.y).setRotation(Math.PI).setScale(0.12 + progress * 0.2).setAlpha(0.18 + progress * 0.62).setVisible(true);
    } else if (this.enemyPhase === "flying") {
      const progress = Phaser.Math.Clamp(elapsed / activeSpell.timings.flying, 0, 1);
      const x = Phaser.Math.Interpolation.QuadraticBezier(progress, origin.x, (origin.x + destination.x) / 2, destination.x);
      const y = Phaser.Math.Interpolation.QuadraticBezier(progress, origin.y, Math.min(origin.y, destination.y) - 80, destination.y);
      const angle = Phaser.Math.Angle.Between(origin.x, origin.y, destination.x, destination.y);
      for (let index = 10; index >= 1; index -= 1) {
        const trailProgress = Math.max(0, progress - index * 0.018);
        const trailX = Phaser.Math.Interpolation.QuadraticBezier(trailProgress, origin.x, (origin.x + destination.x) / 2, destination.x);
        const trailY = Phaser.Math.Interpolation.QuadraticBezier(trailProgress, origin.y, Math.min(origin.y, destination.y) - 80, destination.y);
        this.art.fillStyle(index % 2 ? 0xff704d : 0xffd166, 0.08 + (11 - index) * 0.055);
        this.art.fillCircle(trailX, trailY, 4 + (11 - index) * 0.85);
        this.drawFlameRibbon(trailX, trailY, angle, 30 + (11 - index) * 2, t + index * 0.08, 0.32 + (11 - index) * 0.035);
      }
      this.drawMagicOrb({ x, y }, 14 + Math.sin(t * 11) * 2, t, 1);
      this.enemyEmberLance.setPosition(x, y).setRotation(angle).setScale(0.28 + Math.sin(t * 13) * 0.018).setAlpha(0.96).setVisible(true);
    } else {
      const progress = Phaser.Math.Clamp(elapsed / activeSpell.timings.impact, 0, 1);
      const radius = 20 + progress * 95;
      this.art.lineStyle(5 * (1 - progress), 0xffd166, 0.9 * (1 - progress)); this.art.strokeCircle(destination.x, destination.y, radius);
      this.art.lineStyle(2, 0xff704d, 0.65 * (1 - progress)); this.art.strokeCircle(destination.x, destination.y, radius * 0.6);
    }
  }

  private drawEnemyLightningSpell(wizard: Point, target: Point, time: number, t: number) {
    const activeSpell = this.enemyProjectileSpell;
    if (!activeSpell) return;
    this.enemyEmberLance.setVisible(false);
    this.lightningBolt.setVisible(false);
    const elapsed = time - this.enemyPhaseStarted;
    const origin = { x: target.x - 32, y: target.y - 36 };
    const destination = { x: wizard.x + 56, y: wizard.y - 41 };
    if (this.enemyPhase === "charging") {
      const progress = Phaser.Math.Clamp(elapsed / activeSpell.timings.charging, 0, 1);
      this.drawElectricOrb(origin, 8 + progress * 13, t, 1 - progress * 0.2);
      this.lightningBolt.setPosition(origin.x, origin.y).setRotation(Math.PI - 0.08).setScale(0.1 + progress * 0.22).setAlpha(0.18 + progress * 0.62).setVisible(true);
    } else if (this.enemyPhase === "flying") {
      const progress = Phaser.Math.Clamp(elapsed / activeSpell.timings.flying, 0, 1);
      const x = Phaser.Math.Interpolation.QuadraticBezier(progress, origin.x, (origin.x + destination.x) / 2, destination.x);
      const y = Phaser.Math.Interpolation.QuadraticBezier(progress, origin.y, Math.min(origin.y, destination.y) - 80, destination.y);
      const angle = Phaser.Math.Angle.Between(origin.x, origin.y, destination.x, destination.y);
      this.drawElectricOrb({ x, y }, 14 + Math.sin(t * 17) * 2, t, 1);
      this.lightningBolt.setPosition(x, y).setRotation(angle).setScale(0.28 + Math.sin(t * 18) * 0.018).setAlpha(0.96).setVisible(true);
      for (let index = 1; index <= 8; index += 1) {
        const trailProgress = Math.max(0, progress - index * 0.02);
        const trailX = Phaser.Math.Interpolation.QuadraticBezier(trailProgress, origin.x, (origin.x + destination.x) / 2, destination.x);
        const trailY = Phaser.Math.Interpolation.QuadraticBezier(trailProgress, origin.y, Math.min(origin.y, destination.y) - 80, destination.y);
        this.art.fillStyle(index % 2 ? 0x6685ff : 0xb8f5ff, 0.1); this.art.fillCircle(trailX, trailY, 3 + index * 0.6);
      }
    } else {
      const progress = Phaser.Math.Clamp(elapsed / activeSpell.timings.impact, 0, 1);
      const radius = 20 + progress * 95;
      this.art.lineStyle(6 * (1 - progress), 0xb7f7ff, 0.92 * (1 - progress)); this.art.strokeCircle(destination.x, destination.y, radius);
      for (let index = 0; index < 8; index += 1) {
        const angle = (Math.PI * 2 * index) / 8 + t * 0.6;
        this.drawElectricArc(destination, { x: destination.x + Math.cos(angle) * (28 + progress * 82), y: destination.y + Math.sin(angle) * (28 + progress * 82) }, t + index * 0.6, (1 - progress) * 0.82);
      }
    }
  }

  private drawLightningSpell(wizard: Point, target: Point, time: number, t: number) {
    this.lightningBolt.setVisible(false);
    if (this.phase === "ready") return;
    const activeSpell = this.projectileSpell ?? this.spell;
    const elapsed = time - this.phaseStarted; const origin = { x: wizard.x + 32, y: wizard.y - 36 }; const destination = { x: target.x - 56, y: target.y - 5 };
    if (this.phase === "charging") {
      const p = Phaser.Math.Clamp(elapsed / activeSpell.timings.charging, 0, 1);
      this.drawElectricOrb(origin, 8 + p * 13, t, 1 - p * 0.2);
      this.lightningBolt.setPosition(origin.x, origin.y).setRotation(-0.08).setScale(0.1 + p * 0.22).setAlpha(0.18 + p * 0.62).setVisible(true);
      for (let i = 0; i < 7; i += 1) {
        const a = t * 3.2 + i * 0.9; const r = 18 + (i % 3) * 8 + Math.sin(t * 5 + i) * 3;
        const spark = { x: origin.x + Math.cos(a) * r, y: origin.y + Math.sin(a) * r };
        this.drawElectricArc(origin, spark, t + i, 0.42);
      }
    } else if (this.phase === "flying") {
      const p = Phaser.Math.Clamp(elapsed / activeSpell.timings.flying, 0, 1);
      const point = (progress: number) => ({
        x: Phaser.Math.Interpolation.QuadraticBezier(progress, origin.x, (origin.x + destination.x) / 2, destination.x),
        y: Phaser.Math.Interpolation.QuadraticBezier(progress, origin.y, Math.min(origin.y, destination.y) - 80, destination.y),
      });
      const current = point(p);
      const angle = Phaser.Math.Angle.Between(origin.x, origin.y, destination.x, destination.y);
      for (let i = 11; i >= 1; i -= 1) {
        const trailP = Math.max(0, p - i * 0.018);
        const trail = point(trailP);
        const previous = point(Math.max(0, trailP - 0.05));
        this.art.fillStyle(i % 2 ? 0x6685ff : 0xb8f5ff, 0.06 + (12 - i) * 0.045); this.art.fillCircle(trail.x, trail.y, 3 + (12 - i) * 0.9);
        this.drawElectricArc(previous, trail, t + i * 0.13, 0.22 + (12 - i) * 0.035);
      }
      this.drawElectricOrb(current, 14 + Math.sin(t * 17) * 2, t, 1);
      this.lightningBolt.setPosition(current.x, current.y).setRotation(angle).setScale(0.28 + Math.sin(t * 18) * 0.018).setAlpha(0.96).setVisible(true);
    } else if (this.phase === "impact") {
      const p = Phaser.Math.Clamp(elapsed / activeSpell.timings.impact, 0, 1); const radius = 20 + p * 95;
      this.art.lineStyle(6 * (1 - p), 0xb7f7ff, 0.92 * (1 - p)); this.art.strokeCircle(destination.x, destination.y, radius);
      this.art.lineStyle(2, 0x728bff, 0.75 * (1 - p)); this.art.strokeCircle(destination.x, destination.y, radius * 0.62);
      for (let i = 0; i < 10; i += 1) {
        const a = (Math.PI * 2 * i) / 10 + t * 0.6; const d = 28 + p * 82 + (i % 3) * 10;
        const end = { x: destination.x + Math.cos(a) * d, y: destination.y + Math.sin(a) * d };
        this.drawElectricArc(destination, end, t + i * 0.6, (1 - p) * 0.82);
      }
    }
  }

  private drawFreezeSpell(wizard: Point, target: Point, time: number, t: number, enemy: boolean) {
    const activeSpell = enemy ? this.enemyProjectileSpell : this.projectileSpell ?? this.spell;
    if (!activeSpell) return;
    this.emberLance.setVisible(false);
    this.enemyEmberLance.setVisible(false);
    this.lightningBolt.setVisible(false);
    const elapsed = time - (enemy ? this.enemyPhaseStarted : this.phaseStarted);
    const phase = enemy ? this.enemyPhase : this.phase;
    const origin = enemy ? { x: target.x - 32, y: target.y - 36 } : { x: wizard.x + 32, y: wizard.y - 36 };
    const destination = enemy ? { x: wizard.x + 56, y: wizard.y - 41 } : { x: target.x - 56, y: target.y - 5 };
    const direction = enemy ? Math.PI : 0;
    const rings = enemy ? this.enemyFreezeRings : this.freezeRings;
    rings.setVisible(false);
    if (phase === "charging") {
      const progress = Phaser.Math.Clamp(elapsed / activeSpell.timings.charging, 0, 1);
      this.drawFrostOrb(origin, 8 + progress * 13, t, 1 - progress * 0.2);
      rings.setPosition(origin.x, origin.y).setRotation(direction).setScale(0.12 + progress * 0.08).setAlpha(0.18 + progress * 0.5).setVisible(true);
      this.art.lineStyle(2, 0xb7f7ff, 0.65);
      this.art.strokeCircle(origin.x, origin.y, 28 + progress * 22);
    } else if (phase === "flying") {
      const progress = Phaser.Math.Clamp(elapsed / activeSpell.timings.flying, 0, 1);
      const x = Phaser.Math.Interpolation.QuadraticBezier(progress, origin.x, (origin.x + destination.x) / 2, destination.x);
      const y = Phaser.Math.Interpolation.QuadraticBezier(progress, origin.y, Math.min(origin.y, destination.y) - 80, destination.y);
      for (let index = 8; index >= 1; index -= 1) {
        const trailProgress = Math.max(0, progress - index * 0.025);
        const trailX = Phaser.Math.Interpolation.QuadraticBezier(trailProgress, origin.x, (origin.x + destination.x) / 2, destination.x);
        const trailY = Phaser.Math.Interpolation.QuadraticBezier(trailProgress, origin.y, Math.min(origin.y, destination.y) - 80, destination.y);
        this.art.fillStyle(index % 2 ? 0x8deaff : 0xe3fbff, 0.1 + (9 - index) * 0.06);
        this.art.fillCircle(trailX, trailY, 4 + (9 - index) * 0.8);
      }
      this.drawFrostOrb({ x, y }, 14 + Math.sin(t * 11) * 2, t, 1);
      rings.setPosition(x, y).setRotation(direction + t * 0.35).setScale(0.18).setAlpha(0.88).setVisible(true);
      this.art.lineStyle(2, 0xb7f7ff, 0.65);
      this.art.lineBetween(x - Math.cos(direction) * 22, y - Math.sin(direction) * 22, x + Math.cos(direction) * 22, y + Math.sin(direction) * 22);
    } else if (phase === "impact") {
      const progress = Phaser.Math.Clamp(elapsed / activeSpell.timings.impact, 0, 1);
      const radius = 20 + progress * 95;
      rings.setPosition(destination.x, destination.y).setRotation(t * 0.25).setScale(0.22 + progress * 0.2).setAlpha(0.82 * (1 - progress)).setVisible(true);
      this.art.lineStyle(5 * (1 - progress), 0xb7f7ff, 0.9 * (1 - progress));
      this.art.strokeCircle(destination.x, destination.y, radius);
      for (let index = 0; index < 8; index += 1) {
        const angle = (Math.PI * 2 * index) / 8 + t * 0.3;
        const distance = 28 + progress * 72;
        this.art.lineBetween(destination.x, destination.y, destination.x + Math.cos(angle) * distance, destination.y + Math.sin(angle) * distance);
      }
    }
  }

  private drawPortalSpell(wizard: Point, target: Point, time: number, t: number, enemy: boolean) {
    const activeSpell = enemy ? this.enemyProjectileSpell : this.projectileSpell ?? this.spell;
    if (!activeSpell) return;
    this.emberLance.setVisible(false);
    this.enemyEmberLance.setVisible(false);
    this.lightningBolt.setVisible(false);
    const elapsed = time - (enemy ? this.enemyPhaseStarted : this.phaseStarted);
    const phase = enemy ? this.enemyPhase : this.phase;
    const origin = enemy ? { x: target.x - 32, y: target.y - 36 } : { x: wizard.x + 32, y: wizard.y - 36 };
    const destination = enemy ? { x: wizard.x + 56, y: wizard.y - 41 } : { x: target.x - 56, y: target.y - 5 };
    const direction = enemy ? Math.PI : 0;
    const portalImage = enemy ? this.enemyGhostPortal : this.ghostPortal;
    const travelPoint = (progress: number) => {
      const control = { x: (origin.x + destination.x) / 2, y: Math.min(origin.y, destination.y) - 90 };
      return {
        x: Phaser.Math.Interpolation.QuadraticBezier(progress, origin.x, control.x, destination.x),
        y: Phaser.Math.Interpolation.QuadraticBezier(progress, origin.y, control.y, destination.y),
      };
    };

    if (phase === "charging") {
      const progress = Phaser.Math.Clamp(elapsed / activeSpell.timings.charging, 0, 1);
      this.drawPortalGate(origin, 24 + progress * 23, t, 0.35 + progress * 0.5, direction, portalImage);
      this.drawSpectralOrb(origin, 8 + progress * 12, t, 0.7);
      return;
    }
    if (phase === "flying") {
      const progress = Phaser.Math.Clamp(elapsed / activeSpell.timings.flying, 0, 1);
      this.drawPortalGate(origin, 45 + Math.sin(t * 7) * 3, t, 0.86, direction, portalImage);
      for (let index = 0; index < 3; index += 1) {
        const ghostProgress = Phaser.Math.Clamp((progress - index * 0.12) / 0.88, 0, 1);
        if (ghostProgress <= 0) continue;
        const ghost = travelPoint(ghostProgress);
        for (let trailIndex = 4; trailIndex >= 1; trailIndex -= 1) {
          const trail = travelPoint(Math.max(0, ghostProgress - trailIndex * 0.035));
          this.art.fillStyle(trailIndex % 2 ? 0xb898ff : 0xe5d8ff, 0.06 + (5 - trailIndex) * 0.045);
          this.art.fillCircle(trail.x, trail.y, 3 + (5 - trailIndex) * 0.8);
        }
        this.drawGhost(ghost, 15 + index * 1.5, t + index * 0.55, 0.9);
      }
      return;
    }
    if (phase !== "impact") return;

    const progress = Phaser.Math.Clamp(elapsed / activeSpell.timings.impact, 0, 1);
    this.drawPortalGate(origin, 48 + Math.sin(t * 7) * 3, t, 0.7 * (1 - progress), direction, portalImage);
    for (let index = 0; index < 3; index += 1) {
      const angle = -Math.PI / 2 + index * (Math.PI * 2 / 3) + direction;
      const distanceFromTarget = 18 + progress * 24;
      const ghost = {
        x: destination.x + Math.cos(angle) * distanceFromTarget,
        y: destination.y + Math.sin(angle) * distanceFromTarget,
      };
      const ghostAlpha = (1 - progress) * 0.92;
      this.drawGhost(ghost, 15 + index * 1.5, t + index * 0.55, ghostAlpha);
      this.art.lineStyle(2, 0xd8c8ff, (1 - progress) * 0.42);
      this.art.lineBetween(ghost.x, ghost.y + 6, destination.x, destination.y);
    }
  }

  private drawPortalGate(center: Point, radius: number, t: number, alpha: number, rotation: number, portalImage: Phaser.GameObjects.Image) {
    const g = this.art;
    portalImage
      .setPosition(center.x, center.y)
      .setRotation(Math.sin(t * 0.8) * 0.025)
      .setScale(radius / 150)
      .setAlpha(Math.min(1, alpha * 0.92))
      .setVisible(true);
    g.fillStyle(0x8d70ff, alpha * 0.08); g.fillCircle(center.x, center.y, radius * 1.8);
    for (let index = 0; index < 3; index += 1) {
      const ringRadius = radius * (1 - index * 0.22);
      g.lineStyle(4 - index, index === 0 ? 0x8068ed : index === 1 ? 0xb99dff : 0xf0e8ff, alpha * (0.78 - index * 0.12));
      g.strokeCircle(center.x, center.y, ringRadius + Math.sin(t * (2.5 + index) + rotation) * 2);
    }
    for (let index = 0; index < 6; index += 1) {
      const angle = rotation + t * 0.7 + index * Math.PI / 3;
      const inner = radius * 0.7;
      const outer = radius * 1.05;
      g.lineStyle(2, 0xe6dcff, alpha * 0.6);
      g.lineBetween(center.x + Math.cos(angle) * inner, center.y + Math.sin(angle) * inner, center.x + Math.cos(angle) * outer, center.y + Math.sin(angle) * outer);
    }
  }

  private drawSpectralOrb(center: Point, radius: number, t: number, alpha: number) {
    const g = this.art;
    g.fillStyle(0x8068ed, alpha * 0.12); g.fillCircle(center.x, center.y, radius * 2.9);
    g.fillStyle(0xb99dff, alpha * 0.32); g.fillCircle(center.x, center.y, radius * 1.6);
    g.fillStyle(0x8068ed, alpha * 0.95); g.fillCircle(center.x, center.y, radius);
    g.fillStyle(0xf0e8ff, alpha); g.fillCircle(center.x - 3, center.y - 3, radius * 0.42);
    g.lineStyle(2, 0xe0d3ff, alpha * 0.8); g.strokeCircle(center.x, center.y, radius + Math.sin(t * 10) * 2);
  }

  private drawGhost(center: Point, size: number, t: number, alpha: number) {
    if (alpha <= 0) return;
    const g = this.art;
    const x = center.x;
    const y = center.y + Math.sin(t * 7) * 2;
    g.fillStyle(0x8068ed, alpha * 0.16); g.fillCircle(x, y + size * 0.55, size * 1.7);
    g.fillStyle(0xd9ccff, alpha * 0.9); g.fillCircle(x, y - size * 0.48, size * 0.58);
    g.fillStyle(0xb49cff, alpha * 0.82);
    g.beginPath();
    g.moveTo(x - size * 0.62, y - size * 0.14);
    g.lineTo(x - size * 0.52, y + size * 0.78);
    g.lineTo(x - size * 0.2, y + size * 0.57);
    g.lineTo(x, y + size * 0.82);
    g.lineTo(x + size * 0.2, y + size * 0.57);
    g.lineTo(x + size * 0.52, y + size * 0.78);
    g.lineTo(x + size * 0.62, y - size * 0.14);
    g.closePath();
    g.fillPath();
    g.fillStyle(0x261c63, alpha);
    g.fillCircle(x - size * 0.2, y - size * 0.5, Math.max(1.5, size * 0.12));
    g.fillCircle(x + size * 0.2, y - size * 0.5, Math.max(1.5, size * 0.12));
  }

  private drawFreezeStatus(wizard: Point, target: Point, time: number, t: number) {
    if (time < this.playerFrozenUntil) {
      const remaining = Phaser.Math.Clamp((this.playerFrozenUntil - time) / DEFAULT_FREEZE_DURATION_MS, 0, 1);
      this.freezeRings.setPosition(wizard.x, wizard.y - 36).setRotation(t * 0.25).setScale(0.52 + Math.sin(t * 5) * 0.02).setAlpha(0.5 + remaining * 0.35).setVisible(true);
    }
    if (time < this.enemyFrozenUntil) {
      const remaining = Phaser.Math.Clamp((this.enemyFrozenUntil - time) / DEFAULT_FREEZE_DURATION_MS, 0, 1);
      this.enemyFreezeRings.setPosition(target.x, target.y - 36).setRotation(-t * 0.25).setScale(0.52 + Math.sin(t * 5 + 1) * 0.02).setAlpha(0.5 + remaining * 0.35).setVisible(true);
    }
  }

  private drawFlameRibbon(x: number, y: number, angle: number, length: number, time: number, alpha: number) {
    const ux = Math.cos(angle); const uy = Math.sin(angle); const vx = -uy; const vy = ux;
    const wave = Math.sin(time * 8) * 3;
    this.art.lineStyle(10, 0xff5b31, alpha * 0.14); this.art.lineBetween(x - ux * length, y - uy * length, x, y);
    this.art.lineStyle(4, 0xffa33c, alpha * 0.5); this.art.lineBetween(x - ux * length + vx * wave, y - uy * length + vy * wave, x - ux * 4, y - uy * 4);
    this.art.lineStyle(1.5, 0xfff2bd, alpha * 0.8); this.art.lineBetween(x - ux * (length * 0.72) - vx * wave, y - uy * (length * 0.72) - vy * wave, x - ux * 8, y - uy * 8);
  }

  private drawElectricArc(start: Point, end: Point, seed: number, alpha: number) {
    const dx = end.x - start.x; const dy = end.y - start.y; const length = Math.hypot(dx, dy) || 1;
    const normal = { x: -dy / length, y: dx / length };
    const points = [start];
    for (let index = 1; index < 5; index += 1) {
      const progress = index / 5;
      const jitter = Math.sin(seed * 6.7 + index * 3.9) * Math.min(13, length * 0.22);
      points.push({ x: start.x + dx * progress + normal.x * jitter, y: start.y + dy * progress + normal.y * jitter });
    }
    points.push(end);
    const drawPath = () => {
      this.art.beginPath();
      this.art.moveTo(points[0].x, points[0].y);
      points.slice(1).forEach((point) => this.art.lineTo(point.x, point.y));
      this.art.strokePath();
    };
    this.art.lineStyle(10, 0x586fff, alpha * 0.15); drawPath();
    this.art.lineStyle(3, 0x5acbff, alpha * 0.72); drawPath();
    this.art.lineStyle(1, 0xf2ffff, alpha * 0.98); drawPath();
  }

  private drawMagicOrb(p: Point, radius: number, t: number, alpha: number) {
    const g = this.art; g.fillStyle(0xff704d, 0.1 * alpha); g.fillCircle(p.x, p.y, radius * 2.8); g.fillStyle(0xffa94d, 0.28 * alpha); g.fillCircle(p.x, p.y, radius * 1.6); g.fillStyle(0xff704d, 0.95 * alpha); g.fillCircle(p.x, p.y, radius); g.fillStyle(0xfff2bd, alpha); g.fillCircle(p.x - 3, p.y - 3, radius * 0.45); g.lineStyle(2, 0xffd166, 0.8 * alpha); g.strokeCircle(p.x, p.y, radius + Math.sin(t * 8) * 2);
  }

  private drawElectricOrb(p: Point, radius: number, t: number, alpha: number) {
    const g = this.art; g.fillStyle(0x566dff, 0.1 * alpha); g.fillCircle(p.x, p.y, radius * 2.8); g.fillStyle(0x63d9ff, 0.26 * alpha); g.fillCircle(p.x, p.y, radius * 1.6); g.fillStyle(0x5296ff, 0.95 * alpha); g.fillCircle(p.x, p.y, radius); g.fillStyle(0xf3ffff, alpha); g.fillCircle(p.x - 3, p.y - 3, radius * 0.45); g.lineStyle(2, 0x9aeaff, 0.8 * alpha); g.strokeCircle(p.x, p.y, radius + Math.sin(t * 12) * 2);
  }

  private drawFrostOrb(p: Point, radius: number, t: number, alpha: number) {
    const g = this.art;
    g.fillStyle(0x75dfff, 0.1 * alpha); g.fillCircle(p.x, p.y, radius * 2.8);
    g.fillStyle(0xb7f7ff, 0.26 * alpha); g.fillCircle(p.x, p.y, radius * 1.6);
    g.fillStyle(0x75bfff, 0.95 * alpha); g.fillCircle(p.x, p.y, radius);
    g.fillStyle(0xf3ffff, alpha); g.fillCircle(p.x - 3, p.y - 3, radius * 0.45);
    g.lineStyle(2, 0xd9faff, 0.8 * alpha); g.strokeCircle(p.x, p.y, radius + Math.sin(t * 9) * 2);
  }

  private drawShield(wizard: Point, time: number, t: number) {
    this.shield.setVisible(false);
    if (!this.shieldActive && time >= this.shieldBlockedUntil) return;
    const blocked = !this.shieldActive;
    const remaining = this.shieldActive ? Phaser.Math.Clamp((this.shieldUntil - time) / 500, 0, 1) : Phaser.Math.Clamp((this.shieldBlockedUntil - time) / 440, 0, 1);
    const pulse = 1 + Math.sin(t * 8) * 0.025;
    this.shield.setPosition(wizard.x, wizard.y - 36).setScale((0.96 + remaining * 0.08) * pulse).setAlpha(blocked ? remaining * 0.9 : 0.88).setVisible(true);
    if (blocked) {
      this.art.lineStyle(4 * remaining, 0xf3ffff, remaining * 0.9);
      this.art.strokeCircle(wizard.x, wizard.y - 36, 92 + (1 - remaining) * 20);
      for (let index = 0; index < 8; index += 1) {
        const angle = (Math.PI * 2 * index) / 8 + t;
        this.art.lineBetween(wizard.x, wizard.y - 36, wizard.x + Math.cos(angle) * 112, wizard.y - 36 + Math.sin(angle) * 112);
      }
    }
  }

  private drawEnemyShield(target: Point, time: number, t: number) {
    const active = this.enemyShieldActive || time < this.enemyShieldBlockedUntil;
    this.enemyShield.setVisible(false);
    if (!active) return;
    const blocked = !this.enemyShieldActive;
    const remaining = this.enemyShieldActive ? Phaser.Math.Clamp((this.enemyShieldUntil - time) / 500, 0, 1) : Phaser.Math.Clamp((this.enemyShieldBlockedUntil - time) / 440, 0, 1);
    this.enemyShield.setPosition(target.x, target.y - 36).setScale((0.96 + remaining * 0.08) * (1 + Math.sin(t * 8) * 0.025)).setAlpha(blocked ? remaining * 0.9 : 0.88).setVisible(true);
    if (blocked) {
      this.art.lineStyle(4 * remaining, 0xf3ffff, remaining * 0.9);
      this.art.strokeCircle(target.x, target.y - 36, 92 + (1 - remaining) * 20);
    }
  }
}

export function createArenaGame(parent: HTMLElement, callbacks: ArenaCallbacks, spellId: SpellId = "ember-lance", drawingToolState: DrawingToolState = { value: DEFAULT_DRAWING_TOOL }, mode: ArenaMode = "duel") {
  return new Phaser.Game({ type: Phaser.AUTO, parent, backgroundColor: "#090d24", scene: new ArenaScene(callbacks, spellId, drawingToolState, mode), scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight }, render: { antialias: true, pixelArt: false } });
}
