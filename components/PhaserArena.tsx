"use client";

import { useEffect, useRef } from "react";
import type { ArenaCallbacks } from "@/game/ArenaScene";

type PhaserArenaProps = ArenaCallbacks;
type ArenaGame = {
  destroy: (removeCanvas: boolean) => void;
  scene: { getScene: (key: string) => unknown };
};

export default function PhaserArena({ onManaChange, onTargetHealthChange, onCooldownChange, onPhaseChange, onGestureChange }: PhaserArenaProps) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let game: ArenaGame | null = null;

    async function boot() {
      const { createArenaGame } = await import("@/game/ArenaScene");
      if (cancelled || !mountRef.current) return;
      game = createArenaGame(mountRef.current, { onManaChange, onTargetHealthChange, onCooldownChange, onPhaseChange, onGestureChange });
    }

    void boot();
    return () => {
      cancelled = true;
      game?.destroy(true);
    };
  }, [onManaChange, onTargetHealthChange, onCooldownChange, onPhaseChange, onGestureChange]);

  return <div ref={mountRef} className="arena-canvas" aria-label="Playable wizard arena" />;
}
