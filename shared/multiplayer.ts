/**
 * The wire-level contracts shared by the browser client and multiplayer
 * backend. Keep this module free of framework and runtime-specific imports so
 * it can be used by either side of the connection.
 */

export const PROTOCOL_VERSION = 1 as const;

export const ROOM_ID_MAX_LENGTH = 64;
export const ROOM_NAME_MAX_LENGTH = 40;
export const PLAYER_ID_MAX_LENGTH = 64;
export const PLAYER_NAME_MAX_LENGTH = 24;
export const REQUEST_ID_MAX_LENGTH = 64;
export const MIN_ROOM_CAPACITY = 2;
export const MAX_ROOM_CAPACITY = 8;
export const MAX_ERROR_MESSAGE_LENGTH = 240;

export const READY_STATES = ["not-ready", "ready"] as const;
export type ReadyState = (typeof READY_STATES)[number];

export const CONNECTION_STATES = ["connecting", "connected", "reconnecting", "disconnected"] as const;
export type ConnectionState = (typeof CONNECTION_STATES)[number];

/**
 * The backend currently exposes these phases through Colyseus state. Keep the
 * shared contract aligned with the server so future clients do not need to
 * translate between two competing lifecycle vocabularies.
 */
export const MATCH_PHASES = ["waiting", "ready", "playing", "finished"] as const;
export type MatchPhase = (typeof MATCH_PHASES)[number];

export const ROOM_ERROR_CODES = [
  "invalid-message",
  "room-not-found",
  "room-full",
  "name-taken",
  "match-started",
  "not-in-room",
  "server-error",
] as const;
export type RoomErrorCode = (typeof ROOM_ERROR_CODES)[number];

export type PlayerIdentity = {
  id: string;
  name: string;
};

export type PlayerState = PlayerIdentity & {
  ready: ReadyState;
  connection: ConnectionState;
};

export type RoomMetadata = {
  id: string;
  name: string;
  maxPlayers: number;
  playerCount: number;
  phase: MatchPhase;
};

export type RoomState = {
  room: RoomMetadata;
  players: PlayerState[];
};

export type ClientMessage =
  | {
      type: "room:create";
      requestId?: string;
      roomName: string;
      player: PlayerIdentity;
    }
  | {
      type: "room:join";
      requestId?: string;
      roomId: string;
      player: PlayerIdentity;
    }
  | {
      type: "room:leave";
      requestId?: string;
      roomId: string;
    }
  | {
      type: "player:ready";
      requestId?: string;
      ready: ReadyState;
    };

export type ServerMessage =
  | {
      type: "room:state";
      room: RoomMetadata;
      players: PlayerState[];
    }
  | {
      type: "room:error";
      requestId?: string;
      code: RoomErrorCode;
      message: string;
    }
  | {
      type: "match:phase";
      roomId: string;
      phase: MatchPhase;
    };

export type ProtocolMessage = ClientMessage | ServerMessage;

export type ValidationResult<T> =
  | {
      valid: true;
      value: T;
      errors: readonly [];
    }
  | {
      valid: false;
      errors: readonly string[];
    };

const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readFirst(record: UnknownRecord, ...keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  return undefined;
}

function normalizeIdentifier(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;

  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxLength || !SAFE_IDENTIFIER_PATTERN.test(normalized)) {
    return null;
  }

  return normalized;
}

function normalizeName(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;

  const normalized = value.normalize("NFC").trim().replace(/\s+/gu, " ");
  if (normalized.length === 0 || Array.from(normalized).length > maxLength || CONTROL_CHARACTER_PATTERN.test(normalized)) {
    return null;
  }

  return normalized;
}

function normalizeInteger(value: unknown, minimum: number, maximum: number): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    return null;
  }

  return value;
}

function normalizeChoice<T extends string>(value: unknown, choices: readonly T[]): T | null {
  if (typeof value !== "string") return null;

  const normalized = value.trim().toLowerCase().replace(/[\s_]+/gu, "-");
  return choices.includes(normalized as T) ? (normalized as T) : null;
}

function success<T>(value: T): ValidationResult<T> {
  return { valid: true, value, errors: [] };
}

function failure<T = never>(...errors: string[]): ValidationResult<T> {
  return { valid: false, errors };
}

export function normalizeReadyState(value: unknown): ReadyState | null {
  if (typeof value === "boolean") return value ? "ready" : "not-ready";
  return normalizeChoice(value, READY_STATES);
}

export function isReadyState(value: unknown): value is ReadyState {
  return normalizeReadyState(value) !== null;
}

export function validateReadyState(value: unknown): ValidationResult<ReadyState> {
  const normalized = normalizeReadyState(value);
  return normalized === null ? failure("ready state must be 'ready' or 'not-ready'") : success(normalized);
}

export function normalizeConnectionState(value: unknown): ConnectionState | null {
  return normalizeChoice(value, CONNECTION_STATES);
}

export function isConnectionState(value: unknown): value is ConnectionState {
  return normalizeConnectionState(value) !== null;
}

export function validateConnectionState(value: unknown): ValidationResult<ConnectionState> {
  const normalized = normalizeConnectionState(value);
  return normalized === null
    ? failure("connection state must be connecting, connected, reconnecting, or disconnected")
    : success(normalized);
}

export function normalizeMatchPhase(value: unknown): MatchPhase | null {
  return normalizeChoice(value, MATCH_PHASES);
}

export function isMatchPhase(value: unknown): value is MatchPhase {
  return normalizeMatchPhase(value) !== null;
}

export function validateMatchPhase(value: unknown): ValidationResult<MatchPhase> {
  const normalized = normalizeMatchPhase(value);
  return normalized === null
    ? failure("match phase must be waiting, ready, playing, or finished")
    : success(normalized);
}

function parsePlayerIdentity(value: unknown): ValidationResult<PlayerIdentity> {
  if (!isRecord(value)) return failure("player identity must be an object");

  const id = normalizeIdentifier(readFirst(value, "id", "playerId"), PLAYER_ID_MAX_LENGTH);
  const name = normalizeName(readFirst(value, "name", "displayName"), PLAYER_NAME_MAX_LENGTH);
  const errors: string[] = [];

  if (id === null) errors.push("player identity id must be a non-empty safe identifier");
  if (name === null) errors.push(`player identity name must be 1-${PLAYER_NAME_MAX_LENGTH} characters`);
  if (errors.length > 0) return failure(...errors);

  return success({ id: id as string, name: name as string });
}

export function normalizePlayerIdentity(value: unknown): PlayerIdentity | null {
  const result = parsePlayerIdentity(value);
  return result.valid ? result.value : null;
}

export function isPlayerIdentity(value: unknown): value is PlayerIdentity {
  return normalizePlayerIdentity(value) !== null;
}

export function validatePlayerIdentity(value: unknown): ValidationResult<PlayerIdentity> {
  return parsePlayerIdentity(value);
}

function parsePlayerState(value: unknown): ValidationResult<PlayerState> {
  if (!isRecord(value)) return failure("player state must be an object");

  const identity = parsePlayerIdentity(value);
  const ready = normalizeReadyState(readFirst(value, "ready", "readyState"));
  const connection = normalizeConnectionState(readFirst(value, "connection", "connectionState"));
  const errors = [...(identity.valid ? [] : identity.errors)];

  if (ready === null) errors.push("player state ready must be 'ready' or 'not-ready'");
  if (connection === null) {
    errors.push("player state connection must be connecting, connected, reconnecting, or disconnected");
  }
  if (errors.length > 0) return failure(...errors);

  return success({
    ...(identity.valid ? identity.value : { id: "", name: "" }),
    ready: ready as ReadyState,
    connection: connection as ConnectionState,
  });
}

export function normalizePlayerState(value: unknown): PlayerState | null {
  const result = parsePlayerState(value);
  return result.valid ? result.value : null;
}

export function isPlayerState(value: unknown): value is PlayerState {
  return normalizePlayerState(value) !== null;
}

export function validatePlayerState(value: unknown): ValidationResult<PlayerState> {
  return parsePlayerState(value);
}

function parseRoomMetadata(value: unknown): ValidationResult<RoomMetadata> {
  if (!isRecord(value)) return failure("room metadata must be an object");

  const id = normalizeIdentifier(readFirst(value, "id", "roomId"), ROOM_ID_MAX_LENGTH);
  const name = normalizeName(readFirst(value, "name", "roomName"), ROOM_NAME_MAX_LENGTH);
  const maxPlayers = normalizeInteger(readFirst(value, "maxPlayers", "capacity"), MIN_ROOM_CAPACITY, MAX_ROOM_CAPACITY);
  const playerCount = normalizeInteger(readFirst(value, "playerCount", "players"), 0, MAX_ROOM_CAPACITY);
  const phase = normalizeMatchPhase(readFirst(value, "phase", "matchPhase"));
  const errors: string[] = [];

  if (id === null) errors.push("room metadata id must be a non-empty safe identifier");
  if (name === null) errors.push(`room metadata name must be 1-${ROOM_NAME_MAX_LENGTH} characters`);
  if (maxPlayers === null) errors.push(`room metadata maxPlayers must be an integer from ${MIN_ROOM_CAPACITY} to ${MAX_ROOM_CAPACITY}`);
  if (playerCount === null) errors.push("room metadata playerCount must be a non-negative integer");
  if (phase === null) errors.push("room metadata phase is invalid");
  if (maxPlayers !== null && playerCount !== null && playerCount > maxPlayers) {
    errors.push("room metadata playerCount cannot exceed maxPlayers");
  }
  if (errors.length > 0) return failure(...errors);

  return success({
    id: id as string,
    name: name as string,
    maxPlayers: maxPlayers as number,
    playerCount: playerCount as number,
    phase: phase as MatchPhase,
  });
}

export function normalizeRoomMetadata(value: unknown): RoomMetadata | null {
  const result = parseRoomMetadata(value);
  return result.valid ? result.value : null;
}

export function isRoomMetadata(value: unknown): value is RoomMetadata {
  return normalizeRoomMetadata(value) !== null;
}

export function validateRoomMetadata(value: unknown): ValidationResult<RoomMetadata> {
  return parseRoomMetadata(value);
}

function normalizeOptionalRequestId(record: UnknownRecord): string | undefined | null {
  if (!("requestId" in record) || record.requestId === undefined) return undefined;
  return normalizeIdentifier(record.requestId, REQUEST_ID_MAX_LENGTH);
}

function parseClientMessage(value: unknown): ValidationResult<ClientMessage> {
  if (!isRecord(value) || typeof value.type !== "string") return failure("client message must have a type");

  const requestId = normalizeOptionalRequestId(value);
  if (requestId === null) return failure("client message requestId is invalid");

  switch (value.type) {
    case "room:create": {
      const roomName = normalizeName(readFirst(value, "roomName", "name"), ROOM_NAME_MAX_LENGTH);
      const player = normalizePlayerIdentity(value.player);
      if (roomName === null) return failure("room:create roomName is invalid");
      if (player === null) return failure("room:create player is invalid");
      return success({ type: "room:create", ...(requestId === undefined ? {} : { requestId }), roomName, player });
    }
    case "room:join": {
      const roomId = normalizeIdentifier(readFirst(value, "roomId", "id"), ROOM_ID_MAX_LENGTH);
      const player = normalizePlayerIdentity(value.player);
      if (roomId === null) return failure("room:join roomId is invalid");
      if (player === null) return failure("room:join player is invalid");
      return success({ type: "room:join", ...(requestId === undefined ? {} : { requestId }), roomId, player });
    }
    case "room:leave": {
      const roomId = normalizeIdentifier(readFirst(value, "roomId", "id"), ROOM_ID_MAX_LENGTH);
      if (roomId === null) return failure("room:leave roomId is invalid");
      return success({ type: "room:leave", ...(requestId === undefined ? {} : { requestId }), roomId });
    }
    case "player:ready": {
      const ready = normalizeReadyState(readFirst(value, "ready", "readyState"));
      if (ready === null) return failure("player:ready ready is invalid");
      return success({ type: "player:ready", ...(requestId === undefined ? {} : { requestId }), ready });
    }
    default:
      return failure(`unknown client message type: ${value.type}`);
  }
}

export function normalizeClientMessage(value: unknown): ClientMessage | null {
  const result = parseClientMessage(value);
  return result.valid ? result.value : null;
}

export function isClientMessage(value: unknown): value is ClientMessage {
  return normalizeClientMessage(value) !== null;
}

export function validateClientMessage(value: unknown): ValidationResult<ClientMessage> {
  return parseClientMessage(value);
}

function parseServerMessage(value: unknown): ValidationResult<ServerMessage> {
  if (!isRecord(value) || typeof value.type !== "string") return failure("server message must have a type");

  const requestId = normalizeOptionalRequestId(value);
  if (requestId === null) return failure("server message requestId is invalid");

  switch (value.type) {
    case "room:state": {
      const room = normalizeRoomMetadata(value.room);
      if (room === null) return failure("room:state room is invalid");
      if (!Array.isArray(value.players)) return failure("room:state players must be an array");

      const players: PlayerState[] = [];
      for (const playerValue of value.players) {
        const player = normalizePlayerState(playerValue);
        if (player === null) return failure("room:state contains an invalid player");
        players.push(player);
      }
      if (players.length !== room.playerCount) return failure("room:state player count does not match room metadata");

      return success({ type: "room:state", room, players });
    }
    case "room:error": {
      const code = normalizeChoice(value.code, ROOM_ERROR_CODES);
      const message = normalizeName(value.message, MAX_ERROR_MESSAGE_LENGTH);
      if (code === null) return failure("room:error code is invalid");
      if (message === null) return failure("room:error message is invalid");
      return success({ type: "room:error", ...(requestId === undefined ? {} : { requestId }), code, message });
    }
    case "match:phase": {
      const roomId = normalizeIdentifier(readFirst(value, "roomId", "id"), ROOM_ID_MAX_LENGTH);
      const phase = normalizeMatchPhase(value.phase);
      if (roomId === null) return failure("match:phase roomId is invalid");
      if (phase === null) return failure("match:phase phase is invalid");
      return success({ type: "match:phase", roomId, phase });
    }
    default:
      return failure(`unknown server message type: ${value.type}`);
  }
}

export function normalizeServerMessage(value: unknown): ServerMessage | null {
  const result = parseServerMessage(value);
  return result.valid ? result.value : null;
}

export function isServerMessage(value: unknown): value is ServerMessage {
  return normalizeServerMessage(value) !== null;
}

export function validateServerMessage(value: unknown): ValidationResult<ServerMessage> {
  return parseServerMessage(value);
}

export function normalizeProtocolMessage(value: unknown): ProtocolMessage | null {
  return normalizeClientMessage(value) ?? normalizeServerMessage(value);
}

export function isProtocolMessage(value: unknown): value is ProtocolMessage {
  return normalizeProtocolMessage(value) !== null;
}
