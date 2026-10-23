"use client";

import { useEffect, useRef } from "react";

import type { DuelClient } from "@/lib/multiplayer";
import type { MultiplayerArenaFeedback } from "@/game/MultiplayerArenaScene";
import type { DrawingTool, DrawingToolState } from "@/game/drawingTool";

type MultiplayerPhaserArenaProps = {
  client: DuelClient;
  onFeedback: (feedback: MultiplayerArenaFeedback) => void;
  drawingTool: DrawingTool;
};

type PhaserGame = {
  destroy: (removeCanvas: boolean) => void;
};

export default function MultiplayerPhaserArena({ client, onFeedback, drawingTool }: MultiplayerPhaserArenaProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const feedbackRef = useRef(onFeedback);
  const drawingToolStateRef = useRef<DrawingToolState>({ value: drawingTool });

  useEffect(() => {
    feedbackRef.current = onFeedback;
  }, [onFeedback]);

  useEffect(() => {
    drawingToolStateRef.current.value = drawingTool;
  }, [drawingTool]);

  useEffect(() => {
    let cancelled = false;
    let game: PhaserGame | null = null;

    async function boot(): Promise<void> {
      const { createMultiplayerArenaGame } = await import("@/game/MultiplayerArenaScene");
      if (cancelled || !mountRef.current) return;
      game = createMultiplayerArenaGame(
        mountRef.current,
        client,
        { onFeedback: (feedback) => feedbackRef.current(feedback) },
        drawingToolStateRef.current,
      );
    }

    void boot();
    return () => {
      cancelled = true;
      game?.destroy(true);
    };
  }, [client]);

  return <div ref={mountRef} className="multiplayer-arena-canvas" aria-label="Multiplayer wizard arena" />;
}
