import { schema, t, type SchemaType } from "@colyseus/schema";

import {
  MATCH_PHASES,
  type MatchPhase as SharedMatchPhase,
} from "./multiplayer";

export const MatchPhase = {
  Waiting: MATCH_PHASES[0],
  Ready: MATCH_PHASES[1],
  Playing: MATCH_PHASES[2],
  Finished: MATCH_PHASES[3],
} as const;

export type MatchPhase = SharedMatchPhase;

export const SpellPhase = {
  Ready: "ready",
  Charging: "charging",
  Flying: "flying",
  Impact: "impact",
} as const;

export type SpellPhase = (typeof SpellPhase)[keyof typeof SpellPhase];

export const DrawingPointState = schema(
  {
    x: t.float32().default(0),
    y: t.float32().default(0),
    timestamp: t.float64().default(0),
  },
  "DrawingPointState",
);

export type DrawingPointState = SchemaType<typeof DrawingPointState>;

export const CompletedStrokeState = schema(
  {
    strokeId: t.string(),
    ownerSessionId: t.string(),
    points: t.array(DrawingPointState),
    startedAt: t.float64().default(0),
    endedAt: t.float64().default(0),
  },
  "CompletedStrokeState",
);

export type CompletedStrokeState = SchemaType<typeof CompletedStrokeState>;

export const PlayerState = schema(
  {
    sessionId: t.string(),
    displayName: t.string(),
    wizardId: t.string(),
    ready: t.boolean().default(false),
    health: t.uint8().default(100),
    mana: t.uint8().default(100),
    score: t.uint16().default(0),
    shield: t.boolean().default(false),
    shieldUntil: t.float64().default(0),
    shieldBlockedUntil: t.float64().default(0),
    frozen: t.boolean().default(false),
    frozenUntil: t.float64().default(0),
    stunned: t.boolean().default(false),
    stunnedUntil: t.float64().default(0),
    activeSpellId: t.string().default(""),
    activeSpellPhase: t.string().default(SpellPhase.Ready),
    activeSpellStartedAt: t.float64().default(0),
    activeSpellEndsAt: t.float64().default(0),
    cooldownUntil: t.float64().default(0),
  },
  "PlayerState",
);

export type PlayerState = SchemaType<typeof PlayerState>;

export const MatchState = schema(
  {
    roomId: t.string(),
    phase: t.string().default(MatchPhase.Waiting),
    players: t.map(PlayerState),
    winnerSessionId: t.string().default(""),
    // Keep new synchronized fields after the original fields. Colyseus uses
    // declaration order as the wire index, so inserting a field before an
    // existing one makes older servers and clients decode different types.
    completedStrokes: t.map(CompletedStrokeState),
  },
  "MatchState",
);

export type MatchState = SchemaType<typeof MatchState>;
