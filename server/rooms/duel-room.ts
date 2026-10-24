import { Room, type Client } from "colyseus";

import { recognizeAnySpell } from "../../game/spellRecognition";
import { SPELLS, type SpellData } from "../../game/spellData";
import { normalizeDrawingStroke } from "../../game/drawingTool";
import type { RuneStroke } from "../../game/recognition/shared";
import {
  MAX_DRAW_POINTS_PER_STROKE,
  MAX_DRAW_STROKES,
  MAX_REJECTION_MESSAGE_LENGTH,
  SUPPORTED_SPELL_IDS,
  isLeaveMessage,
  isPingMessage,
  isReadyMessage,
  normalizeDrawEndMessage,
  normalizeDrawPointsMessage,
  normalizeDrawStartMessage,
  normalizeSpellMatchMessage,
  type DrawEndMessage,
  type DrawPointsMessage,
  type DrawStartMessage,
  type DuelMessages,
  type LeaveMessage,
  type MatchEndedMessage,
  type PingMessage,
  type ReadyMessage,
  type SpellMatchMessage,
  type SupportedSpellId,
} from "../messages";
import {
  CompletedStrokeState,
  DrawingPointState,
  MatchPhase,
  MatchState,
  PlayerState,
  SpellPhase,
} from "../state";

export interface JoinOptions {
  displayName?: string;
  wizardId?: string;
}

export interface PlayerMetadata {
  displayName: string;
  wizardId: string;
}

type DuelRoomClient = Client<{
  userData: PlayerMetadata;
  messages: DuelMessages;
}>;

interface DuelRoomOptions {
  state: MatchState;
  client: DuelRoomClient;
  metadata: {
    roomId: string;
  };
}

type DrawPoint = { x: number; y: number; timestamp?: number };

type ActiveStroke = {
  strokeId: string;
  points: DrawPoint[];
  startedAt?: number;
};

type ActiveCast = {
  spell: SpellData;
  phase: "charging" | "flying" | "impact";
  phaseStartedAt: number;
  phaseEndsAt: number;
};

const SERVER_ARENA_DIMENSION = 1_000;
const SIMULATION_INTERVAL_MS = 50;
const MAX_MANA = 100;
const MANA_REGEN_PER_SECOND = 5;
const SHIELD_BLOCKED_FEEDBACK_MS = 440;
const SHIELDED_FREEZE_DURATION_MS = 1_000;

export class DuelRoom extends Room<DuelRoomOptions> {
  public maxClients = 2;

  private readonly activeStrokes = new Map<string, ActiveStroke>();
  private readonly completedStrokes = new Map<string, RuneStroke[]>();
  private readonly activeCasts = new Map<string, ActiveCast>();
  private readonly manaRegenRemainders = new Map<string, number>();
  private strokeSequence = 0;

  public onCreate(): void {
    this.setState(
      new MatchState({
        roomId: this.roomId,
      }),
    );
    this.metadata = { roomId: this.roomId };
    this.setSimulationInterval((deltaTime) => this.tick(deltaTime), SIMULATION_INTERVAL_MS);

    this.onMessage("ready", (client, message: ReadyMessage) => {
      if (isReadyMessage(message)) {
        this.handleReady(client, message);
      }
    });

    this.onMessage("ping", (client, message: PingMessage) => {
      if (isPingMessage(message)) {
        this.handlePing(client, message);
      }
    });

    this.onMessage("leave", (client, message: LeaveMessage) => {
      if (isLeaveMessage(message)) {
        this.handleLeave(client, message);
      }
    });

    this.onMessage("draw:start", (client, message: DrawStartMessage) => {
      const normalized = normalizeDrawStartMessage(message);
      if (normalized) this.handleDrawStart(client, normalized);
      else this.handleInvalidDrawing(client, "invalid");
    });

    this.onMessage("draw:points", (client, message: DrawPointsMessage) => {
      const normalized = normalizeDrawPointsMessage(message);
      if (normalized) this.handleDrawPoints(client, normalized);
      else this.handleInvalidDrawing(client, "invalid");
    });

    this.onMessage("draw:end", (client, message: DrawEndMessage) => {
      const normalized = normalizeDrawEndMessage(message);
      if (normalized) this.handleDrawEnd(client, normalized);
      else this.handleInvalidDrawing(client, "invalid");
    });

    this.onMessage("spell:match", (client, message: SpellMatchMessage) => {
      const normalized = normalizeSpellMatchMessage(message);
      if (normalized) this.handleSpellMatch(client, normalized);
      else this.rejectSpell(client, "invalid-message", "The spell match packet is invalid.");
    });
  }

  public onJoin(client: DuelRoomClient, options: JoinOptions): void {
    if (this.state.phase === MatchPhase.Finished) {
      throw new Error("This match has finished");
    }

    const metadata = normalizePlayerMetadata(options);
    client.userData = metadata;
    this.state.players.set(
      client.sessionId,
      new PlayerState({
        sessionId: client.sessionId,
        displayName: metadata.displayName,
        wizardId: metadata.wizardId,
      }),
    );
    this.manaRegenRemainders.set(client.sessionId, 0);
    this.refreshPhase();
  }

  public onLeave(client: DuelRoomClient): void {
    const activeStroke = this.activeStrokes.get(client.sessionId);
    if (activeStroke) this.sendRemoteClear(client, activeStroke.strokeId, "cancelled");
    this.activeStrokes.delete(client.sessionId);
    this.completedStrokes.delete(client.sessionId);
    this.activeCasts.delete(client.sessionId);
    this.manaRegenRemainders.delete(client.sessionId);
    this.removeCompletedStrokeState(client.sessionId);

    const player = this.state.players.get(client.sessionId);
    if (!player) {
      return;
    }

    const wasPlaying = this.state.phase === MatchPhase.Playing;
    this.state.players.delete(client.sessionId);

    if (wasPlaying) {
      this.finishMatch(this.state.players.keys().next().value ?? "", "leave");
      return;
    }

    this.refreshPhase();
  }

  public finishMatch(winnerSessionId: string, reason: "health" | "leave" = "leave"): void {
    if (this.state.phase === MatchPhase.Finished) {
      return;
    }

    this.state.phase = MatchPhase.Finished;
    this.state.winnerSessionId = winnerSessionId;
    for (const client of this.clients) {
      const activeStroke = this.activeStrokes.get(client.sessionId);
      if (activeStroke) this.sendRemoteClear(client, activeStroke.strokeId, "finished");
    }
    for (const player of this.state.players.values()) {
      player.activeSpellId = "";
      player.activeSpellPhase = SpellPhase.Ready;
      player.activeSpellStartedAt = 0;
      player.activeSpellEndsAt = 0;
    }
    this.activeCasts.clear();
    this.activeStrokes.clear();

    const loserSessionId = Array.from(this.state.players.keys()).find((sessionId) => sessionId !== winnerSessionId);
    const message: MatchEndedMessage = {
      winnerSessionId,
      ...(loserSessionId === undefined ? {} : { loserSessionId }),
      reason,
      serverTime: Date.now(),
    };
    this.broadcast("match:ended", message);
    void this.lock();
  }

  private handleReady(client: DuelRoomClient, message: ReadyMessage): void {
    if (this.state.phase === MatchPhase.Playing || this.state.phase === MatchPhase.Finished) {
      return;
    }

    const player = this.state.players.get(client.sessionId);
    if (!player) {
      return;
    }

    player.ready = message.ready ?? true;
    this.refreshPhase();
  }

  private handlePing(client: DuelRoomClient, message: PingMessage): void {
    client.send("pong", {
      nonce: message.nonce ?? "",
      serverTime: Date.now(),
    });
  }

  private handleLeave(client: DuelRoomClient, message: LeaveMessage): void {
    const reason = message.reason?.trim().slice(0, 128);
    client.leave(1000, reason || undefined);
  }

  private handleDrawStart(client: DuelRoomClient, message: DrawStartMessage): void {
    if (!this.canDraw(client.sessionId)) {
      this.sendRemoteClear(client, undefined, "cancelled");
      return;
    }

    const point = message.point;
    if (!point) {
      this.handleInvalidDrawing(client, "invalid");
      return;
    }

    const previous = this.activeStrokes.get(client.sessionId);
    if (previous) this.sendRemoteClear(client, previous.strokeId, "cancelled");

    const strokeId = message.strokeId ?? this.nextStrokeId(client.sessionId);
    const stroke: ActiveStroke = {
      strokeId,
      points: [copyPoint(point)],
      ...(point.timestamp === undefined ? {} : { startedAt: point.timestamp }),
    };
    this.activeStrokes.set(client.sessionId, stroke);
    this.sendRemotePreview(client, stroke);
  }

  private handleDrawPoints(client: DuelRoomClient, message: DrawPointsMessage): void {
    if (!this.canDraw(client.sessionId)) {
      this.sendRemoteClear(client, message.strokeId, "cancelled");
      return;
    }

    const activeStroke = this.activeStrokes.get(client.sessionId);
    if (!activeStroke || (message.strokeId !== undefined && message.strokeId !== activeStroke.strokeId)) {
      this.handleInvalidDrawing(client, "invalid");
      return;
    }

    const points = message.points ?? [];
    if (activeStroke.points.length + points.length > MAX_DRAW_POINTS_PER_STROKE) {
      this.activeStrokes.delete(client.sessionId);
      this.sendRemoteClear(client, activeStroke.strokeId, "invalid");
      return;
    }
    activeStroke.points.push(...points.map(copyPoint));
    this.sendRemotePreview(client, activeStroke, points);
  }

  private handleDrawEnd(client: DuelRoomClient, message: DrawEndMessage): void {
    const activeStroke = this.activeStrokes.get(client.sessionId);
    if (!activeStroke || (message.strokeId !== undefined && message.strokeId !== activeStroke.strokeId)) {
      this.handleInvalidDrawing(client, "invalid");
      return;
    }

    if (!this.canDraw(client.sessionId)) {
      this.activeStrokes.delete(client.sessionId);
      this.sendRemoteClear(client, activeStroke.strokeId, "cancelled");
      return;
    }

    const finalPoints = message.points ?? [];
    const normalizedPoints = message.normalizedPoints;
    if (
      activeStroke.points.length + finalPoints.length > MAX_DRAW_POINTS_PER_STROKE ||
      (normalizedPoints !== undefined && normalizedPoints.length > MAX_DRAW_POINTS_PER_STROKE)
    ) {
      this.activeStrokes.delete(client.sessionId);
      this.sendRemoteClear(client, activeStroke.strokeId, "invalid");
      return;
    }
    activeStroke.points.push(...finalPoints.map(copyPoint));
    this.activeStrokes.delete(client.sessionId);

    // Shape tools stream the user's raw pointer path for the live preview. The
    // server re-normalizes that canonical path so recognition is independent of
    // the browser's viewport scale. Keep the old normalizedPoints fallback for
    // older clients that do not send drawingTool yet.
    const completedPoints = message.drawingTool !== undefined
      ? normalizeDrawingStroke(activeStroke.points, message.drawingTool)
      : normalizedPoints?.map(copyPoint) ?? activeStroke.points;

    const stroke: RuneStroke = {
      points: completedPoints,
      ...(message.startedAt ?? activeStroke.startedAt) === undefined
        ? {}
        : { startedAt: message.startedAt ?? activeStroke.startedAt },
      ...(message.endedAt === undefined ? {} : { endedAt: message.endedAt }),
    };
    const pending = this.completedStrokes.get(client.sessionId) ?? [];
    if (pending.length >= MAX_DRAW_STROKES) {
      this.clearDrawing(client, activeStroke.strokeId, "invalid");
      return;
    }
    pending.push(stroke);
    this.completedStrokes.set(client.sessionId, pending);
    this.storeCompletedStroke(client.sessionId, activeStroke.strokeId, stroke);
    this.broadcast(
      "draw:remote-end",
      {
        sessionId: client.sessionId,
        strokeId: activeStroke.strokeId,
        stroke,
      },
      { except: client },
    );
  }

  private handleSpellMatch(client: DuelRoomClient, message: SpellMatchMessage): void {
    if (this.state.phase === MatchPhase.Finished) {
      this.rejectSpell(client, "match-ended", "This match has ended.");
      return;
    }
    if (this.state.phase !== MatchPhase.Playing || !this.state.players.has(client.sessionId)) {
      this.rejectSpell(client, "not-in-match", "The duel is not currently playing.");
      return;
    }

    if (message.spellId !== undefined && !isSupportedSpellId(message.spellId)) {
      this.rejectSpell(client, "unsupported-spell", "That spell is not supported by this server.", message.spellId);
      return;
    }

    const strokes = this.completedStrokes.get(client.sessionId) ?? [];
    if (strokes.length === 0) {
      this.rejectSpell(client, "not-recognized", "Draw a rune before matching it.", message.spellId);
      return;
    }

    // The server owns the arena dimension to prevent a client from lowering
    // recognition thresholds. The optional client value is accepted for wire
    // compatibility but is intentionally not used for authorization.
    const match = recognizeAnySpell(strokes, SERVER_ARENA_DIMENSION);
    if (!match.recognition.recognized) {
      const incomplete = match.recognition.stage === "awaiting-second-stroke" || match.recognition.stage === "awaiting-next-stroke";
      this.rejectSpell(
        client,
        incomplete ? "incomplete-rune" : "not-recognized",
        match.recognition.hint,
        message.spellId,
        match.recognition.progress,
      );
      if (!incomplete) this.clearDrawing(client, undefined, "failed");
      return;
    }

    if (!isSupportedSpellId(match.spell.id)) {
      this.rejectSpell(client, "unsupported-spell", "That rune maps to an unsupported spell.", match.spell.id);
      this.clearDrawing(client, undefined, "failed");
      return;
    }
    this.acceptSpell(client, match.spell, Date.now());
  }

  private acceptSpell(client: DuelRoomClient, spell: SpellData, now: number): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) {
      this.rejectSpell(client, "not-in-match", "You are not a player in this duel.", spell.id);
      return;
    }

    const activeCast = this.activeCasts.get(client.sessionId);
    if (player.frozen) {
      this.rejectSpell(client, "frozen", "You cannot cast while frozen.", spell.id);
      return;
    }
    if (player.stunned) {
      this.rejectSpell(client, "stunned", "You cannot cast while stunned.", spell.id);
      return;
    }
    if (now < player.cooldownUntil) {
      this.rejectSpell(client, "cooldown", "That spell is still cooling down.", spell.id);
      return;
    }
    if (player.mana < spell.manaCost) {
      this.rejectSpell(client, "mana", "There is not enough mana for that spell.", spell.id);
      return;
    }

    const isDefensive = spell.kind === "defensive";
    if (isDefensive) {
      if (activeCast && activeCast.phase !== "flying") {
        this.rejectSpell(client, "phase", "Aegis can only be cast while ready or during projectile flight.", spell.id);
        return;
      }
    } else if (activeCast || player.activeSpellPhase !== SpellPhase.Ready) {
      this.rejectSpell(client, "phase", "Finish the current spell before casting another.", spell.id);
      return;
    }

    player.mana = Math.max(0, player.mana - spell.manaCost);
    player.cooldownUntil = now + spell.cooldown * 1_000;
    this.clearDrawing(client, undefined, "matched");

    if (isDefensive) {
      player.shield = true;
      player.shieldUntil = now + (spell.shieldDurationMs ?? 0);
      player.shieldBlockedUntil = 0;
      if (!activeCast) {
        player.activeSpellId = spell.id;
        player.activeSpellPhase = SpellPhase.Impact;
        player.activeSpellStartedAt = now;
        player.activeSpellEndsAt = now;
      }
      this.broadcast("spell:accepted", {
        spellId: spell.id as SupportedSpellId,
        casterSessionId: client.sessionId,
        phase: "impact",
        phaseStartedAt: now,
        phaseEndsAt: now,
        mana: player.mana,
        cooldownUntil: player.cooldownUntil,
      });
      return;
    }

    const cast: ActiveCast = {
      spell,
      phase: "charging",
      phaseStartedAt: now,
      phaseEndsAt: now + spell.timings.charging,
    };
    this.activeCasts.set(client.sessionId, cast);
    this.setPlayerPhase(player, cast);
    this.broadcast("spell:accepted", {
      spellId: spell.id as SupportedSpellId,
      casterSessionId: client.sessionId,
      phase: cast.phase,
      phaseStartedAt: cast.phaseStartedAt,
      phaseEndsAt: cast.phaseEndsAt,
      mana: player.mana,
      cooldownUntil: player.cooldownUntil,
    });
  }

  private tick(deltaTime: number): void {
    if (this.state.phase !== MatchPhase.Playing) return;
    const now = Date.now();
    const delta = Number.isFinite(deltaTime) && deltaTime >= 0 ? Math.min(deltaTime, 1_000) : SIMULATION_INTERVAL_MS;

    for (const [sessionId, player] of this.state.players.entries()) {
      this.expirePlayerEffects(player, now);
      this.regenerateMana(sessionId, player, delta);

      const cast = this.activeCasts.get(sessionId);
      if (!cast) {
        if (player.activeSpellId === "aegis" && player.activeSpellPhase === SpellPhase.Impact) {
          this.clearPlayerSpell(player);
        }
        continue;
      }

      // A status effect may cancel a cast during the same tick.
      if (this.activeCasts.get(sessionId) !== cast) continue;
      let transitions = 0;
      while (this.activeCasts.get(sessionId) === cast && now >= cast.phaseEndsAt && transitions < 4) {
        transitions += 1;
        if (cast.phase === "charging") {
          cast.phase = "flying";
          cast.phaseStartedAt = now;
          cast.phaseEndsAt = now + cast.spell.timings.flying;
          this.setPlayerPhase(player, cast);
          this.broadcastSpellPhase(sessionId, cast);
        } else if (cast.phase === "flying") {
          cast.phase = "impact";
          cast.phaseStartedAt = now;
          cast.phaseEndsAt = now + cast.spell.timings.impact;
          this.setPlayerPhase(player, cast);
          this.broadcastSpellPhase(sessionId, cast);
          this.applySpellImpact(sessionId, cast.spell, now);
        } else {
          this.activeCasts.delete(sessionId);
          this.clearPlayerSpell(player);
        }
      }
    }
  }

  private expirePlayerEffects(player: PlayerState, now: number): void {
    if (player.shield && now >= player.shieldUntil) {
      player.shield = false;
      player.shieldUntil = 0;
    }
    if (player.frozen && now >= player.frozenUntil) {
      player.frozen = false;
      player.frozenUntil = 0;
    }
    if (player.stunned && now >= player.stunnedUntil) {
      player.stunned = false;
      player.stunnedUntil = 0;
    }
  }

  private regenerateMana(sessionId: string, player: PlayerState, deltaTime: number): void {
    if (player.mana >= MAX_MANA || player.activeSpellPhase !== SpellPhase.Ready || player.frozen || player.stunned) {
      return;
    }
    const accumulated = (this.manaRegenRemainders.get(sessionId) ?? 0) + deltaTime * MANA_REGEN_PER_SECOND / 1_000;
    const gain = Math.floor(accumulated);
    this.manaRegenRemainders.set(sessionId, accumulated - gain);
    if (gain > 0) player.mana = Math.min(MAX_MANA, player.mana + gain);
  }

  private applySpellImpact(casterSessionId: string, spell: SpellData, now: number): void {
    const target = Array.from(this.state.players.values()).find((player) => player.sessionId !== casterSessionId);
    if (!target) return;

    const shieldConsumed = target.shield;
    const blocked = shieldConsumed;
    let damage = 0;
    let effect: "freeze" | "stun" | "mana-drain" | undefined;
    let effectDurationMs: number | undefined;

    if (shieldConsumed) {
      target.shield = false;
      target.shieldUntil = 0;
      target.shieldBlockedUntil = now + SHIELD_BLOCKED_FEEDBACK_MS;
      if (spell.id === "freeze") {
        effect = "freeze";
        effectDurationMs = SHIELDED_FREEZE_DURATION_MS;
        this.applyFrozen(target, now, effectDurationMs);
      }
    } else {
      damage = Math.max(0, spell.damage);
      target.health = Math.max(0, target.health - damage);
      if (spell.id === "freeze") {
        effect = "freeze";
        effectDurationMs = spell.freezeDurationMs ?? 0;
        this.applyFrozen(target, now, effectDurationMs);
      } else if (spell.id === "lightning" && spell.stunDurationMs) {
        effect = "stun";
        effectDurationMs = spell.stunDurationMs;
        this.applyStunned(target, now, effectDurationMs);
      } else if (spell.id === "ghost-portal" && spell.manaDrain) {
        effect = "mana-drain";
        target.mana = 0;
      }
    }

    this.broadcast("spell:impact", {
      spellId: spell.id as SupportedSpellId,
      casterSessionId,
      targetSessionId: target.sessionId,
      damage,
      blocked,
      shieldConsumed,
      health: target.health,
      mana: target.mana,
      ...(effect === undefined ? {} : { effect }),
      ...(effectDurationMs === undefined ? {} : { effectDurationMs }),
      ...(spell.summonCount === undefined ? {} : { summonCount: spell.summonCount }),
      serverTime: now,
    });

    if (target.health <= 0) this.finishMatch(casterSessionId, "health");
  }

  private applyFrozen(target: PlayerState, now: number, durationMs: number): void {
    if (durationMs <= 0) return;
    target.frozen = true;
    target.frozenUntil = Math.max(target.frozenUntil, now + durationMs);
    this.cancelActiveCast(target);
  }

  private applyStunned(target: PlayerState, now: number, durationMs: number): void {
    if (durationMs <= 0) return;
    target.stunned = true;
    target.stunnedUntil = Math.max(target.stunnedUntil, now + durationMs);
    this.cancelActiveCast(target);
  }

  private cancelActiveCast(player: PlayerState): void {
    const cast = this.activeCasts.get(player.sessionId);
    if (!cast) return;
    this.activeCasts.delete(player.sessionId);
    this.clearPlayerSpell(player);
    this.broadcast("spell:phase", {
      spellId: cast.spell.id as SupportedSpellId,
      casterSessionId: player.sessionId,
      phase: "ready",
      phaseStartedAt: Date.now(),
      phaseEndsAt: 0,
    });
  }

  private setPlayerPhase(player: PlayerState, cast: ActiveCast): void {
    player.activeSpellId = cast.spell.id;
    player.activeSpellPhase = cast.phase;
    player.activeSpellStartedAt = cast.phaseStartedAt;
    player.activeSpellEndsAt = cast.phaseEndsAt;
  }

  private clearPlayerSpell(player: PlayerState): void {
    player.activeSpellId = "";
    player.activeSpellPhase = SpellPhase.Ready;
    player.activeSpellStartedAt = 0;
    player.activeSpellEndsAt = 0;
  }

  private broadcastSpellPhase(sessionId: string, cast: ActiveCast): void {
    this.broadcast("spell:phase", {
      spellId: cast.spell.id as SupportedSpellId,
      casterSessionId: sessionId,
      phase: cast.phase,
      phaseStartedAt: cast.phaseStartedAt,
      phaseEndsAt: cast.phaseEndsAt,
    });
  }

  private canDraw(sessionId: string): boolean {
    if (this.state.phase !== MatchPhase.Playing) return false;
    const player = this.state.players.get(sessionId);
    return player !== undefined && !player.frozen && !player.stunned &&
      (player.activeSpellPhase === SpellPhase.Ready || player.activeSpellPhase === SpellPhase.Flying);
  }

  private handleInvalidDrawing(client: DuelRoomClient, reason: "invalid" | "cancelled"): void {
    const activeStroke = this.activeStrokes.get(client.sessionId);
    this.activeStrokes.delete(client.sessionId);
    this.sendRemoteClear(client, activeStroke?.strokeId, reason);
  }

  private clearDrawing(client: DuelRoomClient, strokeId: string | undefined, reason: "matched" | "failed" | "cancelled" | "invalid" | "finished"): void {
    this.activeStrokes.delete(client.sessionId);
    this.completedStrokes.delete(client.sessionId);
    this.removeCompletedStrokeState(client.sessionId);
    this.sendRemoteClear(client, strokeId, reason);
  }

  private sendRemotePreview(
    client: DuelRoomClient,
    stroke: ActiveStroke,
    points: DrawPoint[] = stroke.points,
  ): void {
    this.broadcast(
      "draw:remote-preview",
      {
        sessionId: client.sessionId,
        strokeId: stroke.strokeId,
        points: points.map(copyPoint),
      },
      { except: client },
    );
  }

  private sendRemoteClear(client: DuelRoomClient, strokeId: string | undefined, reason: "matched" | "failed" | "cancelled" | "invalid" | "finished"): void {
    this.broadcast(
      "draw:remote-clear",
      {
        sessionId: client.sessionId,
        ...(strokeId === undefined ? {} : { strokeId }),
        reason,
      },
      { except: client },
    );
  }

  private rejectSpell(client: DuelRoomClient, reason: "invalid-message" | "not-in-match" | "not-recognized" | "incomplete-rune" | "unsupported-spell" | "mana" | "cooldown" | "phase" | "frozen" | "stunned" | "match-ended", message: string, spellId?: string, progress?: number): void {
    client.send("spell:rejected", {
      ...(spellId === undefined ? {} : { spellId }),
      reason,
      message: message.slice(0, MAX_REJECTION_MESSAGE_LENGTH),
      ...(progress === undefined ? {} : { progress }),
    });
  }

  private storeCompletedStroke(sessionId: string, strokeId: string, stroke: RuneStroke): void {
    const stateStroke = new CompletedStrokeState({
      strokeId,
      ownerSessionId: sessionId,
      startedAt: stroke.startedAt ?? 0,
      endedAt: stroke.endedAt ?? 0,
    });
    for (const point of stroke.points) {
      stateStroke.points.push(new DrawingPointState({
        x: point.x,
        y: point.y,
        timestamp: point.timestamp ?? 0,
      }));
    }
    this.state.completedStrokes.set(`${sessionId}:${strokeId}`, stateStroke);
  }

  private removeCompletedStrokeState(sessionId: string): void {
    for (const [key, stroke] of this.state.completedStrokes.entries()) {
      if (stroke.ownerSessionId === sessionId || key.startsWith(`${sessionId}:`)) this.state.completedStrokes.delete(key);
    }
  }

  private nextStrokeId(sessionId: string): string {
    this.strokeSequence += 1;
    return `${sessionId.slice(0, 12)}-${this.strokeSequence}`;
  }

  private refreshPhase(): void {
    if (this.state.phase === MatchPhase.Finished) return;
    if (this.state.players.size < this.maxClients) {
      this.state.phase = MatchPhase.Waiting;
      return;
    }
    const allReady = Array.from(this.state.players.values()).every((player) => player.ready);
    this.state.phase = allReady ? MatchPhase.Playing : MatchPhase.Ready;
  }
}

function isSupportedSpellId(value: string): value is SupportedSpellId {
  return (SUPPORTED_SPELL_IDS as readonly string[]).includes(value) && SPELLS.some((spell) => spell.id === value);
}

function copyPoint(point: DrawPoint): DrawPoint {
  return point.timestamp === undefined
    ? { x: point.x, y: point.y }
    : { x: point.x, y: point.y, timestamp: point.timestamp };
}

function normalizePlayerMetadata(options: unknown): PlayerMetadata {
  const input = isRecord(options) ? options : {};
  return {
    displayName: normalizeText(input.displayName, "Anonymous Wizard", 32),
    wizardId: normalizeText(input.wizardId, "apprentice", 32),
  };
}

function normalizeText(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().slice(0, maxLength);
  return normalized || fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
