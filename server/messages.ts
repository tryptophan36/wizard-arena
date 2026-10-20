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

export interface DuelMessages {
  ready: ReadyMessage;
  ping: PingMessage;
  leave: LeaveMessage;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
