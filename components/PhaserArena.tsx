"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { ArenaCallbacks } from "@/game/ArenaScene";

export type ArenaHandle = { cast: () => void };
type PhaserArenaProps = ArenaCallbacks;
type ArenaGame = {
  destroy: (removeCanvas: boolean) => void;
  scene: { getScene: (key: string) => unknown };
};

const PhaserArena = forwardRef<ArenaHandle, PhaserArenaProps>(function PhaserArena({ onManaChange, onTargetHealthChange, onCooldownChange, onPhaseChange }, ref) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{ castFireball: () => void } | null>(null);

  useImperativeHandle(ref, () => ({ cast: () => sceneRef.current?.castFireball() }), []);

  useEffect(() => {
    let cancelled = false;
    let game: ArenaGame | null = null;

    async function boot() {
      const { createArenaGame } = await import("@/game/ArenaScene");
      if (cancelled || !mountRef.current) return;
      game = createArenaGame(mountRef.current, { onManaChange, onTargetHealthChange, onCooldownChange, onPhaseChange });
      sceneRef.current = game.scene.getScene("WizardArena") as { castFireball: () => void };
    }

    void boot();
    return () => {
      cancelled = true;
      sceneRef.current = null;
      game?.destroy(true);
    };
  }, [onManaChange, onTargetHealthChange, onCooldownChange, onPhaseChange]);

  return <div ref={mountRef} className="arena-canvas" aria-label="Playable wizard arena" />;
});

export default PhaserArena;
