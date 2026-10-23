import type { RuneStroke } from "../game/recognition/shared";

/** The spell ids shipped in data/spells.json. */
export const SUPPORTED_SPELL_IDS = [
  "ember-lance",
  "lightning",
  "aegis",
  "freeze",
  "ghost-portal",
] as const;
export type SupportedSpellId = (typeof SUPPORTED_SPELL_IDS)[number];

export const MAX_DRAW_POINTS_PER_PACKET = 64;
export const MAX_DRAW_POINTS_PER_STROKE = 256;
export const MAX_DRAW_STROKES = 3;
export const MAX_DRAW_COORDINATE = 4096;
/** Accept browser-relative and epoch timestamps, but reject unsafe numbers. */
export const MAX_DRAW_TIMESTAMP = Number.MAX_SAFE_INTEGER;
export const MAX_STROKE_ID_LENGTH = 64;
export const MAX_REJECTION_MESSAGE_LENGTH = 160;

export interface ReadyMessage {
  ready?: boolean;
}

export interface PingMessage {
  nonce?: string;
}

export interface LeaveMessage {
  reason?: string;
}

export interface PongMessage {
  nonce: string;
  serverTime: number;
}

export interface DrawPointMessage {
  x: number;
  y: number;
  timestamp?: number;
}

export interface DrawStartMessage {
  strokeId?: string;
  point?: DrawPointMessage;
  /** Convenience form for clients that send the first point at top level. */
  x?: number;
  y?: number;
  timestamp?: number;
}

export interface DrawPointsMessage {
  strokeId?: string;
  points?: DrawPointMessage[];
  /** A single point is accepted as a compact packet. */
  point?: DrawPointMessage;
}

export interface DrawEndMessage {
  strokeId?: string;
  points?: DrawPointMessage[];
  /** Optional client-side shape-tool result used for final recognition. */
  normalizedPoints?: DrawPointMessage[];
  point?: DrawPointMessage;
  startedAt?: number;
  endedAt?: number;
}

export interface SpellMatchMessage {
  /** Client hint only. The server chooses the recognized spell. */
  spellId?: string;
  arenaDimension?: number;
}

export interface DrawPreviewMessage {
  sessionId: string;
  strokeId: string;
  /** New points since the previous preview packet for this stroke. */
  points: DrawPointMessage[];
}

export interface DrawEndBroadcastMessage {
  sessionId: string;
  strokeId: string;
  stroke: RuneStroke;
}

export interface DrawClearMessage {
  sessionId: string;
  strokeId?: string;
  reason?: "matched" | "failed" | "cancelled" | "invalid" | "finished";
}

export type SpellPhase = "charging" | "flying" | "impact";

export interface SpellAcceptedMessage {
  spellId: SupportedSpellId;
  casterSessionId: string;
  phase: SpellPhase;
  phaseStartedAt: number;
  phaseEndsAt: number;
  mana: number;
  cooldownUntil: number;
}

export type SpellRejectReason =
  | "invalid-message"
  | "not-in-match"
  | "not-recognized"
  | "incomplete-rune"
  | "unsupported-spell"
  | "mana"
  | "cooldown"
  | "phase"
  | "frozen"
  | "stunned"
  | "match-ended";

export interface SpellRejectedMessage {
  spellId?: string;
  reason: SpellRejectReason;
  message: string;
  progress?: number;
}

export interface SpellPhaseMessage {
  spellId: SupportedSpellId;
  casterSessionId: string;
  phase: "charging" | "flying" | "impact" | "ready";
  phaseStartedAt: number;
  phaseEndsAt: number;
}

export interface SpellImpactMessage {
  spellId: SupportedSpellId;
  casterSessionId: string;
  targetSessionId: string;
  damage: number;
  blocked: boolean;
  shieldConsumed: boolean;
  health: number;
  mana: number;
  effect?: "freeze" | "stun" | "mana-drain";
  effectDurationMs?: number;
  summonCount?: number;
  serverTime: number;
}

export interface MatchEndedMessage {
  winnerSessionId: string;
  loserSessionId?: string;
  reason: "health" | "leave";
  serverTime: number;
}

export interface DuelMessages {
  ready: ReadyMessage;
  ping: PingMessage;
  leave: LeaveMessage;
  "draw:start": DrawStartMessage;
  "draw:points": DrawPointsMessage;
  "draw:end": DrawEndMessage;
  "spell:match": SpellMatchMessage;
  "draw:remote-preview": DrawPreviewMessage;
  "draw:remote-end": DrawEndBroadcastMessage;
  "draw:remote-clear": DrawClearMessage;
  "spell:accepted": SpellAcceptedMessage;
  "spell:rejected": SpellRejectedMessage;
  "spell:phase": SpellPhaseMessage;
  "spell:impact": SpellImpactMessage;
  "match:ended": MatchEndedMessage;
  pong: PongMessage;
}

export function isReadyMessage(value: unknown): value is ReadyMessage {
  return (
    value === undefined ||
    (isRecord(value) &&
      (value.ready === undefined || typeof value.ready === "boolean"))
  );
}

export function isPingMessage(value: unknown): value is PingMessage {
  return (
    value === undefined ||
    (isRecord(value) &&
      (value.nonce === undefined || typeof value.nonce === "string"))
  );
}

export function isLeaveMessage(value: unknown): value is LeaveMessage {
  return (
    value === undefined ||
    (isRecord(value) &&
      (value.reason === undefined || typeof value.reason === "string"))
  );
}

export function isDrawStartMessage(value: unknown): value is DrawStartMessage {
  return normalizeDrawStartMessage(value) !== null;
}

export function isDrawPointsMessage(value: unknown): value is DrawPointsMessage {
  return normalizeDrawPointsMessage(value) !== null;
}

export function isDrawEndMessage(value: unknown): value is DrawEndMessage {
  return normalizeDrawEndMessage(value) !== null;
}

export function isSpellMatchMessage(value: unknown): value is SpellMatchMessage {
  return normalizeSpellMatchMessage(value) !== null;
}

/**
 * Normalize a point without trusting client coordinates or timestamps. The
 * server deliberately keeps the coordinate space in arena pixels; clients can
 * choose their own viewport as long as it stays inside this bounded space.
 */
export function normalizeDrawPoint(value: unknown): DrawPointMessage | null {
  if (!isRecord(value)) return null;
  const x = value.x;
  const y = value.y;
  const timestamp = value.timestamp;
  if (
    typeof x !== "number" || !Number.isFinite(x) || x < 0 || x > MAX_DRAW_COORDINATE ||
    typeof y !== "number" || !Number.isFinite(y) || y < 0 || y > MAX_DRAW_COORDINATE
  ) {
    return null;
  }
  if (
    timestamp !== undefined &&
    (typeof timestamp !== "number" || !Number.isFinite(timestamp) || timestamp < 0 || timestamp > MAX_DRAW_TIMESTAMP)
  ) {
    return null;
  }
  return timestamp === undefined ? { x, y } : { x, y, timestamp };
}

export function normalizeStrokeId(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= MAX_STROKE_ID_LENGTH ? normalized : null;
}

export function normalizeDrawStartMessage(value: unknown): DrawStartMessage | null {
  if (!isRecord(value)) return null;
  const strokeId = normalizeStrokeId(value.strokeId ?? value.id);
  if (strokeId === null) return null;

  const pointValue = value.point ?? value;
  const point = normalizeDrawPoint(pointValue);
  if (!point) return null;
  return { ...(strokeId === undefined ? {} : { strokeId }), point };
}

export function normalizeDrawPointsMessage(value: unknown): DrawPointsMessage | null {
  if (!isRecord(value)) return null;
  const strokeId = normalizeStrokeId(value.strokeId ?? value.id);
  if (strokeId === null) return null;
  const rawPoints = value.points === undefined ? (value.point === undefined ? [] : [value.point]) : value.points;
  if (!Array.isArray(rawPoints) || rawPoints.length === 0 || rawPoints.length > MAX_DRAW_POINTS_PER_PACKET) return null;
  const points = rawPoints.map(normalizeDrawPoint);
  if (points.some((point): point is null => point === null)) return null;
  return { ...(strokeId === undefined ? {} : { strokeId }), points: points as DrawPointMessage[] };
}

export function normalizeDrawEndMessage(value: unknown): DrawEndMessage | null {
  if (!isRecord(value)) return null;
  const strokeId = normalizeStrokeId(value.strokeId ?? value.id);
  if (strokeId === null) return null;

  const rawPoints = value.points === undefined ? (value.point === undefined ? [] : [value.point]) : value.points;
  if (!Array.isArray(rawPoints) || rawPoints.length > MAX_DRAW_POINTS_PER_PACKET) return null;
  const points = rawPoints.map(normalizeDrawPoint);
  if (points.some((point): point is null => point === null)) return null;

  const rawNormalizedPoints = value.normalizedPoints;
  let normalizedPoints: DrawPointMessage[] | undefined;
  if (rawNormalizedPoints !== undefined) {
    if (!Array.isArray(rawNormalizedPoints) || rawNormalizedPoints.length > MAX_DRAW_POINTS_PER_PACKET) return null;
    const normalized = rawNormalizedPoints.map(normalizeDrawPoint);
    if (normalized.some((point): point is null => point === null)) return null;
    normalizedPoints = normalized as DrawPointMessage[];
  }

  const startedAt = normalizeTimestamp(value.startedAt);
  const endedAt = normalizeTimestamp(value.endedAt);
  if (startedAt === null || endedAt === null) return null;
  return {
    ...(strokeId === undefined ? {} : { strokeId }),
    ...(points.length === 0 ? {} : { points: points as DrawPointMessage[] }),
    ...(normalizedPoints === undefined ? {} : { normalizedPoints }),
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(endedAt === undefined ? {} : { endedAt }),
  };
}

export function normalizeSpellMatchMessage(value: unknown): SpellMatchMessage | null {
  if (value === undefined) return {};
  if (!isRecord(value)) return null;
  // Strokes are deliberately not accepted here. The room must recognize only
  // the strokes it received through draw:start/points/end, otherwise a client
  // could skip the realtime drawing protocol and submit a forged rune.
  if ("strokes" in value) return null;
  const spellId = value.spellId;
  if (spellId !== undefined && (typeof spellId !== "string" || spellId.trim().length === 0 || spellId.length > MAX_STROKE_ID_LENGTH)) return null;

  let arenaDimension: number | undefined;
  if (value.arenaDimension !== undefined) {
    if (typeof value.arenaDimension !== "number" || !Number.isFinite(value.arenaDimension) || value.arenaDimension < 1 || value.arenaDimension > MAX_DRAW_COORDINATE) return null;
    arenaDimension = value.arenaDimension;
  }

  return {
    ...(spellId === undefined ? {} : { spellId: spellId.trim() }),
    ...(arenaDimension === undefined ? {} : { arenaDimension }),
  };
}

function normalizeTimestamp(value: unknown): number | undefined | null {
  if (value === undefined) return undefined;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_DRAW_TIMESTAMP ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
