import assert from "node:assert/strict";
import test from "node:test";

import {
  isConnectionState,
  isMatchPhase,
  normalizeClientMessage,
  normalizePlayerIdentity,
  normalizeRoomMetadata,
  normalizeServerMessage,
  normalizeReadyState,
} from "./multiplayer";

test("normalizes the finite state contracts and rejects unknown states", () => {
  assert.equal(normalizeReadyState(" READY "), "ready");
  assert.equal(normalizeReadyState(false), "not-ready");
  assert.equal(isConnectionState("connected"), true);
  assert.equal(isConnectionState("online"), false);
  assert.equal(isMatchPhase("PLAYING"), true);
  assert.equal(isMatchPhase("starting"), false);
});

test("normalizes player identity while enforcing protocol-safe boundaries", () => {
  assert.deepEqual(normalizePlayerIdentity({ id: " player_1 ", displayName: "  Éowyn  " }), {
    id: "player_1",
    name: "Éowyn",
  });
  assert.equal(normalizePlayerIdentity({ id: "player:1", name: "Wizard" }), null);
  assert.equal(normalizePlayerIdentity({ id: "player-1", name: "   " }), null);
});

test("validates room metadata invariants", () => {
  assert.deepEqual(
    normalizeRoomMetadata({
      roomId: " room-1 ",
      roomName: "  Moon Hall ",
      maxPlayers: 2,
      playerCount: 1,
       matchPhase: "WAITING",
    }),
    {
      id: "room-1",
      name: "Moon Hall",
      maxPlayers: 2,
      playerCount: 1,
       phase: "waiting",
    },
  );
  assert.equal(
    normalizeRoomMetadata({ id: "room-1", name: "Moon Hall", maxPlayers: 2, playerCount: 3, phase: "lobby" }),
    null,
  );
});

test("accepts valid client messages and rejects malformed boundaries", () => {
  assert.deepEqual(
    normalizeClientMessage({
      type: "room:join",
      requestId: " req-1 ",
      roomId: " room-1 ",
      player: { id: " player-1 ", name: "  Merlin " },
    }),
    {
      type: "room:join",
      requestId: "req-1",
      roomId: "room-1",
      player: { id: "player-1", name: "Merlin" },
    },
  );
  assert.equal(normalizeClientMessage({ type: "room:join", roomId: "room-1", player: {} }), null);
  assert.equal(normalizeClientMessage({ type: "unknown", value: true }), null);
});

test("accepts a consistent room state and rejects mismatched player counts", () => {
  const room = { id: "room-1", name: "Moon Hall", maxPlayers: 2, playerCount: 1, phase: "playing" };
  const player = { id: "player-1", name: "Merlin", ready: "ready", connection: "connected" };

  assert.deepEqual(normalizeServerMessage({ type: "room:state", room, players: [player] }), {
    type: "room:state",
    room,
    players: [player],
  });
  assert.equal(normalizeServerMessage({ type: "room:state", room, players: [] }), null);
});
