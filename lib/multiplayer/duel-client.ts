import { Client, type Room } from "@colyseus/sdk";

import type { PongMessage } from "../../server/messages";
import { MatchState } from "../../server/state";
import type { ConnectionState, MatchPhase } from "../../shared/multiplayer";

export const DUEL_ROOM_NAME = "wizard_duel" as const;
export const DEFAULT_COLYSEUS_URL = "ws://localhost:2567" as const;
export const DEFAULT_PING_TIMEOUT_MS = 5_000;

export type DuelConnectionState = ConnectionState;

export interface DuelJoinOptions {
  displayName?: string;
  wizardId?: string;
}

export interface DuelClientOptions {
  /** Overrides NEXT_PUBLIC_COLYSEUS_URL for this client instance. */
  url?: string;
  /** Allows a test or another adapter to provide a compatible SDK client. */
  client?: Pick<Client, "joinOrCreate" | "joinById">;
  pingTimeoutMs?: number;
}

export interface DuelPlayerSnapshot {
  readonly sessionId: string;
  readonly displayName: string;
  readonly wizardId: string;
  readonly ready: boolean;
  readonly health: number;
  readonly mana: number;
  readonly score: number;
}

/**
 * A plain, read-only view of the Colyseus state at one point in time.
 *
 * `players` remains a Map so callers can use the same session-id lookup as
 * the server state, while the map and each player value are new for every
 * state notification.
 */
export interface DuelStateSnapshot {
  readonly roomId: string;
  readonly phase: MatchPhase;
  readonly players: ReadonlyMap<string, DuelPlayerSnapshot>;
  readonly winnerSessionId: string;
}

export type DuelStateListener = (state: DuelStateSnapshot) => void;
export type DuelConnectionStateListener = (state: DuelConnectionState) => void;
export type DuelErrorListener = (error: DuelClientError) => void;

export type DuelClientOperation =
  | "create room"
  | "join room"
  | "connection"
  | "send ready state"
  | "ping"
  | "leave room"
  | "dispose";

export class DuelClientError extends Error {
  public readonly name = "DuelClientError";
  public readonly operation: DuelClientOperation;
  public readonly cause: unknown;
  public readonly code?: number;

  public constructor(
    operation: DuelClientOperation,
    message: string,
    cause?: unknown,
    code?: number,
  ) {
    super(message);
    this.operation = operation;
    this.cause = cause;
    this.code = code;
  }
}

type DuelRoom = Room<unknown, MatchState>;

type RoomListeners = {
  state: (state: MatchState) => void;
  error: (code: number, message?: string) => void;
  leave: (code: number, reason?: string) => void;
  reconnect: () => void;
  drop: (code: number, reason?: string) => void;
};

/**
 * Framework-independent browser client for the `wizard_duel` room.
 *
 * The class deliberately owns no UI lifecycle. Consumers subscribe to its
 * events and can render the latest `state` snapshot however they choose.
 */
export class DuelClient {
  private readonly sdkClient: Pick<Client, "joinOrCreate" | "joinById">;
  private readonly pingTimeoutMs: number;
  private readonly stateListeners = new Set<DuelStateListener>();
  private readonly connectionListeners = new Set<DuelConnectionStateListener>();
  private readonly errorListeners = new Set<DuelErrorListener>();

  private readonly endpoint: string;
  private room: DuelRoom | null = null;
  private roomListeners: RoomListeners | null = null;
  private liveState: MatchState | null = null;
  private stateSnapshot: DuelStateSnapshot | null = null;
  private _connectionState: DuelConnectionState = "disconnected";
  private _lastError: DuelClientError | null = null;
  private joining = false;
  private disposed = false;

  public constructor(options: DuelClientOptions = {}) {
    this.endpoint = normalizeColyseusUrl(options.url);
    this.pingTimeoutMs = normalizeTimeout(options.pingTimeoutMs);
    this.sdkClient = options.client ?? new Client(this.endpoint);
  }

  /** The normalized endpoint used by the Colyseus SDK. */
  public get url(): string {
    return this.endpoint;
  }

  public get connectionState(): DuelConnectionState {
    return this._connectionState;
  }

  public get roomId(): string | null {
    return this.room?.roomId ?? null;
  }

  public get sessionId(): string | null {
    return this.room?.sessionId ?? null;
  }

  /** The latest immutable state snapshot, or null before joining/after leaving. */
  public get state(): DuelStateSnapshot | null {
    return this.stateSnapshot;
  }

  /** Alias for callers that prefer an explicit name for the snapshot. */
  public get currentRoomState(): DuelStateSnapshot | null {
    return this.stateSnapshot;
  }

  /** Alias for callers that use `roomState` as their state property name. */
  public get roomState(): DuelStateSnapshot | null {
    return this.stateSnapshot;
  }

  /** The live SDK schema state, exposed for advanced Colyseus integrations. */
  public get rawRoomState(): MatchState | null {
    return this.liveState;
  }

  public get lastError(): DuelClientError | null {
    return this._lastError;
  }

  /**
   * Creates a new room. The returned snapshot is also available through
   * `state`; subsequent changes arrive through state subscriptions.
   */
  public createRoom(options: DuelJoinOptions = {}): Promise<DuelStateSnapshot> {
    return this.join("create room", options, () =>
      this.sdkClient.joinOrCreate(DUEL_ROOM_NAME, options, MatchState),
    );
  }

  /** Joins an existing `wizard_duel` room by its Colyseus room ID. */
  public joinRoom(
    roomId: string,
    options: DuelJoinOptions = {},
  ): Promise<DuelStateSnapshot> {
    const normalizedRoomId = roomId.trim();
    if (!normalizedRoomId) {
      const error = this.recordError(
        new DuelClientError("join room", "A room ID is required."),
      );
      return Promise.reject(error);
    }

    return this.join("join room", options, () =>
      this.sdkClient.joinById(normalizedRoomId, options, MatchState),
    );
  }

  /**
   * Convenience connection method: without a room ID it creates a room; with
   * one it joins that room.
   */
  public connect(options?: DuelJoinOptions): Promise<DuelStateSnapshot>;
  public connect(
    roomId: string,
    options?: DuelJoinOptions,
  ): Promise<DuelStateSnapshot>;
  public connect(
    roomIdOrOptions: string | DuelJoinOptions = {},
    options: DuelJoinOptions = {},
  ): Promise<DuelStateSnapshot> {
    return typeof roomIdOrOptions === "string"
      ? this.joinRoom(roomIdOrOptions, options)
      : this.createRoom(roomIdOrOptions);
  }

  /** Subscribe to immutable snapshots emitted by Colyseus state changes. */
  public subscribeState(listener: DuelStateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  /** Alias for subscribeState. */
  public onStateChange(listener: DuelStateListener): () => void {
    return this.subscribeState(listener);
  }

  /** Subscribe to connecting/connected/reconnecting/disconnected changes. */
  public subscribeConnectionState(
    listener: DuelConnectionStateListener,
  ): () => void {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }

  /** Alias for subscribeConnectionState. */
  public onConnectionStateChange(
    listener: DuelConnectionStateListener,
  ): () => void {
    return this.subscribeConnectionState(listener);
  }

  /** Subscribe to errors from matchmaking, the room connection, or commands. */
  public subscribeError(listener: DuelErrorListener): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  /** Alias for subscribeError. */
  public onError(listener: DuelErrorListener): () => void {
    return this.subscribeError(listener);
  }

  public sendReady(ready = true): void {
    this.setReady(ready);
  }

  public sendNotReady(): void {
    this.setReady(false);
  }

  public setReady(ready: boolean): void {
    const room = this.requireRoom("send ready state");
    try {
      room.send("ready", { ready });
    } catch (cause: unknown) {
      throw this.recordError(
        createClientError("send ready state", cause, "Unable to send ready state."),
      );
    }
  }

  /**
   * Sends the room's application-level ping and resolves with the server's
   * typed `pong` payload, including authoritative server time.
   */
  public ping(nonce = createPingNonce()): Promise<PongMessage> {
    const room = this.requireRoom("ping");

    return new Promise<PongMessage>((resolve, reject) => {
      let settled = false;
      let unsubscribe = (): void => undefined;

      const finish = (callback: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        unsubscribe();
        callback();
      };

      const timeout = setTimeout(() => {
        const error = this.recordError(
          new DuelClientError(
            "ping",
            `Timed out waiting for pong after ${this.pingTimeoutMs}ms.`,
          ),
        );
        finish(() => reject(error));
      }, this.pingTimeoutMs);

      try {
        unsubscribe = room.onMessage<PongMessage>("pong", (message) => {
          if (message?.nonce !== nonce) return;
          finish(() => resolve(message));
        });
        room.send("ping", { nonce });
      } catch (cause: unknown) {
        const error = this.recordError(
          createClientError("ping", cause, "Unable to send ping."),
        );
        finish(() => reject(error));
      }
    });
  }

  /** Sends the normal Colyseus leave signal, or the server's optional reason. */
  public async leave(reason?: string): Promise<void> {
    const room = this.requireRoom("leave room");
    const left = this.waitForLeave(room);

    try {
      if (reason === undefined) {
        await room.leave(true);
      } else {
        room.send("leave", { reason });
      }
      await left;
    } catch (cause: unknown) {
      throw this.recordError(
        createClientError("leave room", cause, "Unable to leave room."),
      );
    }
  }

  /** Leaves without waiting on a server response and removes all subscribers. */
  public async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;

    const room = this.room;
    if (room) {
      try {
        await room.leave(false);
      } catch (cause: unknown) {
        this.recordError(
          createClientError("dispose", cause, "Unable to dispose room connection."),
        );
      } finally {
        this.clearRoom(room);
      }
    }

    this.stateListeners.clear();
    this.connectionListeners.clear();
    this.errorListeners.clear();
  }

  private join(
    operation: "create room" | "join room",
    options: DuelJoinOptions,
    request: () => Promise<DuelRoom>,
  ): Promise<DuelStateSnapshot> {
    if (this.disposed) {
      return Promise.reject(
        this.recordError(
          new DuelClientError(operation, "This DuelClient has been disposed."),
        ),
      );
    }

    if (this.room || this.joining) {
      return Promise.reject(
        this.recordError(
          new DuelClientError(operation, "This DuelClient is already in a room."),
        ),
      );
    }

    this.joining = true;
    this._lastError = null;
    this.liveState = null;
    this.stateSnapshot = null;
    this.setConnectionState("connecting");

    return Promise.resolve()
      .then(request)
      .then(async (room) => {
        if (this.disposed) {
          void room.leave(false);
          throw new DuelClientError(operation, "This DuelClient has been disposed.");
        }

        this.attachRoom(room);
        this.setConnectionState("connected");
        if (hasJoinedState(room)) {
          this.updateState(room.state);
        } else {
          this.liveState = room.state;
          this.stateSnapshot = snapshotState(room.state);
        }
        await this.waitForInitialState(room);

        if (!this.stateSnapshot) {
          throw new Error("Colyseus joined without a room state.");
        }
        return this.stateSnapshot;
      })
      .catch((cause: unknown) => {
        if (cause instanceof DuelClientError && cause.operation === operation) {
          if (cause !== this._lastError) this.recordError(cause);
          this.setConnectionState("disconnected");
          throw cause;
        }

        const error = this.recordError(
          createClientError(operation, cause, `Unable to ${operation}.`),
        );
        this.setConnectionState("disconnected");
        throw error;
      })
      .finally(() => {
        this.joining = false;
      });
  }

  private attachRoom(room: DuelRoom): void {
    const state = (nextState: MatchState): void => {
      if (this.room !== room) return;
      this.updateState(nextState);
    };
    const error = (code: number, message?: string): void => {
      if (this.room !== room) return;
      this.recordError(
        new DuelClientError(
          "connection",
          message ?? `Colyseus connection error (${code}).`,
          undefined,
          code,
        ),
      );
    };
    const leave = (): void => {
      if (this.room !== room) return;
      this.clearRoom(room);
    };
    const reconnect = (): void => {
      if (this.room === room) this.setConnectionState("connected");
    };
    const drop = (): void => {
      if (this.room === room) this.setConnectionState("reconnecting");
    };

    this.room = room;
    this.roomListeners = { state, error, leave, reconnect, drop };
    room.onStateChange(state);
    room.onError(error);
    room.onLeave(leave);
    room.onReconnect(reconnect);
    room.onDrop(drop);
  }

  private waitForLeave(room: DuelRoom): Promise<void> {
    return new Promise<void>((resolve) => {
      const onLeave = (): void => {
        room.onLeave.remove(onLeave);
        resolve();
      };
      room.onLeave(onLeave);
    });
  }

  private waitForInitialState(room: DuelRoom): Promise<void> {
    if (hasJoinedState(room)) return Promise.resolve();

    return new Promise<void>((resolve) => {
      const onState = (state: MatchState): void => {
        if (this.room !== room || state.roomId === room.roomId) {
          room.onStateChange.remove(onState);
          resolve();
        }
      };
      room.onStateChange(onState);
    });
  }

  private clearRoom(room: DuelRoom): void {
    if (this.room !== room) return;

    const listeners = this.roomListeners;
    if (listeners) {
      room.onStateChange.remove(listeners.state);
      room.onError.remove(listeners.error);
      room.onLeave.remove(listeners.leave);
      room.onReconnect.remove(listeners.reconnect);
      room.onDrop.remove(listeners.drop);
    }

    this.room = null;
    this.roomListeners = null;
    this.liveState = null;
    this.stateSnapshot = null;
    this.setConnectionState("disconnected");
  }

  private updateState(state: MatchState): void {
    this.liveState = state;
    this.stateSnapshot = snapshotState(state);
    for (const listener of this.stateListeners) {
      listener(this.stateSnapshot);
    }
  }

  private requireRoom(operation: DuelClientOperation): DuelRoom {
    if (this.room) return this.room;

    throw this.recordError(
      new DuelClientError(operation, "The client is not connected to a room."),
    );
  }

  private setConnectionState(state: DuelConnectionState): void {
    if (state === this._connectionState) return;
    this._connectionState = state;
    for (const listener of this.connectionListeners) {
      listener(state);
    }
  }

  private recordError(error: DuelClientError): DuelClientError {
    this._lastError = error;
    for (const listener of this.errorListeners) {
      listener(error);
    }
    return error;
  }
}

export function normalizeColyseusUrl(value?: string): string {
  const configured = value ?? readPublicColyseusUrl();
  const input = configured?.trim() || DEFAULT_COLYSEUS_URL;
  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//iu.test(input)
    ? input
    : `ws://${input}`;

  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch (cause: unknown) {
    throw new TypeError(`Invalid Colyseus URL: ${input}`, { cause });
  }

  if (url.protocol === "http:") url.protocol = "ws:";
  if (url.protocol === "https:") url.protocol = "wss:";
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new TypeError(
      `Colyseus URL must use ws://, wss://, http://, or https://: ${input}`,
    );
  }

  url.hash = "";
  const path = url.pathname.replace(/\/+$/u, "");
  return `${url.origin}${path}${url.search}`;
}

function snapshotState(state: MatchState): DuelStateSnapshot {
  const players = new Map<string, DuelPlayerSnapshot>();
  for (const [sessionId, player] of state.players.entries()) {
    players.set(
      sessionId,
      Object.freeze({
        sessionId: player.sessionId,
        displayName: player.displayName,
        wizardId: player.wizardId,
        ready: player.ready,
        health: player.health,
        mana: player.mana,
        score: player.score,
      }),
    );
  }

  return Object.freeze({
    roomId: state.roomId,
    phase: state.phase as MatchPhase,
    players,
    winnerSessionId: state.winnerSessionId,
  });
}

function hasJoinedState(room: DuelRoom): boolean {
  return room.state.roomId === room.roomId || room.state.players.size > 0;
}

function createClientError(
  operation: DuelClientOperation,
  cause: unknown,
  fallbackMessage: string,
): DuelClientError {
  const message = cause instanceof Error ? cause.message : fallbackMessage;
  return new DuelClientError(operation, message, cause, readErrorCode(cause));
}

function readErrorCode(cause: unknown): number | undefined {
  if (typeof cause !== "object" || cause === null || !("code" in cause)) {
    return undefined;
  }

  const code = cause.code;
  return typeof code === "number" ? code : undefined;
}

function normalizeTimeout(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_PING_TIMEOUT_MS;
}

function createPingNonce(): string {
  return `ping-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readPublicColyseusUrl(): string | undefined {
  if (typeof process === "undefined") return undefined;
  return process.env.NEXT_PUBLIC_COLYSEUS_URL;
}
