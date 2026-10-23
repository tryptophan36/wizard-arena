"use client";

import { useEffect, useRef } from "react";
import type { ArenaCallbacks, ArenaMode } from "@/game/ArenaScene";
import type { DrawingTool, DrawingToolState } from "@/game/drawingTool";
import type { SpellId } from "@/game/spellData";

type PhaserArenaProps = ArenaCallbacks & { spellId: SpellId; drawingTool: DrawingTool; mode: ArenaMode; restartKey: string };
type ArenaGame = {
  destroy: (removeCanvas: boolean) => void;
};

export default function PhaserArena({ onManaChange, onEnemyManaChange, onTargetHealthChange, onPlayerHealthChange, onEnemyActivityChange, onGameStateChange, onCountdownChange, onCooldownChange, onEnemyCooldownChange, onPhaseChange, onGestureChange, onSpellChange, spellId, drawingTool, mode, restartKey }: PhaserArenaProps) {
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
      game = createArenaGame(mountRef.current, { onManaChange, onEnemyManaChange, onTargetHealthChange, onPlayerHealthChange, onEnemyActivityChange, onGameStateChange, onCountdownChange, onCooldownChange, onEnemyCooldownChange, onPhaseChange, onGestureChange, onSpellChange }, spellId, drawingToolStateRef.current, mode);
    }

    void boot();
    return () => {
      cancelled = true;
      game?.destroy(true);
    };
  }, [onManaChange, onEnemyManaChange, onTargetHealthChange, onPlayerHealthChange, onEnemyActivityChange, onGameStateChange, onCountdownChange, onCooldownChange, onEnemyCooldownChange, onPhaseChange, onGestureChange, onSpellChange, spellId, mode, restartKey]);

  return <div ref={mountRef} className="arena-canvas" aria-label="Playable wizard arena" />;
}
