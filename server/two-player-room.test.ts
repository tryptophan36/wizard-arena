import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";

import { Client as ColyseusClient } from "@colyseus/sdk";

import {
  createGameServer,
  ROOM_NAME,
} from "./index";
import { MatchPhase, MatchState } from "./state";

const TEST_TIMEOUT_MS = 2_000;

let gameServer: ReturnType<typeof createGameServer>;
let client: ColyseusClient;

before(async () => {
  gameServer = createGameServer();
  await gameServer.listen(0);

  const address = gameServer.transport.server?.address();
  assert.ok(address && typeof address !== "string");
  client = new ColyseusClient(`ws://127.0.0.1:${(address as AddressInfo).port}`);
});

after(async () => {
  await gameServer.gracefullyShutdown(false);
});

test("creates a room, joins it by room id, and advances its lifecycle", async () => {
  const host = await client.joinOrCreate(
    ROOM_NAME,
    { displayName: "Host", wizardId: "ember" },
    MatchState,
  );
  assert.match(host.roomId, /^[a-zA-Z0-9_-]+$/);
  await waitForState(host, (state) => state.players.size === 1);
  await waitForPhase(host, MatchPhase.Waiting);
  assert.equal(host.state.roomId, host.roomId);
  assert.equal(host.state.players.size, 1);
  assert.equal(host.state.players.get(host.sessionId)?.displayName, "Host");

  const guest = await client.joinById(
    host.roomId,
    { displayName: "Guest", wizardId: "frost" },
    MatchState,
  );
  assert.equal(guest.roomId, host.roomId);
  await waitForState(
    host,
    (state) => state.phase === MatchPhase.Ready && state.players.size === 2,
  );
  assert.equal(host.state.players.size, 2);

  host.send("ready", { ready: true });
  await waitForPhase(host, MatchPhase.Ready);
  guest.send("ready", { ready: true });
  await waitForPhase(host, MatchPhase.Playing);
  await waitForPhase(guest, MatchPhase.Playing);

  host.onMessage("match:ended", () => undefined);
  guest.send("leave", { reason: "done" });
  await waitForPhase(host, MatchPhase.Finished);
  assert.equal(host.state.winnerSessionId, host.sessionId);
  await host.leave(true);
});

test("responds to a typed ping message", async () => {
  const room = await client.joinOrCreate(
    ROOM_NAME,
    { displayName: "Pinger", wizardId: "lightning" },
    MatchState,
  );

  const pong = new Promise<{ nonce: string; serverTime: number }>(
    (resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Timed out waiting for pong")),
        TEST_TIMEOUT_MS,
      );
      room.onMessage("pong", (message) => {
        clearTimeout(timeout);
        resolve(message);
      });
    },
  );

  room.send("ping", { nonce: "test-nonce" });
  const response = await pong;
  assert.equal(response.nonce, "test-nonce");
  assert.equal(typeof response.serverTime, "number");
  await room.leave(true);
});

test("relays drawing preview, matches a server-owned rune, and applies authoritative impact", async () => {
  const host = await client.joinOrCreate(
    ROOM_NAME,
    { displayName: "Caster", wizardId: "ember" },
    MatchState,
  );
  const guest = await client.joinById(
    host.roomId,
    { displayName: "Target", wizardId: "frost" },
    MatchState,
  );
  host.send("ready", { ready: true });
  guest.send("ready", { ready: true });
  await waitForPhase(host, MatchPhase.Playing);

  host.onMessage("spell:phase", () => undefined);
  guest.onMessage("spell:phase", () => undefined);
  guest.onMessage("spell:accepted", () => undefined);
  host.onMessage("spell:impact", () => undefined);
  host.onMessage("match:ended", () => undefined);
  guest.onMessage("match:ended", () => undefined);
  const preview = waitForMessage<{ sessionId: string; strokeId: string; points: Array<{ x: number; y: number }> }>(guest, "draw:remote-preview");
  const remoteEnd = waitForMessage<{ sessionId: string; strokeId: string }>(guest, "draw:remote-end");
  const remoteClear = waitForMessage<{ sessionId: string; reason?: string }>(guest, "draw:remote-clear");
  const accepted = waitForMessage<{ spellId: string; phase: string; mana: number }>(host, "spell:accepted");
  const impact = waitForMessage<{ spellId: string; damage: number; health: number; blocked: boolean }>(guest, "spell:impact");

  const points = [
    { x: 500, y: 100, timestamp: 1 },
    { x: 500, y: 250, timestamp: 2 },
    { x: 500, y: 400, timestamp: 3 },
    { x: 500, y: 550, timestamp: 4 },
    { x: 500, y: 700, timestamp: 5 },
    { x: 550, y: 650, timestamp: 6 },
    { x: 600, y: 600, timestamp: 7 },
  ];
  host.send("draw:start", { strokeId: "ember-1", point: points[0] });
  host.send("draw:points", { strokeId: "ember-1", points: points.slice(1) });
  host.send("draw:end", { strokeId: "ember-1", endedAt: 8 });

  const previewMessage = await preview;
  assert.equal(previewMessage.sessionId, host.sessionId);
  assert.equal(previewMessage.points[0]?.x, 500);
  const endMessage = await remoteEnd;
  assert.equal(endMessage.strokeId, "ember-1");
  await waitForState(host, (state) => state.completedStrokes.size === 1);

  host.send("spell:match", {});
  const acceptedMessage = await accepted;
  assert.equal(acceptedMessage.spellId, "ember-lance");
  assert.equal(acceptedMessage.phase, "charging");
  assert.equal(acceptedMessage.mana, 80);
  await waitForState(host, (state) => state.players.get(host.sessionId)?.mana === 80);

  const impactMessage = await impact;
  assert.equal(impactMessage.spellId, "ember-lance");
  assert.equal(impactMessage.damage, 20);
  assert.equal(impactMessage.health, 80);
  assert.equal(impactMessage.blocked, false);
  await waitForState(guest, (state) => state.players.get(guest.sessionId)?.health === 80);
  const clearMessage = await remoteClear;
  assert.equal(clearMessage.sessionId, host.sessionId);
  assert.equal(clearMessage.reason, "matched");

  await guest.leave(true);
  await host.leave(true);
});

test("normalizes small shape-tool input on the server for final rune recognition", async () => {
  const host = await client.joinOrCreate(
    ROOM_NAME,
    { displayName: "Shape Caster", wizardId: "ember" },
    MatchState,
  );
  const guest = await client.joinById(
    host.roomId,
    { displayName: "Shape Target", wizardId: "frost" },
    MatchState,
  );
  host.send("ready", { ready: true });
  guest.send("ready", { ready: true });
  await waitForPhase(host, MatchPhase.Playing);

  const accepted = waitForMessage<{ spellId: string; phase: string }>(host, "spell:accepted");
  const remoteEnd = waitForMessage<{ stroke: { points: Array<{ x: number; y: number }> } }>(guest, "draw:remote-end");
  host.send("draw:start", { strokeId: "shape-aegis", point: { x: 120, y: 120, timestamp: 1 } });
  host.send("draw:points", {
    strokeId: "shape-aegis",
    points: [
      { x: 120.25, y: 120, timestamp: 2 },
      { x: 120.25, y: 120.25, timestamp: 3 },
      { x: 120, y: 120.25, timestamp: 4 },
      { x: 120, y: 120, timestamp: 5 },
    ],
  });
  host.send("draw:end", {
    strokeId: "shape-aegis",
    drawingTool: "square",
    endedAt: 5,
  });

  const remoteEndMessage = await remoteEnd;
  assert.equal(remoteEndMessage.stroke.points.length, 5);
  assert.equal(remoteEndMessage.stroke.points[1]?.x, 120.25);

  host.send("spell:match", {});
  const acceptedMessage = await accepted;
  assert.equal(acceptedMessage.spellId, "aegis");
  assert.equal(acceptedMessage.phase, "impact");
  await waitForState(host, (state) => state.players.get(host.sessionId)?.shield === true);

  await guest.leave(true);
  await host.leave(true);
});

test("rejects a spell outside the playing phase and caps invalid drawing packets", async () => {
  const host = await client.joinOrCreate(
    ROOM_NAME,
    { displayName: "Host", wizardId: "ember" },
    MatchState,
  );
  const rejected = waitForMessage<{ reason: string }>(host, "spell:rejected");
  host.send("spell:match", { spellId: "ember-lance" });
  assert.equal((await rejected).reason, "not-in-match");

  const guest = await client.joinById(
    host.roomId,
    { displayName: "Guest", wizardId: "frost" },
    MatchState,
  );
  host.send("ready", { ready: true });
  guest.send("ready", { ready: true });
  await waitForPhase(host, MatchPhase.Playing);

  guest.onMessage("draw:remote-clear", () => undefined);
  host.onMessage("match:ended", () => undefined);
  const initialStrokeCount = host.state.completedStrokes.size;
  host.send("draw:start", { strokeId: "bad", point: { x: -1, y: 0 } });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(host.state.completedStrokes.size, initialStrokeCount);
  assert.equal(host.state.players.get(host.sessionId)?.mana, 100);

  await guest.leave(true);
  await host.leave(true);
});

async function waitForPhase(
  room: { state: MatchState },
  expected: MatchPhase,
): Promise<void> {
  await waitForState(room, (state) => state.phase === expected);
}

async function waitForState(
  room: { state: MatchState },
  predicate: (state: MatchState) => boolean,
): Promise<void> {
  const deadline = Date.now() + TEST_TIMEOUT_MS;
  while (!predicate(room.state) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  assert.ok(predicate(room.state));
}

async function waitForMessage<T>(
  room: { onMessage: (type: string, callback: (message: T) => void) => () => void },
  type: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for ${type}`));
    }, TEST_TIMEOUT_MS);
    const unsubscribe = room.onMessage(type, (message) => {
      clearTimeout(timeout);
      unsubscribe();
      resolve(message);
    });
  });
}
