import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";

import { createGameServer } from "../../server/index";
import {
  DuelClient,
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

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(predicate());
}
