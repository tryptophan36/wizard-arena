import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";

import { createGameServer } from "../../server/index";
import {
  DuelClient,
  type DuelRealtimeEvent,
  normalizeColyseusUrl,
} from "./duel-client";

let gameServer: ReturnType<typeof createGameServer>;
let endpoint: string;

before(async () => {
  gameServer = createGameServer();
  await gameServer.listen(0);

  const address = gameServer.transport.server?.address();
  assert.ok(address && typeof address !== "string");
  endpoint = `ws://127.0.0.1:${(address as AddressInfo).port}`;
});

after(async () => {
  await gameServer.gracefullyShutdown(false);
});

test("normalizes Colyseus endpoints without browser APIs", () => {
  assert.equal(
    normalizeColyseusUrl("http://example.test:2567/colyseus/"),
    "ws://example.test:2567/colyseus",
  );
  assert.equal(
    normalizeColyseusUrl("https://example.test:443/colyseus/?token=one#ignored"),
    "wss://example.test/colyseus?token=one",
  );
  assert.equal(
    normalizeColyseusUrl("example.test:2567"),
    "ws://example.test:2567",
  );
  assert.throws(
    () => normalizeColyseusUrl("ftp://example.test:2567"),
    /must use ws:\/\/, wss:\/\/, http:\/\/, or https:\/\//,
  );
});

test("creates, joins, observes, pings, and leaves a duel room", async () => {
  const host = new DuelClient({ url: endpoint });
  const guest = new DuelClient({ url: endpoint });
  const connectionStates: string[] = [];
  const statePhases: string[] = [];
  const errors: Error[] = [];

  host.subscribeConnectionState((state) => connectionStates.push(state));
  host.subscribeState((state) => statePhases.push(state.phase));
  host.subscribeError((error) => errors.push(error));

  await host.createRoom({ displayName: "Host", wizardId: "ember" });
  assert.equal(host.connectionState, "connected");
  assert.ok(host.roomId);
  assert.ok(host.sessionId);
  await waitFor(() => host.state?.players.size === 1);

  await guest.joinRoom(host.roomId as string, {
    displayName: "Guest",
    wizardId: "frost",
  });

  await waitFor(() => host.state?.players.size === 2);
  host.sendReady();
  guest.sendReady();
  await waitFor(() => host.state?.phase === "playing");

  const pong = await host.ping("adapter-test");
  assert.equal(pong.nonce, "adapter-test");
  assert.equal(typeof pong.serverTime, "number");

  await guest.leave("adapter test complete");
  await waitFor(() => host.state?.phase === "finished");
  assert.equal(host.state?.winnerSessionId, host.sessionId);
  assert.deepEqual(errors, []);
  assert.deepEqual(connectionStates.slice(0, 2), ["connecting", "connected"]);
  assert.ok(statePhases.includes("waiting"));

  await host.dispose();
  await guest.dispose();
  assert.equal(host.connectionState, "disconnected");
  assert.equal(host.roomId, null);
  assert.equal(host.sessionId, null);
});

test("sends drawing commands and exposes typed realtime duel events", async () => {
  const host = new DuelClient({ url: endpoint });
  const guest = new DuelClient({ url: endpoint });
  const guestEvents: DuelRealtimeEvent[] = [];
  const hostEvents: DuelRealtimeEvent[] = [];
  host.subscribeRealtimeEvent((event) => hostEvents.push(event));
  guest.subscribeRealtimeEvent((event) => guestEvents.push(event));

  await host.createRoom({ displayName: "Caster", wizardId: "ember" });
  await guest.joinRoom(host.roomId as string, { displayName: "Target", wizardId: "frost" });
  host.sendReady();
  guest.sendReady();
  await waitFor(() => host.state?.phase === "playing");

  const points = [
    { x: 500, y: 100, timestamp: 1 },
    { x: 500, y: 250, timestamp: 2 },
    { x: 500, y: 400, timestamp: 3 },
    { x: 500, y: 550, timestamp: 4 },
    { x: 500, y: 700, timestamp: 5 },
    { x: 550, y: 650, timestamp: 6 },
    { x: 600, y: 600, timestamp: 7 },
  ];
  host.sendDrawingStart({ strokeId: "adapter-rune", point: points[0] });
  host.sendDrawingPoints({ strokeId: "adapter-rune", points: points.slice(1) });
  host.sendDrawingEnd({ strokeId: "adapter-rune", endedAt: 8 });
  await waitFor(() => guestEvents.some((event) => event.type === "draw:remote-end"));
  await waitFor(() => host.state?.completedStrokes.size === 1);
  assert.equal(host.state?.completedStrokes.size, 1);

  host.requestSpellMatch();
  await waitFor(() => hostEvents.some((event) => event.type === "spell:accepted"));
  await waitFor(() => guestEvents.some((event) => event.type === "spell:impact"));
  assert.equal(host.state?.players.get(host.sessionId as string)?.mana, 80);

  await guest.dispose();
  await host.dispose();
});

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(predicate());
}
