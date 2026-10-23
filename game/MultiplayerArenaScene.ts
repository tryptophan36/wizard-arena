import Phaser from "phaser";

import {
  type DuelClient,
  type DuelPlayerSnapshot,
  type DuelRealtimeEvent,
  type DuelStateSnapshot,
} from "@/lib/multiplayer";
import type { RunePoint } from "@/game/runeGesture";

/**
 * The server recognizes runes in a 1,000px arena. The scene keeps that
 * coordinate space even when the browser canvas is resized, then maps it to
 * the visible canvas for pointer input and rendering.
 */
export const MULTIPLAYER_ARENA_WIDTH = 1_000;
export const MULTIPLAYER_ARENA_HEIGHT = 700;

export type MultiplayerArenaFeedback = {
  status: "idle" | "drawing" | "accepted" | "rejected" | "impact" | "system";
  message: string;
  hint: string;
};

export type MultiplayerArenaSceneOptions = {
  onFeedback?: (feedback: MultiplayerArenaFeedback) => void;
};

type Point = RunePoint;

type LocalStroke = {
  strokeId: string;
  points: Point[];
  startedAt: number;
  sentPointCount: number;
  lastSentAt: number;
};

type RemoteStroke = {
  sessionId: string;
  strokeId: string;
  points: Point[];
};

type SpellVisual = {
  spellId: string;
  phase: "charging" | "flying" | "impact";
  phaseStartedAt: number;
  phaseEndsAt: number;
};

type ImpactVisual = {
  targetSessionId: string;
  spellId: string;
  startedAt: number;
  blocked: boolean;
};

const DRAW_PREVIEW_INTERVAL_MS = 33;
const MAX_DRAW_POINTS_PER_PACKET = 64;

export class MultiplayerArenaScene extends Phaser.Scene {
  private readonly client: DuelClient;
  private readonly options: MultiplayerArenaSceneOptions;
  private latestState: DuelStateSnapshot | null;
  private unsubscribeState: (() => void) | null = null;
  private unsubscribeRealtime: (() => void) | null = null;
  private art!: Phaser.GameObjects.Graphics;
  private localStroke: LocalStroke | null = null;
  private readonly localStrokes = new Map<string, Point[]>();
  private readonly remoteStrokes = new Map<string, RemoteStroke>();
  private readonly spellVisuals = new Map<string, SpellVisual>();
  private impactVisual: ImpactVisual | null = null;
  private matchKey: Phaser.Input.Keyboard.Key | null = null;
  private strokeSequence = 0;
  private feedback: MultiplayerArenaFeedback = {
    status: "idle",
    message: "DRAW RUNE",
    hint: "TRACE A REGISTERED SYMBOL · PRESS A TO MATCH",
  };

  public constructor(client: DuelClient, options: MultiplayerArenaSceneOptions = {}) {
    super({ key: "MultiplayerWizardArena" });
    this.client = client;
    this.options = options;
    this.latestState = client.state;
  }

  public preload(): void {
    // Multiplayer visuals are intentionally drawn with Graphics so this scene
    // stays independent from React and does not need a second asset pipeline.
  }

  public create(): void {
    this.art = this.add.graphics();
    this.input.on("pointerdown", this.handlePointerDown, this);
    this.input.on("pointermove", this.handlePointerMove, this);
    this.input.on("pointerup", this.handlePointerUp, this);
    this.input.on("pointerupoutside", this.handlePointerUp, this);

    if (this.input.keyboard) {
      this.matchKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A, false, false);
      this.matchKey.on("down", this.handleMatchKey, this);
    }

    this.unsubscribeState = this.client.subscribeState((state) => {
      this.latestState = state;
      if (state.phase === "finished") this.clearLocalDrawing();
    });
    this.unsubscribeRealtime = this.client.subscribeRealtimeEvent((event) => this.handleRealtimeEvent(event));
    this.scale.on("resize", this.handleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.cleanup, this);
    this.emitFeedback(this.feedback);
    this.drawArena(0);
  }

  public update(time: number): void {
    this.drawArena(time);
  }

  private cleanup(): void {
    this.unsubscribeState?.();
    this.unsubscribeRealtime?.();
    this.unsubscribeState = null;
    this.unsubscribeRealtime = null;
    this.scale.off("resize", this.handleResize, this);
    this.matchKey?.off("down", this.handleMatchKey, this);
    if (this.matchKey) this.input.keyboard?.removeKey(this.matchKey, true);
    this.matchKey = null;
  }

  private handlePointerDown(pointer: Phaser.Input.Pointer): void {
    if (!this.canDraw() || this.localStroke || (pointer.button !== 0 && !pointer.wasTouch)) return;

    const point = this.toCanonicalPoint(pointer);
    const now = Date.now();
    const strokeId = `${this.client.sessionId ?? "wizard"}-${++this.strokeSequence}`;
    this.localStroke = {
      strokeId,
      points: [point],
      startedAt: now,
      sentPointCount: 1,
      lastSentAt: now,
    };
    this.localStrokes.set(strokeId, [point]);
    this.emitFeedback({ status: "drawing", message: "TRACING RUNE…", hint: "RELEASE TO INSCRIBE · PRESS A TO MATCH" });

    try {
      this.client.sendDrawingStart({ strokeId, point });
    } catch (cause: unknown) {
      this.localStroke = null;
      this.localStrokes.delete(strokeId);
      this.emitFeedback({ status: "rejected", message: readErrorMessage(cause, "DRAWING CHANNEL UNAVAILABLE"), hint: "CHECK THE CONNECTION AND TRY AGAIN" });
    }
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer): void {
    const stroke = this.localStroke;
    if (!stroke || (!pointer.leftButtonDown() && !pointer.wasTouch)) return;

    const point = this.toCanonicalPoint(pointer);
    const previous = stroke.points[stroke.points.length - 1];
    if (previous && distance(previous, point) < 4) return;
    stroke.points.push(point);
    this.localStrokes.set(stroke.strokeId, stroke.points);
    this.flushStrokePoints(stroke);
  }

  private handlePointerUp(pointer: Phaser.Input.Pointer): void {
    const stroke = this.localStroke;
    if (!stroke) return;

    const point = this.toCanonicalPoint(pointer);
    const previous = stroke.points[stroke.points.length - 1];
    const hasFinalPoint = !previous || distance(previous, point) >= 2;
    if (hasFinalPoint) stroke.points.push(point);
    this.localStrokes.set(stroke.strokeId, stroke.points);
    this.localStroke = null;

    try {
      // Flush the final bounded preview packet before ending the stroke. The
      // ordered WebSocket stream means the server has all points before it
      // receives draw:end, without sending every pointer event individually.
      this.flushStrokePoints(stroke, true);
      this.client.sendDrawingEnd({
        strokeId: stroke.strokeId,
        startedAt: stroke.startedAt,
        endedAt: Date.now(),
      });
      this.emitFeedback({ status: "drawing", message: "RUNE READY · PRESS A TO MATCH", hint: "THE SERVER WILL VERIFY YOUR INSCRIPTION" });
    } catch (cause: unknown) {
      this.localStrokes.delete(stroke.strokeId);
      this.emitFeedback({ status: "rejected", message: readErrorMessage(cause, "DRAWING CHANNEL UNAVAILABLE"), hint: "CHECK THE CONNECTION AND TRY AGAIN" });
    }
  }

  private handleMatchKey(): void {
    if (!this.latestState || this.latestState.phase !== "playing" || this.localStroke) return;
    try {
      this.client.requestSpellMatch();
      this.emitFeedback({ status: "system", message: "MATCHING RUNE…", hint: "THE CIRCUIT IS CHECKING YOUR GESTURE" });
    } catch (cause: unknown) {
      this.emitFeedback({ status: "rejected", message: readErrorMessage(cause, "MATCH CHANNEL UNAVAILABLE"), hint: "CHECK THE CONNECTION AND TRY AGAIN" });
    }
  }

  private handleRealtimeEvent(event: DuelRealtimeEvent): void {
    switch (event.type) {
      case "draw:remote-preview":
        {
          const key = remoteStrokeKey(event.payload.sessionId, event.payload.strokeId);
          const existing = this.remoteStrokes.get(key);
          if (existing) existing.points.push(...event.payload.points.map(copyPoint));
          else {
            this.remoteStrokes.set(key, {
              sessionId: event.payload.sessionId,
              strokeId: event.payload.strokeId,
              points: event.payload.points.map(copyPoint),
            });
          }
        }
        return;
      case "draw:remote-end":
        this.remoteStrokes.set(remoteStrokeKey(event.payload.sessionId, event.payload.strokeId), {
          sessionId: event.payload.sessionId,
          strokeId: event.payload.strokeId,
          points: event.payload.stroke.points.map(copyPoint),
        });
        return;
      case "draw:remote-clear":
        if (event.payload.strokeId) this.remoteStrokes.delete(remoteStrokeKey(event.payload.sessionId, event.payload.strokeId));
        else {
          for (const [strokeId, stroke] of this.remoteStrokes.entries()) {
            if (stroke.sessionId === event.payload.sessionId) this.remoteStrokes.delete(strokeId);
          }
        }
        return;
      case "spell:accepted":
        this.spellVisuals.set(event.payload.casterSessionId, {
          spellId: event.payload.spellId,
          phase: event.payload.phase,
          phaseStartedAt: event.payload.phaseStartedAt,
          phaseEndsAt: event.payload.phaseEndsAt,
        });
        if (event.payload.casterSessionId === this.client.sessionId) {
          this.clearLocalDrawing();
          this.emitFeedback({ status: "accepted", message: "RUNE ACCEPTED", hint: `${event.payload.spellId.toUpperCase()} RELEASED BY THE CIRCUIT` });
        }
        return;
      case "spell:rejected":
        if (event.payload.reason !== "incomplete-rune") this.clearLocalDrawing();
        this.emitFeedback({ status: "rejected", message: event.payload.message.toUpperCase(), hint: spellRejectHint(event.payload.reason) });
        return;
      case "spell:phase":
        if (event.payload.phase === "ready") this.spellVisuals.delete(event.payload.casterSessionId);
        else {
          this.spellVisuals.set(event.payload.casterSessionId, {
            spellId: event.payload.spellId,
            phase: event.payload.phase,
            phaseStartedAt: event.payload.phaseStartedAt,
            phaseEndsAt: event.payload.phaseEndsAt,
          });
        }
        return;
      case "spell:impact":
        this.impactVisual = {
          targetSessionId: event.payload.targetSessionId,
          spellId: event.payload.spellId,
          startedAt: Date.now(),
          blocked: event.payload.blocked,
        };
        this.emitFeedback({
          status: "impact",
          message: event.payload.blocked ? "WARD IMPACT · BLOCKED" : "DIRECT IMPACT",
          hint: event.payload.effect ? event.payload.effect.toUpperCase() : `${event.payload.damage} VITALITY LOST`,
        });
        return;
      case "match:ended":
        this.clearLocalDrawing();
        this.remoteStrokes.clear();
        this.spellVisuals.clear();
        this.emitFeedback({
          status: "system",
          message: event.payload.winnerSessionId === this.client.sessionId ? "DUEL WON" : "DUEL LOST",
          hint: event.payload.reason === "health" ? "THE CIRCUIT HAS DECLARED A VICTOR" : "YOUR OPPONENT LEFT THE ARENA",
        });
        return;
    }
  }

  private canDraw(): boolean {
    const state = this.latestState;
    const sessionId = this.client.sessionId;
    if (!state || state.phase !== "playing" || !sessionId) return false;
    const player = state.players.get(sessionId);
    return Boolean(player && !player.frozen && !player.stunned && (player.activeSpellPhase === "ready" || player.activeSpellPhase === "flying"));
  }

  private clearLocalDrawing(): void {
    this.localStroke = null;
    this.localStrokes.clear();
  }

  private flushStrokePoints(stroke: LocalStroke, force = false): void {
    const now = Date.now();
    if (!force && now - stroke.lastSentAt < DRAW_PREVIEW_INTERVAL_MS) return;

    const pending = stroke.points.slice(stroke.sentPointCount);
    if (pending.length === 0) return;

    try {
      for (let offset = 0; offset < pending.length; offset += MAX_DRAW_POINTS_PER_PACKET) {
        this.client.sendDrawingPoints({
          strokeId: stroke.strokeId,
          points: pending.slice(offset, offset + MAX_DRAW_POINTS_PER_PACKET),
        });
      }
      stroke.sentPointCount = stroke.points.length;
      stroke.lastSentAt = now;
    } catch {
      // The adapter reports the connection error; keep the local stroke visible
      // until pointerup so a reconnect does not create a visually abrupt erase.
    }
  }

  private emitFeedback(feedback: MultiplayerArenaFeedback): void {
    this.feedback = feedback;
    this.options.onFeedback?.(feedback);
  }

  private handleResize(): void {
    this.drawArena(Date.now());
  }

  private toCanonicalPoint(pointer: Phaser.Input.Pointer): Point {
    return {
      x: clamp((pointer.worldX / Math.max(1, this.scale.width)) * MULTIPLAYER_ARENA_WIDTH, 0, MULTIPLAYER_ARENA_WIDTH),
      y: clamp((pointer.worldY / Math.max(1, this.scale.height)) * MULTIPLAYER_ARENA_HEIGHT, 0, MULTIPLAYER_ARENA_HEIGHT),
      timestamp: Date.now(),
    };
  }

  private toScreenPoint(point: Point): Point {
    return {
      x: (point.x / MULTIPLAYER_ARENA_WIDTH) * this.scale.width,
      y: (point.y / MULTIPLAYER_ARENA_HEIGHT) * this.scale.height,
    };
  }

  private drawArena(time: number): void {
    if (!this.art) return;
    const width = this.scale.width;
    const height = this.scale.height;
    const t = time / 1_000;
    this.art.clear();
    this.drawBackdrop(width, height, t);
    this.drawFloor(width, height, t);

    for (const points of this.localStrokes.values()) this.drawStroke(points, 0x72e6d3, 0.95);
    for (const stroke of this.remoteStrokes.values()) this.drawStroke(stroke.points, 0xf4bf68, 0.82);

    const players = this.getPlayerPositions();
    this.drawWizard(players.local, 0x3e56ac, 0x72e6d3, t, this.latestState?.players.get(this.client.sessionId ?? "") ?? null);
    this.drawWizard(players.remote, 0x5b466f, 0xf4bf68, t + 1.2, players.remotePlayer);
    this.drawCasts(players.local, players.remote, time, t);
    this.drawImpact(players.local, players.remote, time);
  }

  private getPlayerPositions(): { local: Point; remote: Point; remotePlayer: DuelPlayerSnapshot | null } {
    const local: Point = { x: 205, y: 455 };
    const remote: Point = { x: 795, y: 430 };
    const sessionId = this.client.sessionId;
    const remotePlayer = this.latestState
      ? Array.from(this.latestState.players.values()).find((player) => player.sessionId !== sessionId) ?? null
      : null;
    return { local, remote, remotePlayer };
  }

  private drawStroke(points: ReadonlyArray<Point>, color: number, alpha: number): void {
    if (points.length < 2) return;
    const visible = points.map((point) => this.toScreenPoint(point));
    const drawPath = (): void => {
      this.art.beginPath();
      this.art.moveTo(visible[0].x, visible[0].y);
      visible.slice(1).forEach((point) => this.art.lineTo(point.x, point.y));
      this.art.strokePath();
    };
    this.art.lineStyle(18, color, 0.08 * alpha);
    drawPath();
    this.art.lineStyle(7, color, 0.25 * alpha);
    drawPath();
    this.art.lineStyle(2.5, 0xf6fff3, 0.88 * alpha);
    drawPath();
    const tip = visible[visible.length - 1];
    this.art.fillStyle(color, 0.25 * alpha);
    this.art.fillCircle(tip.x, tip.y, 12);
    this.art.fillStyle(0xf6fff3, 0.9 * alpha);
    this.art.fillCircle(tip.x, tip.y, 3);
  }

  private drawBackdrop(width: number, height: number, t: number): void {
    const g = this.art;
    g.fillGradientStyle(0x0b1232, 0x131b45, 0x060918, 0x0b102b, 1);
    g.fillRect(0, 0, width, height);
    g.fillStyle(0x6676bf, 0.13);
    g.fillCircle(width * 0.79, height * 0.19, Math.min(width, height) * 0.095);
    g.fillStyle(0xb5c7ff, 0.18);
    g.fillCircle(width * 0.79, height * 0.19, Math.min(width, height) * 0.068);
    const stars = [[0.08, 0.2], [0.17, 0.12], [0.3, 0.2], [0.42, 0.11], [0.54, 0.24], [0.68, 0.1], [0.89, 0.28], [0.95, 0.12], [0.61, 0.34], [0.22, 0.34]];
    stars.forEach(([x, y], index) => {
      g.fillStyle(0xd9e4ff, 0.45 + Math.sin(t * 1.8 + index) * 0.2);
      g.fillCircle(width * x, height * y, index % 3 === 0 ? 2 : 1);
    });
    g.fillStyle(0x111a3d, 1);
    g.beginPath();
    g.moveTo(0, height * 0.49);
    g.lineTo(width * 0.13, height * 0.3);
    g.lineTo(width * 0.25, height * 0.48);
    g.lineTo(width * 0.4, height * 0.27);
    g.lineTo(width * 0.56, height * 0.48);
    g.lineTo(width * 0.7, height * 0.34);
    g.lineTo(width * 0.84, height * 0.49);
    g.lineTo(width, height * 0.37);
    g.lineTo(width, height * 0.67);
    g.lineTo(0, height * 0.67);
    g.closePath();
    g.fillPath();
  }

  private drawFloor(width: number, height: number, t: number): void {
    const g = this.art;
    const horizon = height * 0.55;
    g.fillGradientStyle(0x1a2850, 0x0d1634, 0x2e2548, 0x11152f, 1);
    g.fillRect(0, horizon, width, height - horizon);
    g.fillStyle(0x080d22, 0.48);
    g.fillEllipse(width * 0.5, height * 0.87, width * 0.88, height * 0.29);
    g.lineStyle(1, 0x6474a8, 0.18);
    for (let index = 0; index < 9; index += 1) {
      const y = horizon + Math.pow(index / 9, 1.7) * height * 0.43;
      g.lineBetween(0, y, width, y);
    }
    for (let index = -10; index <= 10; index += 1) g.lineBetween(width * 0.5, horizon, width * 0.5 + index * width * 0.12, height);
    const runeX = width * 0.5;
    const runeY = height * 0.74;
    const runeRadius = Math.min(width, height) * 0.19;
    g.lineStyle(2, 0x7182d3, 0.38);
    g.strokeCircle(runeX, runeY, runeRadius);
    g.strokeCircle(runeX, runeY, runeRadius * 0.75);
    g.lineBetween(runeX - runeRadius, runeY, runeX + runeRadius, runeY);
    g.lineBetween(runeX, runeY - runeRadius, runeX, runeY + runeRadius);
    for (let index = 0; index < 6; index += 1) {
      const angle = t * 0.08 + (Math.PI * 2 * index) / 6;
      g.lineBetween(
        runeX + Math.cos(angle) * runeRadius * 0.78,
        runeY + Math.sin(angle) * runeRadius * 0.78,
        runeX + Math.cos(angle) * runeRadius * 0.94,
        runeY + Math.sin(angle) * runeRadius * 0.94,
      );
    }
  }

  private drawWizard(point: Point, robe: number, glow: number, t: number, player: DuelPlayerSnapshot | null): void {
    const g = this.art;
    const screen = this.toScreenPoint(point);
    const scale = Math.max(0.65, Math.min(this.scale.width / MULTIPLAYER_ARENA_WIDTH, this.scale.height / MULTIPLAYER_ARENA_HEIGHT));
    const bob = Math.sin(t * 2.2) * 2 * scale;
    const x = screen.x;
    const y = screen.y + bob;
    g.fillStyle(0x050819, 0.55);
    g.fillEllipse(x, y + 37 * scale, 120 * scale, 24 * scale);
    if (player?.activeSpellPhase === "charging") {
      g.lineStyle(2 * scale, glow, 0.45);
      g.strokeCircle(x, y - 35 * scale, (42 + Math.sin(t * 12) * 5) * scale);
    }
    if (player?.shield) {
      g.lineStyle(3 * scale, 0x8feaff, 0.72);
      g.strokeCircle(x, y - 35 * scale, 80 * scale);
    }
    g.fillStyle(robe, 1);
    g.beginPath();
    g.moveTo(x - 37 * scale, y + 26 * scale);
    g.lineTo(x - 25 * scale, y - 19 * scale);
    g.lineTo(x + 24 * scale, y - 19 * scale);
    g.lineTo(x + 46 * scale, y + 28 * scale);
    g.lineTo(x + 17 * scale, y + 36 * scale);
    g.lineTo(x - 42 * scale, y + 31 * scale);
    g.closePath();
    g.fillPath();
    g.fillStyle(0xe0a56d, 1);
    g.fillCircle(x + 3 * scale, y - 39 * scale, 18 * scale);
    g.fillStyle(0x101835, 1);
    g.beginPath();
    g.moveTo(x - 30 * scale, y - 46 * scale);
    g.lineTo(x + 2 * scale, y - 95 * scale);
    g.lineTo(x + 42 * scale, y - 49 * scale);
    g.lineTo(x + 21 * scale, y - 40 * scale);
    g.lineTo(x - 28 * scale, y - 40 * scale);
    g.closePath();
    g.fillPath();
    g.fillStyle(glow, 0.9);
    g.fillCircle(x + 32 * scale, y - 35 * scale, 7 * scale);
    g.fillStyle(0xfff2bd, 1);
    g.fillCircle(x + 32 * scale, y - 35 * scale, 3 * scale);
  }

  private drawCasts(local: Point, remote: Point, time: number, t: number): void {
    const sessionId = this.client.sessionId;
    if (!sessionId || !this.latestState) return;
    const players = Array.from(this.latestState.players.values());
    for (const player of players) {
      const visual = this.spellVisuals.get(player.sessionId) ?? this.readStateSpell(player);
      if (!visual) continue;
      const isLocal = player.sessionId === sessionId;
      this.drawSpellVisual(isLocal ? local : remote, isLocal ? remote : local, visual, time, t, isLocal);
    }
  }

  private readStateSpell(player: DuelPlayerSnapshot): SpellVisual | null {
    if (!player.activeSpellId || player.activeSpellPhase === "ready") return null;
    return {
      spellId: player.activeSpellId,
      phase: player.activeSpellPhase,
      phaseStartedAt: player.activeSpellStartedAt,
      phaseEndsAt: player.activeSpellEndsAt,
    };
  }

  private drawSpellVisual(caster: Point, target: Point, visual: SpellVisual, time: number, t: number, local: boolean): void {
    const origin = this.toScreenPoint({ x: caster.x + (local ? 35 : -35), y: caster.y - 45 });
    const destination = this.toScreenPoint({ x: target.x + (local ? -55 : 55), y: target.y - 5 });
    const duration = Math.max(1, visual.phaseEndsAt - visual.phaseStartedAt);
    const progress = clamp((Date.now() - visual.phaseStartedAt) / duration, 0, 1);
    const color = spellColor(visual.spellId);
    if (visual.phase === "charging") {
      this.art.fillStyle(color, 0.35);
      this.art.fillCircle(origin.x, origin.y, 10 + progress * 16);
      this.art.lineStyle(2, color, 0.7);
      this.art.strokeCircle(origin.x, origin.y, 26 + progress * 18);
      return;
    }
    if (visual.phase === "flying") {
      const x = Phaser.Math.Interpolation.QuadraticBezier(progress, origin.x, (origin.x + destination.x) / 2, destination.x);
      const y = Phaser.Math.Interpolation.QuadraticBezier(progress, origin.y, Math.min(origin.y, destination.y) - 80, destination.y);
      for (let index = 6; index >= 1; index -= 1) {
        const trailProgress = Math.max(0, progress - index * 0.035);
        const trailX = Phaser.Math.Interpolation.QuadraticBezier(trailProgress, origin.x, (origin.x + destination.x) / 2, destination.x);
        const trailY = Phaser.Math.Interpolation.QuadraticBezier(trailProgress, origin.y, Math.min(origin.y, destination.y) - 80, destination.y);
        this.art.fillStyle(color, 0.08 + (7 - index) * 0.06);
        this.art.fillCircle(trailX, trailY, 3 + (7 - index));
      }
      this.art.fillStyle(color, 0.95);
      this.art.fillCircle(x, y, 13 + Math.sin(t * 11) * 2);
      this.art.lineStyle(2, 0xf6fff3, 0.8);
      this.art.strokeCircle(x, y, 19 + Math.sin(t * 9) * 2);
      return;
    }
    this.drawImpactAt(destination, progress, color);
  }

  private drawImpact(local: Point, remote: Point, time: number): void {
    const impact = this.impactVisual;
    if (!impact) return;
    const elapsed = time - impact.startedAt;
    if (elapsed > 650) {
      this.impactVisual = null;
      return;
    }
    const target = impact.targetSessionId === this.client.sessionId ? local : remote;
    const destination = this.toScreenPoint(target);
    this.drawImpactAt(destination, clamp(elapsed / 650, 0, 1), impact.blocked ? 0x8feaff : spellColor(impact.spellId));
  }

  private drawImpactAt(point: Point, progress: number, color: number): void {
    this.art.lineStyle(5 * (1 - progress), color, 0.9 * (1 - progress));
    this.art.strokeCircle(point.x, point.y, 20 + progress * 95);
    this.art.lineStyle(2, 0xfff4cf, 0.65 * (1 - progress));
    this.art.strokeCircle(point.x, point.y, (20 + progress * 95) * 0.6);
    for (let index = 0; index < 12; index += 1) {
      const angle = (Math.PI * 2 * index) / 12;
      const distance = 24 + progress * 76;
      this.art.fillStyle(color, (1 - progress) * 0.8);
      this.art.fillCircle(point.x + Math.cos(angle) * distance, point.y + Math.sin(angle) * distance, 2 + (1 - progress) * 2);
    }
  }
}

export function createMultiplayerArenaGame(
  parent: HTMLElement,
  client: DuelClient,
  options: MultiplayerArenaSceneOptions = {},
): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: "#090d24",
    scene: new MultiplayerArenaScene(client, options),
    scale: { mode: Phaser.Scale.RESIZE, width: MULTIPLAYER_ARENA_WIDTH, height: MULTIPLAYER_ARENA_HEIGHT },
    // This scene has no sound assets. Avoid creating a Web Audio context that
    // Phaser may try to resume after React has already destroyed the game.
    audio: { noAudio: true },
    render: { antialias: true, pixelArt: false },
  });
}

function copyPoint(point: { x: number; y: number; timestamp?: number }): Point {
  return point.timestamp === undefined ? { x: point.x, y: point.y } : { x: point.x, y: point.y, timestamp: point.timestamp };
}

function distance(left: Point, right: Point): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function spellColor(spellId: string): number {
  switch (spellId) {
    case "lightning": return 0x8feaff;
    case "freeze": return 0xb7f7ff;
    case "ghost-portal": return 0xd7c2ff;
    case "aegis": return 0x8feaff;
    default: return 0xffa94d;
  }
}

function spellRejectHint(reason: string): string {
  switch (reason) {
    case "mana": return "WAIT FOR MANA TO REGENERATE";
    case "cooldown": return "WAIT FOR THE SPELL TO RESONATE AGAIN";
    case "frozen":
    case "stunned": return "YOUR RUNE INPUT IS SEALED TEMPORARILY";
    case "incomplete-rune": return "CONTINUE THE CURRENT MULTI-STROKE RUNE";
    default: return "DRAW A REGISTERED RUNE AND TRY AGAIN";
  }
}

function readErrorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message.toUpperCase() : fallback;
}

function remoteStrokeKey(sessionId: string, strokeId: string): string {
  return `${sessionId}:${strokeId}`;
}
