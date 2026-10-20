import { Room, type Client } from "colyseus";

import {
  isLeaveMessage,
  isPingMessage,
  isReadyMessage,
  type DuelMessages,
  type LeaveMessage,
  type PingMessage,
  type ReadyMessage,
} from "../messages";
import { MatchPhase, MatchState, PlayerState } from "../state";

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

export class DuelRoom extends Room<DuelRoomOptions> {
  public maxClients = 2;

  public onCreate(): void {
    this.setState(
      new MatchState({
        roomId: this.roomId,
      }),
    );
    this.metadata = { roomId: this.roomId };

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
    this.refreshPhase();
  }

  public onLeave(client: DuelRoomClient): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) {
      return;
    }

    const wasPlaying = this.state.phase === MatchPhase.Playing;
    this.state.players.delete(client.sessionId);

    if (wasPlaying) {
      this.finishMatch(this.state.players.keys().next().value ?? "");
      return;
    }

    this.refreshPhase();
  }

  public finishMatch(winnerSessionId: string): void {
    if (this.state.phase === MatchPhase.Finished) {
      return;
    }

    this.state.phase = MatchPhase.Finished;
    this.state.winnerSessionId = winnerSessionId;
    void this.lock();
  }

  private handleReady(
    client: DuelRoomClient,
    message: ReadyMessage,
  ): void {
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

  private handlePing(
    client: DuelRoomClient,
    message: PingMessage,
  ): void {
    client.send("pong", {
      nonce: message.nonce ?? "",
      serverTime: Date.now(),
    });
  }

  private handleLeave(
    client: DuelRoomClient,
    message: LeaveMessage,
  ): void {
    const reason = message.reason?.trim().slice(0, 128);
    client.leave(1000, reason || undefined);
  }

  private refreshPhase(): void {
    if (this.state.phase === MatchPhase.Finished) {
      return;
    }

    if (this.state.players.size < this.maxClients) {
      this.state.phase = MatchPhase.Waiting;
      return;
    }

    const allReady = Array.from(this.state.players.values()).every(
      (player) => player.ready,
    );
    this.state.phase = allReady ? MatchPhase.Playing : MatchPhase.Ready;
  }
}

function normalizePlayerMetadata(options: unknown): PlayerMetadata {
  const input = isRecord(options) ? options : {};
  return {
    displayName: normalizeText(input.displayName, "Anonymous Wizard", 32),
    wizardId: normalizeText(input.wizardId, "apprentice", 32),
  };
}

function normalizeText(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim().slice(0, maxLength);
  return normalized || fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
