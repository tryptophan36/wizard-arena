import { schema, t, type SchemaType } from "@colyseus/schema";

import {
  MATCH_PHASES,
  type MatchPhase as SharedMatchPhase,
} from "../shared/multiplayer";

export const MatchPhase = {
  Waiting: MATCH_PHASES[0],
  Ready: MATCH_PHASES[1],
  Playing: MATCH_PHASES[2],
  Finished: MATCH_PHASES[3],
} as const;

export type MatchPhase = SharedMatchPhase;

export const PlayerState = schema(
  {
    sessionId: t.string(),
    displayName: t.string(),
    wizardId: t.string(),
    ready: t.boolean().default(false),
    health: t.uint8().default(100),
    mana: t.uint8().default(100),
    score: t.uint16().default(0),
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
  },
  "MatchState",
);

export type MatchState = SchemaType<typeof MatchState>;
