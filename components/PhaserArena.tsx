"use client";

import { useEffect, useRef } from "react";
import type { ArenaCallbacks } from "@/game/ArenaScene";
import type { DrawingTool, DrawingToolState } from "@/game/drawingTool";
import type { SpellId } from "@/game/spellData";

type PhaserArenaProps = ArenaCallbacks & { spellId: SpellId; drawingTool: DrawingTool };
type ArenaGame = {
  destroy: (removeCanvas: boolean) => void;
};

export default function PhaserArena({ onManaChange, onTargetHealthChange, onPlayerHealthChange, onEnemyActivityChange, onGameStateChange, onCooldownChange, onPhaseChange, onGestureChange, onSpellChange, spellId, drawingTool }: PhaserArenaProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const drawingToolStateRef = useRef<DrawingToolState>({ value: drawingTool });

  useEffect(() => {
    drawingToolStateRef.current.value = drawingTool;
  }, [drawingTool]);

  useEffect(() => {
    let cancelled = false;
    let game: ArenaGame | null = null;

    async function boot() {
      const { createArenaGame } = await import("@/game/ArenaScene");
      if (cancelled || !mountRef.current) return;
      game = createArenaGame(mountRef.current, { onManaChange, onTargetHealthChange, onPlayerHealthChange, onEnemyActivityChange, onGameStateChange, onCooldownChange, onPhaseChange, onGestureChange, onSpellChange }, spellId, drawingToolStateRef.current);
    }

    void boot();
    return () => {
      cancelled = true;
      game?.destroy(true);
    };
  }, [onManaChange, onTargetHealthChange, onPlayerHealthChange, onEnemyActivityChange, onGameStateChange, onCooldownChange, onPhaseChange, onGestureChange, onSpellChange, spellId]);

  return <div ref={mountRef} className="arena-canvas" aria-label="Playable wizard arena" />;
}
