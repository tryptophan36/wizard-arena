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
