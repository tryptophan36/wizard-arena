"use client";

import { useEffect, useRef } from "react";

import type { DuelClient } from "@/lib/multiplayer";
import type { MultiplayerArenaFeedback } from "@/game/MultiplayerArenaScene";

type MultiplayerPhaserArenaProps = {
  client: DuelClient;
  onFeedback: (feedback: MultiplayerArenaFeedback) => void;
};

type PhaserGame = {
  destroy: (removeCanvas: boolean) => void;
};

export default function MultiplayerPhaserArena({ client, onFeedback }: MultiplayerPhaserArenaProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const feedbackRef = useRef(onFeedback);

  useEffect(() => {
    feedbackRef.current = onFeedback;
  }, [onFeedback]);

  useEffect(() => {
    let cancelled = false;
    let game: PhaserGame | null = null;

    async function boot(): Promise<void> {
      const { createMultiplayerArenaGame } = await import("@/game/MultiplayerArenaScene");
      if (cancelled || !mountRef.current) return;
      game = createMultiplayerArenaGame(mountRef.current, client, {
        onFeedback: (feedback) => feedbackRef.current(feedback),
      });
    }

    void boot();
    return () => {
      cancelled = true;
      game?.destroy(true);
    };
  }, [client]);

  return <div ref={mountRef} className="multiplayer-arena-canvas" aria-label="Multiplayer wizard arena" />;
}
