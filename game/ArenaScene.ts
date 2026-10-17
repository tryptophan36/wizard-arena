import Phaser from "phaser";
import { EMBER_LANCE_RUNE_HINT, recognizeEmberLanceRune, type RunePoint } from "@/game/runeGesture";

export type GestureStatus = "idle" | "drawing" | "recognized" | "failed";

export type GestureFeedback = {
  status: GestureStatus;
  message: string;
  hint: string;
};

export type ArenaCallbacks = {
  onManaChange: (mana: number) => void;
  onTargetHealthChange: (health: number) => void;
  onCooldownChange: (seconds: number) => void;
  onPhaseChange: (phase: "ready" | "charging" | "flying" | "impact") => void;
  onGestureChange: (feedback: GestureFeedback) => void;
};

const MAX_MANA = 100;
const SPELL_COST = 25;
const MAX_HEALTH = 100;
const COOLDOWN = 2.4;
type Point = { x: number; y: number };
const INITIAL_GESTURE: GestureFeedback = { status: "idle", message: "DRAW EMBER LANCE RUNE", hint: EMBER_LANCE_RUNE_HINT };

export class ArenaScene extends Phaser.Scene {
  private callbacks: ArenaCallbacks;
  private phase: "ready" | "charging" | "flying" | "impact" = "ready";
  private phaseStarted = 0;
  private cooldownUntil = 0;
  private mana = MAX_MANA;
  private targetHealth = MAX_HEALTH;
  private lastUiUpdate = -1;
  private art!: Phaser.GameObjects.Graphics;
  private gesturePoints: RunePoint[] = [];
  private gestureActive = false;
  private gestureFeedback = INITIAL_GESTURE;
  private gestureFeedbackUntil = 0;

  constructor(callbacks: ArenaCallbacks) {
    super({ key: "WizardArena" });
    this.callbacks = callbacks;
  }

  create() {
    this.art = this.add.graphics();
    this.input.on("pointerdown", this.handlePointerDown, this);
    this.input.on("pointermove", this.handlePointerMove, this);
    this.input.on("pointerup", this.handlePointerUp, this);
    this.input.on("pointerupoutside", this.handlePointerUp, this);
    this.scale.on("resize", () => this.drawArena(0));
    this.callbacks.onPhaseChange("ready");
    this.callbacks.onManaChange(this.mana);
    this.callbacks.onTargetHealthChange(this.targetHealth);
    this.callbacks.onGestureChange(INITIAL_GESTURE);
    this.drawArena(0);
  }

  update(time: number, delta: number) {
    const dt = delta / 1000;
    if (this.phase === "ready" && this.mana < MAX_MANA) this.mana = Math.min(MAX_MANA, this.mana + dt * 5);
    if (!this.gestureActive && this.gestureFeedbackUntil > 0 && time >= this.gestureFeedbackUntil) {
      this.gestureFeedbackUntil = 0;
      this.gesturePoints = [];
      this.setGestureFeedback(INITIAL_GESTURE);
    }
    const cooldown = Math.max(0, (this.cooldownUntil - time) / 1000);
    if (Math.abs(cooldown - this.lastUiUpdate) > 0.03 || cooldown === 0) {
      this.lastUiUpdate = cooldown;
      this.callbacks.onCooldownChange(cooldown);
      this.callbacks.onManaChange(this.mana);
    }
    if (this.phase === "charging" && time - this.phaseStarted > 460) {
      this.phase = "flying"; this.phaseStarted = time; this.callbacks.onPhaseChange("flying");
    } else if (this.phase === "flying" && time - this.phaseStarted > 650) {
      this.phase = "impact"; this.phaseStarted = time; this.targetHealth = Math.max(0, this.targetHealth - 25);
      this.callbacks.onTargetHealthChange(this.targetHealth); this.callbacks.onPhaseChange("impact");
    } else if (this.phase === "impact" && time - this.phaseStarted > 720) {
      this.phase = "ready"; this.callbacks.onPhaseChange("ready");
    }
    this.drawArena(time);
  }

  private handlePointerDown(pointer: Phaser.Input.Pointer) {
    if (pointer.wasTouch || pointer.button !== 0 || this.gestureActive) return;
    this.gestureActive = true;
    this.gesturePoints = [{ x: pointer.worldX, y: pointer.worldY }];
    this.gestureFeedbackUntil = 0;
    this.setGestureFeedback({ status: "drawing", message: "TRACING RUNE…", hint: "KEEP HOLDING · DOWN THEN UP-RIGHT" });
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer) {
    if (!this.gestureActive || !pointer.leftButtonDown() || pointer.wasTouch) return;
    const next = { x: pointer.worldX, y: pointer.worldY };
    const previous = this.gesturePoints[this.gesturePoints.length - 1];
    if (!previous || Phaser.Math.Distance.Between(previous.x, previous.y, next.x, next.y) >= 4) this.gesturePoints.push(next);
  }

  private handlePointerUp(pointer: Phaser.Input.Pointer) {
    if (!this.gestureActive || pointer.wasTouch) return;
    this.gestureActive = false;
    const finalPoint = { x: pointer.worldX, y: pointer.worldY };
    const previous = this.gesturePoints[this.gesturePoints.length - 1];
    if (!previous || Phaser.Math.Distance.Between(previous.x, previous.y, finalPoint.x, finalPoint.y) >= 2) this.gesturePoints.push(finalPoint);

    const recognition = recognizeEmberLanceRune(this.gesturePoints, Math.min(this.scale.width, this.scale.height));
    if (!recognition.recognized) {
      const hint = recognition.reason === "too-short" ? "DRAW A LONGER RUNE" : recognition.reason === "downward-stroke" ? "START WITH A STRAIGHT DOWNWARD STROKE" : "FINISH WITH AN UP-RIGHT DIAGONAL HOOK";
      this.showGestureFeedback({ status: "failed", message: "RUNE NOT RECOGNIZED", hint });
      return;
    }

    if (this.castEmberLance()) this.showGestureFeedback({ status: "recognized", message: "RUNE ACCEPTED", hint: "EMBER LANCE RELEASED" });
    else this.showGestureFeedback({ status: "failed", message: "RUNE CANNOT FIRE YET", hint: this.mana < SPELL_COST ? "WAIT FOR MANA" : "WAIT FOR THE CURRENT CAST TO FINISH" });
  }

  private setGestureFeedback(feedback: GestureFeedback) {
    this.gestureFeedback = feedback;
    this.callbacks.onGestureChange(feedback);
  }

  private showGestureFeedback(feedback: GestureFeedback) {
    this.gestureFeedbackUntil = (this.game.loop?.time ?? 0) + 1100;
    this.setGestureFeedback(feedback);
  }

  private castEmberLance() {
    const now = this.game.loop?.time ?? 0;
    if (this.phase !== "ready" || now < this.cooldownUntil || this.mana < SPELL_COST) return false;
    this.mana -= SPELL_COST; this.cooldownUntil = now + COOLDOWN * 1000;
    this.phase = "charging"; this.phaseStarted = now;
    this.callbacks.onManaChange(this.mana); this.callbacks.onCooldownChange(COOLDOWN); this.callbacks.onPhaseChange("charging");
    return true;
  }

  private drawArena(time: number) {
    const width = this.scale.width; const height = this.scale.height; const t = time / 1000;
    const wizard: Point = { x: width * 0.265, y: height * 0.67 };
    const targetBase: Point = { x: width * 0.73, y: height * 0.62 };
    const hitT = this.phase === "impact" ? Phaser.Math.Clamp((time - this.phaseStarted) / 720, 0, 1) : 0;
    const target: Point = { x: targetBase.x + (this.phase === "impact" ? Math.sin(hitT * Math.PI * 8) * (1 - hitT) * 10 : 0), y: targetBase.y };
    this.art.clear(); this.drawBackdrop(width, height, t); this.drawArenaFloor(width, height, t);
    this.drawWizard(wizard, t); this.drawTarget(target, t, hitT); this.drawSpell(wizard, target, time, t); this.drawGesture(time);
  }

  private drawGesture(time: number) {
    if (this.gesturePoints.length < 2) return;
    const age = this.gestureFeedbackUntil > 0 ? Math.max(0, time - (this.gestureFeedbackUntil - 1100)) : 0;
    const alpha = this.gestureActive ? 1 : Phaser.Math.Clamp(1 - age / 1100, 0.2, 1);
    const color = this.gestureFeedback.status === "failed" ? 0xff784e : this.gestureFeedback.status === "recognized" ? 0xffd166 : 0x72e6d3;
    const drawPath = () => {
      this.art.beginPath();
      this.art.moveTo(this.gesturePoints[0].x, this.gesturePoints[0].y);
      this.gesturePoints.slice(1).forEach((point) => this.art.lineTo(point.x, point.y));
      this.art.strokePath();
    };
    this.art.lineStyle(18, color, 0.08 * alpha); drawPath();
    this.art.lineStyle(8, color, 0.2 * alpha); drawPath();
    this.art.lineStyle(3, 0xf6fff3, 0.95 * alpha); drawPath();
    const tip = this.gesturePoints[this.gesturePoints.length - 1];
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
  }

  private drawTarget(p: Point, t: number, hitT: number) {
    const g = this.art; const x = p.x; const y = p.y; const flash = this.phase === "impact" ? 0.55 * (1 - hitT) : 0;
    g.fillStyle(0x050819, 0.6); g.fillEllipse(x, y + 48, 150, 30); g.fillStyle(0x3e4669, 1); g.beginPath(); g.moveTo(x - 48, y + 37); g.lineTo(x - 43, y - 23); g.lineTo(x - 25, y - 48); g.lineTo(x + 26, y - 48); g.lineTo(x + 47, y - 18); g.lineTo(x + 41, y + 39); g.closePath(); g.fillPath(); g.fillStyle(0x596487, 1); g.fillTriangle(x - 39, y - 19, x - 20, y - 47, x - 8, y - 18); g.fillTriangle(x + 4, y - 45, x + 26, y - 42, x + 39, y - 16); g.fillStyle(0x273052, 1); g.fillCircle(x - 20, y - 9, 6); g.fillCircle(x + 20, y - 9, 6); g.fillStyle(0xffa94d, 1); g.fillCircle(x - 20, y - 9, 3); g.fillCircle(x + 20, y - 9, 3); g.fillStyle(0xd86f4e, 0.9); g.fillCircle(x, y + 12, 13); g.fillStyle(0xffca63, 0.85); g.fillCircle(x, y + 12, 7 + Math.sin(t * 5) * 1.5); g.fillStyle(0x1c2446, 1); g.fillRect(x - 48, y + 30, 96, 9); g.fillStyle(0x63e3c9, 1); g.fillRect(x - 44, y + 32, 88 * (this.targetHealth / MAX_HEALTH), 5);
    if (flash > 0) { g.fillStyle(0xfff4cf, flash); g.fillCircle(x, y, 62 * flash + 18); }
  }

  private drawSpell(wizard: Point, target: Point, time: number, t: number) {
    if (this.phase === "ready") return;
    const elapsed = time - this.phaseStarted; const origin = { x: wizard.x + 32, y: wizard.y - 36 }; const destination = { x: target.x - 56, y: target.y - 5 };
    if (this.phase === "charging") { const p = Phaser.Math.Clamp(elapsed / 460, 0, 1); this.drawMagicOrb(origin, 8 + p * 13, t, 1 - p * 0.2); for (let i = 0; i < 7; i += 1) { const a = t * 2 + i; const r = 18 + (i % 3) * 8; this.art.fillStyle(i % 2 ? 0xffa94d : 0x7ef5dc, 0.85); this.art.fillCircle(origin.x + Math.cos(a) * r, origin.y + Math.sin(a) * r, 2); } }
    else if (this.phase === "flying") { const p = Phaser.Math.Clamp(elapsed / 650, 0, 1); const x = Phaser.Math.Interpolation.QuadraticBezier(p, origin.x, (origin.x + destination.x) / 2, destination.x); const y = Phaser.Math.Interpolation.QuadraticBezier(p, origin.y, Math.min(origin.y, destination.y) - 80, destination.y); for (let i = 8; i >= 1; i -= 1) { const trailP = Math.max(0, p - i * 0.018); const tx = Phaser.Math.Interpolation.QuadraticBezier(trailP, origin.x, (origin.x + destination.x) / 2, destination.x); const ty = Phaser.Math.Interpolation.QuadraticBezier(trailP, origin.y, Math.min(origin.y, destination.y) - 80, destination.y); this.art.fillStyle(i % 2 ? 0xff704d : 0xffd166, 0.1 + (9 - i) * 0.06); this.art.fillCircle(tx, ty, 4 + (9 - i) * 0.8); } this.drawMagicOrb({ x, y }, 16, t, 1); }
    else if (this.phase === "impact") { const p = Phaser.Math.Clamp(elapsed / 720, 0, 1); const radius = 20 + p * 95; this.art.lineStyle(5 * (1 - p), 0xffd166, 0.9 * (1 - p)); this.art.strokeCircle(destination.x, destination.y, radius); this.art.lineStyle(2, 0xff704d, 0.65 * (1 - p)); this.art.strokeCircle(destination.x, destination.y, radius * 0.6); for (let i = 0; i < 12; i += 1) { const a = (Math.PI * 2 * i) / 12 + 0.2; const d = 25 + p * 75 + (i % 3) * 10; this.art.fillStyle(i % 3 === 0 ? 0xfff2bd : 0xff704d, (1 - p) * 0.85); this.art.fillCircle(destination.x + Math.cos(a) * d, destination.y + Math.sin(a) * d, 2 + (1 - p) * 2); } }
  }

  private drawMagicOrb(p: Point, radius: number, t: number, alpha: number) {
    const g = this.art; g.fillStyle(0xff704d, 0.1 * alpha); g.fillCircle(p.x, p.y, radius * 2.8); g.fillStyle(0xffa94d, 0.28 * alpha); g.fillCircle(p.x, p.y, radius * 1.6); g.fillStyle(0xff704d, 0.95 * alpha); g.fillCircle(p.x, p.y, radius); g.fillStyle(0xfff2bd, alpha); g.fillCircle(p.x - 3, p.y - 3, radius * 0.45); g.lineStyle(2, 0xffd166, 0.8 * alpha); g.strokeCircle(p.x, p.y, radius + Math.sin(t * 8) * 2);
  }
}

export function createArenaGame(parent: HTMLElement, callbacks: ArenaCallbacks) {
  return new Phaser.Game({ type: Phaser.AUTO, parent, backgroundColor: "#090d24", scene: new ArenaScene(callbacks), scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight }, render: { antialias: true, pixelArt: false } });
}
