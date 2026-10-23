import Phaser from "phaser";

import {
  type DuelClient,
  type DuelPlayerSnapshot,
  type DuelRealtimeEvent,
  type DuelStateSnapshot,
} from "@/lib/multiplayer";
import { EMBER_LANCE_ASSET } from "@/game/emberLanceAsset";
import { LIGHTNING_BOLT_ASSET } from "@/game/lightningBoltAsset";
import { SHIELD_ASSET } from "@/game/shieldAsset";
import { FREEZE_ASSET } from "@/game/freezeAsset";
import { GHOST_PORTAL_ASSET } from "@/game/ghostPortalAsset";
import { DEFAULT_DRAWING_TOOL, normalizeDrawingStroke, type DrawingTool, type DrawingToolState } from "@/game/drawingTool";
import type { RunePoint } from "@/game/runeGesture";

/**
 * The server recognizes runes in a 1,000×700 arena. The scene maps the browser
 * canvas with a uniform scale (letterboxed) so circles and squares stay true
 * shapes for recognition — stretching X/Y independently would turn freehand
 * circles into ellipses and make matching flaky.
 */
export const MULTIPLAYER_ARENA_WIDTH = 1_000;
export const MULTIPLAYER_ARENA_HEIGHT = 700;

type ArenaLayout = {
  scale: number;
  offsetX: number;
  offsetY: number;
};

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
  private readonly drawingToolState: DrawingToolState;
  private latestState: DuelStateSnapshot | null;
  private unsubscribeState: (() => void) | null = null;
  private unsubscribeRealtime: (() => void) | null = null;
  private art!: Phaser.GameObjects.Graphics;
  private emberLance!: Phaser.GameObjects.Image;
  private enemyEmberLance!: Phaser.GameObjects.Image;
  private lightningBolt!: Phaser.GameObjects.Image;
  private enemyLightningBolt!: Phaser.GameObjects.Image;
  private freezeRings!: Phaser.GameObjects.Image;
  private enemyFreezeRings!: Phaser.GameObjects.Image;
  private ghostPortal!: Phaser.GameObjects.Image;
  private enemyGhostPortal!: Phaser.GameObjects.Image;
  private shield!: Phaser.GameObjects.Image;
  private enemyShield!: Phaser.GameObjects.Image;
  private localStroke: LocalStroke | null = null;
  private readonly localStrokes = new Map<string, Point[]>();
  private readonly remoteStrokes = new Map<string, RemoteStroke>();
  private readonly spellVisuals = new Map<string, SpellVisual>();
  private impactVisual: ImpactVisual | null = null;
  private matchKey: Phaser.Input.Keyboard.Key | null = null;
  private strokeSequence = 0;
  private drawingTool: DrawingTool = DEFAULT_DRAWING_TOOL;
  private feedback: MultiplayerArenaFeedback = {
    status: "idle",
    message: "DRAW RUNE",
    hint: "TRACE A REGISTERED SYMBOL · PRESS A TO MATCH",
  };

  public constructor(
    client: DuelClient,
    options: MultiplayerArenaSceneOptions = {},
    drawingToolState: DrawingToolState = { value: DEFAULT_DRAWING_TOOL },
  ) {
    super({ key: "MultiplayerWizardArena" });
    this.client = client;
    this.options = options;
    this.drawingToolState = drawingToolState;
    this.drawingTool = drawingToolState.value;
    this.latestState = client.state;
  }

  public preload(): void {
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

  public create(): void {
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
    this.enemyLightningBolt = this.add.image(0, 0, LIGHTNING_BOLT_ASSET.key)
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
    this.syncDrawingTool();
    this.drawArena(time);
  }

  private syncDrawingTool(): void {
    if (this.drawingToolState.value !== this.drawingTool) this.drawingTool = this.drawingToolState.value;
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

  /** Match computer mode's ~4px / ~2px pointer filters in screen space. */
  private minPointDistance(screenPixels: number): number {
    return screenPixels / Math.max(this.getArenaLayout().scale, 1e-6);
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer): void {
    const stroke = this.localStroke;
    if (!stroke || (!pointer.leftButtonDown() && !pointer.wasTouch)) return;

    const point = this.toCanonicalPoint(pointer);
    const previous = stroke.points[stroke.points.length - 1];
    if (previous && distance(previous, point) < this.minPointDistance(4)) return;
    stroke.points.push(point);
    this.localStrokes.set(stroke.strokeId, stroke.points);
    this.flushStrokePoints(stroke);
  }

  private handlePointerUp(pointer: Phaser.Input.Pointer): void {
    const stroke = this.localStroke;
    if (!stroke) return;

    const point = this.toCanonicalPoint(pointer);
    const previous = stroke.points[stroke.points.length - 1];
    const hasFinalPoint = !previous || distance(previous, point) >= this.minPointDistance(2);
    if (hasFinalPoint) stroke.points.push(point);
    const normalizedPoints = normalizeDrawingStroke(stroke.points, this.drawingTool);
    this.localStrokes.set(stroke.strokeId, normalizedPoints);
    this.localStroke = null;

    try {
      // Flush the final bounded preview packet before ending the stroke. The
      // ordered WebSocket stream means the server has all points before it
      // receives draw:end, without sending every pointer event individually.
      this.flushStrokePoints(stroke, true);
      this.client.sendDrawingEnd({
        strokeId: stroke.strokeId,
        normalizedPoints: this.drawingTool === "freehand" ? undefined : normalizedPoints,
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

  /** Fit the logical arena inside the canvas without distorting aspect ratio. */
  private getArenaLayout(): ArenaLayout {
    const width = Math.max(1, this.scale.width);
    const height = Math.max(1, this.scale.height);
    const scale = Math.min(width / MULTIPLAYER_ARENA_WIDTH, height / MULTIPLAYER_ARENA_HEIGHT);
    return {
      scale,
      offsetX: (width - MULTIPLAYER_ARENA_WIDTH * scale) / 2,
      offsetY: (height - MULTIPLAYER_ARENA_HEIGHT * scale) / 2,
    };
  }

  private toCanonicalPoint(pointer: Phaser.Input.Pointer): Point {
    const { scale, offsetX, offsetY } = this.getArenaLayout();
    const safeScale = Math.max(scale, 1e-6);
    return {
      x: clamp((pointer.worldX - offsetX) / safeScale, 0, MULTIPLAYER_ARENA_WIDTH),
      y: clamp((pointer.worldY - offsetY) / safeScale, 0, MULTIPLAYER_ARENA_HEIGHT),
      timestamp: Date.now(),
    };
  }

  private toScreenPoint(point: Point, mirrorX = false): Point {
    const { scale, offsetX, offsetY } = this.getArenaLayout();
    const x = mirrorX ? MULTIPLAYER_ARENA_WIDTH - point.x : point.x;
    return {
      x: x * scale + offsetX,
      y: point.y * scale + offsetY,
    };
  }

  /**
   * Shape tools keep raw pointer samples for networking, but the local (and
   * finished) glyph should match computer mode: preview the normalized square /
   * circle / line while the pointer is still down.
   */
  private pointsForLocalDraw(strokeId: string, points: ReadonlyArray<Point>): ReadonlyArray<Point> {
    const isActive = this.localStroke?.strokeId === strokeId;
    if (!isActive || this.drawingTool === "freehand" || points.length < 2) return points;
    return normalizeDrawingStroke([...points], this.drawingTool);
  }

  private drawArena(time: number): void {
    if (!this.art) return;
    const width = this.scale.width;
    const height = this.scale.height;
    const t = time / 1_000;
    this.art.clear();
    this.hideSpellImages();
    this.drawBackdrop(width, height, t);
    this.drawFloor(width, height, t);

    for (const [strokeId, points] of this.localStrokes.entries()) {
      this.drawStroke(this.pointsForLocalDraw(strokeId, points), 0x72e6d3, 0.95);
    }
    for (const stroke of this.remoteStrokes.values()) this.drawStroke(stroke.points, 0xf4bf68, 0.82, true);

    const players = this.getPlayerPositions();
    const localPlayer = this.latestState?.players.get(this.client.sessionId ?? "") ?? null;
    this.drawWizard(players.local, 0x3e56ac, 0x72e6d3, t, localPlayer);
    this.drawWizard(players.remote, 0x5b466f, 0xf4bf68, t + 1.2, players.remotePlayer);
    this.drawCasts(players.local, players.remote, t);
    this.drawShieldVisual(players.local, localPlayer, true, t);
    this.drawShieldVisual(players.remote, players.remotePlayer, false, t);
    this.drawImpact(players.local, players.remote);
  }

  private hideSpellImages(): void {
    this.emberLance?.setVisible(false);
    this.enemyEmberLance?.setVisible(false);
    this.lightningBolt?.setVisible(false);
    this.enemyLightningBolt?.setVisible(false);
    this.freezeRings?.setVisible(false);
    this.enemyFreezeRings?.setVisible(false);
    this.ghostPortal?.setVisible(false);
    this.enemyGhostPortal?.setVisible(false);
    this.shield?.setVisible(false);
    this.enemyShield?.setVisible(false);
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

  private drawStroke(points: ReadonlyArray<Point>, color: number, alpha: number, mirrorX = false): void {
    if (points.length < 2) return;
    const visible = points.map((point) => this.toScreenPoint(point, mirrorX));
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
    const scale = Math.max(0.65, this.getArenaLayout().scale);
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

  private drawCasts(local: Point, remote: Point, t: number): void {
    const sessionId = this.client.sessionId;
    if (!sessionId || !this.latestState) return;
    const players = Array.from(this.latestState.players.values());
    for (const player of players) {
      const visual = this.spellVisuals.get(player.sessionId) ?? this.readStateSpell(player);
      if (!visual) continue;
      const isLocal = player.sessionId === sessionId;
      this.drawSpellVisual(isLocal ? local : remote, isLocal ? remote : local, visual, t, isLocal);
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

  private drawSpellVisual(caster: Point, target: Point, visual: SpellVisual, t: number, local: boolean): void {
    const origin = this.toScreenPoint({ x: caster.x + (local ? 35 : -35), y: caster.y - 45 });
    const destination = this.toScreenPoint({ x: target.x + (local ? -55 : 55), y: target.y - 5 });
    switch (visual.spellId) {
      case "aegis":
        return;
      case "lightning":
        this.drawLightningSpell(origin, destination, visual, t, local);
        return;
      case "freeze":
        this.drawFreezeSpell(origin, destination, visual, t, local);
        return;
      case "ghost-portal":
        this.drawPortalSpell(origin, destination, visual, t, local);
        return;
      default:
        this.drawEmberSpell(origin, destination, visual, t, local);
    }
  }

  private drawEmberSpell(origin: Point, destination: Point, visual: SpellVisual, t: number, local: boolean): void {
    const asset = local ? this.emberLance : this.enemyEmberLance;
    const progress = spellProgress(visual);
    const angle = Phaser.Math.Angle.Between(origin.x, origin.y, destination.x, destination.y);
    asset.setVisible(false);

    if (visual.phase === "charging") {
      this.drawMagicOrb(origin, 8 + progress * 13, t, 1 - progress * 0.2);
      asset.setPosition(origin.x, origin.y).setRotation(angle).setScale(0.12 + progress * 0.2).setAlpha(0.18 + progress * 0.62).setVisible(true);
      for (let index = 0; index < 9; index += 1) {
        const orbit = t * 2.4 + index * 0.72;
        const radius = 18 + (index % 3) * 8 + Math.sin(t * 4 + index) * 3;
        this.art.fillStyle(index % 2 ? 0xffa94d : 0x7ef5dc, 0.85);
        this.art.fillCircle(origin.x + Math.cos(orbit) * radius, origin.y + Math.sin(orbit) * radius, 2 + (index % 3));
      }
      return;
    }

    if (visual.phase === "flying") {
      const point = projectilePoint(origin, destination, progress);
      for (let index = 10; index >= 1; index -= 1) {
        const trailProgress = Math.max(0, progress - index * 0.018);
        const trail = projectilePoint(origin, destination, trailProgress);
        this.art.fillStyle(index % 2 ? 0xff704d : 0xffd166, 0.08 + (11 - index) * 0.055);
        this.art.fillCircle(trail.x, trail.y, 4 + (11 - index) * 0.85);
        this.drawFlameRibbon(trail.x, trail.y, angle, 30 + (11 - index) * 2, t + index * 0.08, 0.32 + (11 - index) * 0.035);
      }
      this.drawMagicOrb(point, 14 + Math.sin(t * 11) * 2, t, 1);
      asset.setPosition(point.x, point.y).setRotation(angle).setScale(0.28 + Math.sin(t * 13) * 0.018).setAlpha(0.96).setVisible(true);
      return;
    }

    this.drawImpactAt(destination, progress, 0xffa94d);
  }

  private drawLightningSpell(origin: Point, destination: Point, visual: SpellVisual, t: number, local: boolean): void {
    const asset = local ? this.lightningBolt : this.enemyLightningBolt;
    const progress = spellProgress(visual);
    const angle = Phaser.Math.Angle.Between(origin.x, origin.y, destination.x, destination.y);
    asset.setVisible(false);

    if (visual.phase === "charging") {
      this.drawElectricOrb(origin, 8 + progress * 13, t, 1 - progress * 0.2);
      asset.setPosition(origin.x, origin.y).setRotation(angle).setScale(0.1 + progress * 0.22).setAlpha(0.18 + progress * 0.62).setVisible(true);
      for (let index = 0; index < 7; index += 1) {
        const orbit = t * 3.2 + index * 0.9;
        const radius = 18 + (index % 3) * 8 + Math.sin(t * 5 + index) * 3;
        this.drawElectricArc(origin, {
          x: origin.x + Math.cos(orbit) * radius,
          y: origin.y + Math.sin(orbit) * radius,
        }, t + index, 0.42);
      }
      return;
    }

    if (visual.phase === "flying") {
      const point = projectilePoint(origin, destination, progress);
      for (let index = 11; index >= 1; index -= 1) {
        const trailProgress = Math.max(0, progress - index * 0.018);
        const trail = projectilePoint(origin, destination, trailProgress);
        const previous = projectilePoint(origin, destination, Math.max(0, trailProgress - 0.05));
        this.art.fillStyle(index % 2 ? 0x6685ff : 0xb8f5ff, 0.06 + (12 - index) * 0.045);
        this.art.fillCircle(trail.x, trail.y, 3 + (12 - index) * 0.9);
        this.drawElectricArc(previous, trail, t + index * 0.13, 0.22 + (12 - index) * 0.035);
      }
      this.drawElectricOrb(point, 14 + Math.sin(t * 17) * 2, t, 1);
      asset.setPosition(point.x, point.y).setRotation(angle).setScale(0.28 + Math.sin(t * 18) * 0.018).setAlpha(0.96).setVisible(true);
      return;
    }

    this.drawImpactAt(destination, progress, 0xb7f7ff);
    for (let index = 0; index < 10; index += 1) {
      const orbit = (Math.PI * 2 * index) / 10 + t * 0.6;
      const distance = 28 + progress * 82;
      this.drawElectricArc(destination, {
        x: destination.x + Math.cos(orbit) * distance,
        y: destination.y + Math.sin(orbit) * distance,
      }, t + index * 0.6, (1 - progress) * 0.82);
    }
  }

  private drawFreezeSpell(origin: Point, destination: Point, visual: SpellVisual, t: number, local: boolean): void {
    const asset = local ? this.freezeRings : this.enemyFreezeRings;
    const progress = spellProgress(visual);
    const direction = local ? 0 : Math.PI;
    asset.setVisible(false);

    if (visual.phase === "charging") {
      this.drawFrostOrb(origin, 8 + progress * 13, t, 1 - progress * 0.2);
      asset.setPosition(origin.x, origin.y).setRotation(direction).setScale(0.12 + progress * 0.08).setAlpha(0.18 + progress * 0.5).setVisible(true);
      this.art.lineStyle(2, 0xb7f7ff, 0.65);
      this.art.strokeCircle(origin.x, origin.y, 28 + progress * 22);
      return;
    }

    if (visual.phase === "flying") {
      const point = projectilePoint(origin, destination, progress);
      for (let index = 8; index >= 1; index -= 1) {
        const trail = projectilePoint(origin, destination, Math.max(0, progress - index * 0.025));
        this.art.fillStyle(index % 2 ? 0x8deaff : 0xe3fbff, 0.1 + (9 - index) * 0.06);
        this.art.fillCircle(trail.x, trail.y, 4 + (9 - index) * 0.8);
      }
      this.drawFrostOrb(point, 14 + Math.sin(t * 11) * 2, t, 1);
      asset.setPosition(point.x, point.y).setRotation(direction + t * 0.35).setScale(0.18).setAlpha(0.88).setVisible(true);
      this.art.lineStyle(2, 0xb7f7ff, 0.65);
      this.art.lineBetween(point.x - Math.cos(direction) * 22, point.y - Math.sin(direction) * 22, point.x + Math.cos(direction) * 22, point.y + Math.sin(direction) * 22);
      return;
    }

    asset.setPosition(destination.x, destination.y).setRotation(t * 0.25).setScale(0.22 + progress * 0.2).setAlpha(0.82 * (1 - progress)).setVisible(true);
    this.drawImpactAt(destination, progress, 0xb7f7ff);
    for (let index = 0; index < 8; index += 1) {
      const orbit = (Math.PI * 2 * index) / 8 + t * 0.3;
      const distance = 28 + progress * 72;
      this.art.lineBetween(destination.x, destination.y, destination.x + Math.cos(orbit) * distance, destination.y + Math.sin(orbit) * distance);
    }
  }

  private drawPortalSpell(origin: Point, destination: Point, visual: SpellVisual, t: number, local: boolean): void {
    const asset = local ? this.ghostPortal : this.enemyGhostPortal;
    const progress = spellProgress(visual);
    const direction = local ? 0 : Math.PI;
    const travelPoint = (value: number): Point => projectilePoint(origin, destination, value, 90);

    if (visual.phase === "charging") {
      this.drawPortalGate(origin, 24 + progress * 23, t, 0.35 + progress * 0.5, direction, asset);
      this.drawSpectralOrb(origin, 8 + progress * 12, t, 0.7);
      return;
    }
    if (visual.phase === "flying") {
      this.drawPortalGate(origin, 45 + Math.sin(t * 7) * 3, t, 0.86, direction, asset);
      for (let index = 0; index < 3; index += 1) {
        const ghostProgress = clamp((progress - index * 0.12) / 0.88, 0, 1);
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

    const impactProgress = spellProgress(visual);
    this.drawPortalGate(origin, 48 + Math.sin(t * 7) * 3, t, 0.7 * (1 - impactProgress), direction, asset);
    for (let index = 0; index < 3; index += 1) {
      const orbit = -Math.PI / 2 + index * (Math.PI * 2 / 3) + direction;
      const distance = 18 + impactProgress * 24;
      const ghost = {
        x: destination.x + Math.cos(orbit) * distance,
        y: destination.y + Math.sin(orbit) * distance,
      };
      const alpha = (1 - impactProgress) * 0.92;
      this.drawGhost(ghost, 15 + index * 1.5, t + index * 0.55, alpha);
      this.art.lineStyle(2, 0xd8c8ff, (1 - impactProgress) * 0.42);
      this.art.lineBetween(ghost.x, ghost.y + 6, destination.x, destination.y);
    }
  }

  private drawShieldVisual(point: Point, player: DuelPlayerSnapshot | null, local: boolean, t: number): void {
    if (!player) return;
    const asset = local ? this.shield : this.enemyShield;
    const now = Date.now();
    const active = player.shield || now < player.shieldBlockedUntil;
    if (!active) return;

    const screen = this.toScreenPoint(point);
    const blocked = !player.shield;
    const remaining = player.shield
      ? clamp((player.shieldUntil - now) / 500, 0, 1)
      : clamp((player.shieldBlockedUntil - now) / 440, 0, 1);
    const scale = Math.max(0.65, this.getArenaLayout().scale);
    asset
      .setPosition(screen.x, screen.y - 36 * scale)
      .setScale((0.96 + remaining * 0.08) * scale * (1 + Math.sin(t * 8) * 0.025))
      .setAlpha(blocked ? remaining * 0.9 : 0.88)
      .setVisible(true);
    if (!blocked) return;

    this.art.lineStyle(4 * scale * remaining, 0xf3ffff, remaining * 0.9);
    this.art.strokeCircle(screen.x, screen.y - 36 * scale, (92 + (1 - remaining) * 20) * scale);
    for (let index = 0; index < 8; index += 1) {
      const orbit = (Math.PI * 2 * index) / 8 + t;
      this.art.lineBetween(
        screen.x,
        screen.y - 36 * scale,
        screen.x + Math.cos(orbit) * 112 * scale,
        screen.y - 36 * scale + Math.sin(orbit) * 112 * scale,
      );
    }
  }

  private drawPortalGate(center: Point, radius: number, t: number, alpha: number, rotation: number, asset: Phaser.GameObjects.Image): void {
    asset
      .setPosition(center.x, center.y)
      .setRotation(Math.sin(t * 0.8) * 0.025 + (rotation === Math.PI ? Math.PI : 0))
      .setScale(radius / 150)
      .setAlpha(Math.min(1, alpha * 0.92))
      .setVisible(true);
    this.art.fillStyle(0x8d70ff, alpha * 0.08);
    this.art.fillCircle(center.x, center.y, radius * 1.8);
    for (let index = 0; index < 3; index += 1) {
      const ringRadius = radius * (1 - index * 0.22);
      this.art.lineStyle(4 - index, index === 0 ? 0x8068ed : index === 1 ? 0xb99dff : 0xf0e8ff, alpha * (0.78 - index * 0.12));
      this.art.strokeCircle(center.x, center.y, ringRadius + Math.sin(t * (2.5 + index) + rotation) * 2);
    }
    for (let index = 0; index < 6; index += 1) {
      const angle = rotation + t * 0.7 + index * Math.PI / 3;
      const inner = radius * 0.7;
      const outer = radius * 1.05;
      this.art.lineStyle(2, 0xe6dcff, alpha * 0.6);
      this.art.lineBetween(center.x + Math.cos(angle) * inner, center.y + Math.sin(angle) * inner, center.x + Math.cos(angle) * outer, center.y + Math.sin(angle) * outer);
    }
  }

  private drawSpectralOrb(center: Point, radius: number, _t: number, alpha: number): void {
    this.art.fillStyle(0x8068ed, alpha * 0.12);
    this.art.fillCircle(center.x, center.y, radius * 2.9);
    this.art.fillStyle(0xb99dff, alpha * 0.32);
    this.art.fillCircle(center.x, center.y, radius * 1.6);
    this.art.fillStyle(0x8068ed, alpha * 0.95);
    this.art.fillCircle(center.x, center.y, radius);
    this.art.fillStyle(0xf0e8ff, alpha);
    this.art.fillCircle(center.x - 3, center.y - 3, radius * 0.42);
  }

  private drawGhost(center: Point, size: number, t: number, alpha: number): void {
    if (alpha <= 0) return;
    const x = center.x;
    const y = center.y + Math.sin(t * 7) * 2;
    this.art.fillStyle(0x8068ed, alpha * 0.16);
    this.art.fillCircle(x, y + size * 0.55, size * 1.7);
    this.art.fillStyle(0xd9ccff, alpha * 0.9);
    this.art.fillCircle(x, y - size * 0.48, size * 0.58);
    this.art.fillStyle(0xb49cff, alpha * 0.82);
    this.art.beginPath();
    this.art.moveTo(x - size * 0.62, y - size * 0.14);
    this.art.lineTo(x - size * 0.52, y + size * 0.78);
    this.art.lineTo(x - size * 0.2, y + size * 0.57);
    this.art.lineTo(x, y + size * 0.82);
    this.art.lineTo(x + size * 0.2, y + size * 0.57);
    this.art.lineTo(x + size * 0.52, y + size * 0.78);
    this.art.lineTo(x + size * 0.62, y - size * 0.14);
    this.art.closePath();
    this.art.fillPath();
    this.art.fillStyle(0x261c63, alpha);
    this.art.fillCircle(x - size * 0.2, y - size * 0.5, Math.max(1.5, size * 0.12));
    this.art.fillCircle(x + size * 0.2, y - size * 0.5, Math.max(1.5, size * 0.12));
  }

  private drawFlameRibbon(x: number, y: number, angle: number, length: number, time: number, alpha: number): void {
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    const vx = -uy;
    const vy = ux;
    const wave = Math.sin(time * 8) * 3;
    this.art.lineStyle(10, 0xff5b31, alpha * 0.14);
    this.art.lineBetween(x - ux * length, y - uy * length, x, y);
    this.art.lineStyle(4, 0xffa33c, alpha * 0.5);
    this.art.lineBetween(x - ux * length + vx * wave, y - uy * length + vy * wave, x - ux * 4, y - uy * 4);
    this.art.lineStyle(1.5, 0xfff2bd, alpha * 0.8);
    this.art.lineBetween(x - ux * (length * 0.72) - vx * wave, y - uy * (length * 0.72) - vy * wave, x - ux * 8, y - uy * 8);
  }

  private drawElectricArc(start: Point, end: Point, seed: number, alpha: number): void {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy) || 1;
    const normal = { x: -dy / length, y: dx / length };
    const points = [start];
    for (let index = 1; index < 5; index += 1) {
      const progress = index / 5;
      const jitter = Math.sin(seed * 6.7 + index * 3.9) * Math.min(13, length * 0.22);
      points.push({ x: start.x + dx * progress + normal.x * jitter, y: start.y + dy * progress + normal.y * jitter });
    }
    points.push(end);
    const drawPath = (): void => {
      this.art.beginPath();
      this.art.moveTo(points[0].x, points[0].y);
      points.slice(1).forEach((point) => this.art.lineTo(point.x, point.y));
      this.art.strokePath();
    };
    this.art.lineStyle(10, 0x586fff, alpha * 0.15);
    drawPath();
    this.art.lineStyle(3, 0x5acbff, alpha * 0.72);
    drawPath();
    this.art.lineStyle(1, 0xf2ffff, alpha * 0.98);
    drawPath();
  }

  private drawMagicOrb(center: Point, radius: number, t: number, alpha: number): void {
    this.art.fillStyle(0xff704d, 0.1 * alpha);
    this.art.fillCircle(center.x, center.y, radius * 2.8);
    this.art.fillStyle(0xffa94d, 0.28 * alpha);
    this.art.fillCircle(center.x, center.y, radius * 1.6);
    this.art.fillStyle(0xff704d, 0.95 * alpha);
    this.art.fillCircle(center.x, center.y, radius);
    this.art.fillStyle(0xfff2bd, alpha);
    this.art.fillCircle(center.x - 3, center.y - 3, radius * 0.45);
    this.art.lineStyle(2, 0xffd166, 0.8 * alpha);
    this.art.strokeCircle(center.x, center.y, radius + Math.sin(t * 8) * 2);
  }

  private drawElectricOrb(center: Point, radius: number, t: number, alpha: number): void {
    this.art.fillStyle(0x566dff, 0.1 * alpha);
    this.art.fillCircle(center.x, center.y, radius * 2.8);
    this.art.fillStyle(0x63d9ff, 0.26 * alpha);
    this.art.fillCircle(center.x, center.y, radius * 1.6);
    this.art.fillStyle(0x5296ff, 0.95 * alpha);
    this.art.fillCircle(center.x, center.y, radius);
    this.art.fillStyle(0xf3ffff, alpha);
    this.art.fillCircle(center.x - 3, center.y - 3, radius * 0.45);
    this.art.lineStyle(2, 0x9aeaff, 0.8 * alpha);
    this.art.strokeCircle(center.x, center.y, radius + Math.sin(t * 12) * 2);
  }

  private drawFrostOrb(center: Point, radius: number, t: number, alpha: number): void {
    this.art.fillStyle(0x75dfff, 0.1 * alpha);
    this.art.fillCircle(center.x, center.y, radius * 2.8);
    this.art.fillStyle(0xb7f7ff, 0.26 * alpha);
    this.art.fillCircle(center.x, center.y, radius * 1.6);
    this.art.fillStyle(0x75bfff, 0.95 * alpha);
    this.art.fillCircle(center.x, center.y, radius);
    this.art.fillStyle(0xf3ffff, alpha);
    this.art.fillCircle(center.x - 3, center.y - 3, radius * 0.45);
    this.art.lineStyle(2, 0xd9faff, 0.8 * alpha);
    this.art.strokeCircle(center.x, center.y, radius + Math.sin(t * 9) * 2);
  }

  private drawImpact(local: Point, remote: Point): void {
    const impact = this.impactVisual;
    if (!impact) return;
    const elapsed = Date.now() - impact.startedAt;
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
  drawingToolState: DrawingToolState = { value: DEFAULT_DRAWING_TOOL },
): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: "#090d24",
    scene: new MultiplayerArenaScene(client, options, drawingToolState),
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

function spellProgress(visual: SpellVisual): number {
  const duration = Math.max(1, visual.phaseEndsAt - visual.phaseStartedAt);
  return clamp((Date.now() - visual.phaseStartedAt) / duration, 0, 1);
}

function projectilePoint(origin: Point, destination: Point, progress: number, lift = 80): Point {
  return {
    x: Phaser.Math.Interpolation.QuadraticBezier(progress, origin.x, (origin.x + destination.x) / 2, destination.x),
    y: Phaser.Math.Interpolation.QuadraticBezier(progress, origin.y, Math.min(origin.y, destination.y) - lift, destination.y),
  };
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
