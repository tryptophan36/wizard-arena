import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";

import { DuelRoom } from "./rooms/duel-room";

export const ROOM_NAME = "wizard_duel";
export const DEFAULT_PORT = 2567;

export function createGameServer(): Server {
  const gameServer = new Server({
    transport: new WebSocketTransport(),
    greet: false,
  });

  gameServer.define(ROOM_NAME, DuelRoom);
  return gameServer;
}

export async function startGameServer(
  port = parsePort(process.env.PORT, DEFAULT_PORT),
): Promise<Server> {
  const gameServer = createGameServer();
  await gameServer.listen(port);
  return gameServer;
}

function parsePort(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  const port = Number(value);
  return Number.isInteger(port) && port >= 0 && port <= 65_535
    ? port
    : fallback;
}

function getListeningPort(gameServer: Server): number | undefined {
  const address = gameServer.transport.server?.address();
  return address && typeof address !== "string" ? address.port : undefined;
}

const isMainModule =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMainModule) {
  startGameServer()
    .then((gameServer) => {
      const port = getListeningPort(gameServer) ?? DEFAULT_PORT;
      console.log(`Wizard Arena multiplayer server listening on ${port}`);
    })
    .catch((error: unknown) => {
      console.error("Unable to start multiplayer server", error);
      process.exitCode = 1;
    });
}
