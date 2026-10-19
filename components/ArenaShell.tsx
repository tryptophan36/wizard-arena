"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import PhaserArena from "@/components/PhaserArena";
import type { ArenaGameState, ArenaMode, EnemyActivity, GestureFeedback } from "@/game/ArenaScene";
import { DEFAULT_DRAWING_TOOL, type DrawingTool } from "@/game/drawingTool";
import { getSpell, isSpellId, type SpellId } from "@/game/spellData";

const MAX_MANA = 100;
const DRAWING_TOOLS: readonly { id: DrawingTool; label: string; icon: string }[] = [
  { id: "freehand", label: "FREEHAND", icon: "∿" },
  { id: "circle", label: "CIRCLE", icon: "○" },
  { id: "square", label: "SQUARE", icon: "□" },
  { id: "line", label: "LINE", icon: "╱" },
];

export default function ArenaShell({ mode = "duel" }: { mode?: ArenaMode }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const isPractice = mode === "practice";
  const restartKey = searchParams.get("restart") ?? "";
  const requestedSpellId = searchParams.get("spell");
  const initialSpellId: SpellId = isSpellId(requestedSpellId) ? requestedSpellId : "ember-lance";
  const [spellId, setSpellId] = useState<SpellId>(initialSpellId);
  const spell = getSpell(spellId);
  const [mana, setMana] = useState(MAX_MANA);
  const [enemyMana, setEnemyMana] = useState(MAX_MANA);
  const [health, setHealth] = useState(100);
  const [playerHealth, setPlayerHealth] = useState(100);
  const [enemyActivity, setEnemyActivity] = useState<EnemyActivity>("waiting");
  const [gameState, setGameState] = useState<ArenaGameState>("playing");
  const [cooldown, setCooldown] = useState(0);
  const [enemyCooldown, setEnemyCooldown] = useState(0);
  const [phase, setPhase] = useState<"ready" | "charging" | "flying" | "impact">("ready");
  const [drawingTool, setDrawingTool] = useState<DrawingTool>(DEFAULT_DRAWING_TOOL);
  const [gesture, setGesture] = useState<GestureFeedback>({ status: "idle", message: `DRAW ${spell.name} RUNE`, hint: spell.gesture.hint });
  const phaseLabel = phase === "ready" ? "READY TO CAST" : phase === "charging" ? "WEAVING SPELL" : phase === "flying" ? "SPELL IN FLIGHT" : "DIRECT HIT";

  return (
    <main className={`arena-shell${isPractice ? " arena-practice" : ""}`}>
      <PhaserArena mode={mode} spellId={initialSpellId} drawingTool={drawingTool} restartKey={restartKey} onManaChange={setMana} onEnemyManaChange={setEnemyMana} onTargetHealthChange={setHealth} onPlayerHealthChange={setPlayerHealth} onEnemyActivityChange={setEnemyActivity} onGameStateChange={setGameState} onCooldownChange={setCooldown} onEnemyCooldownChange={setEnemyCooldown} onPhaseChange={setPhase} onGestureChange={setGesture} onSpellChange={setSpellId} />
      <div className="vignette" />
      <header className="hud top-hud">
        <div className="brand-lockup"><div className="brand-mark">✦</div><div><p className="eyebrow">THE ARCANE CIRCUIT</p><h1>WIZARD ARENA</h1></div></div>
        <div className="round-status"><span className="status-dot" /><span>{isPractice ? "PRACTICE / FREE-CAST" : "TRIAL 01"}</span><i /><span>{spell.school}</span><i /><span>{isPractice ? "PASSIVE TARGET" : `WARDEN ${enemyActivity.toUpperCase()}`}</span></div>
        <div className="top-actions"><span className="mouse-hint">MOUSE</span><span>{isPractice ? "FREE-CAST · PRESS A TO RELEASE" : "DRAW RUNE · PRESS A TO MATCH"}</span><Link className="spellbook-nav" href="/spells">SPELLBOOK ↗</Link></div>
      </header>
      <nav className="drawing-toolbar" aria-label="Rune drawing tool">
        <span className="drawing-toolbar-label">DRAWING TOOL</span>
        <div className="drawing-tool-list">
          {DRAWING_TOOLS.map((tool) => (
            <button className="drawing-tool" type="button" key={tool.id} aria-pressed={drawingTool === tool.id} onClick={() => setDrawingTool(tool.id)} title={`Use ${tool.label.toLowerCase()} tool`}>
              <span className="drawing-tool-icon" aria-hidden="true">{tool.icon}</span>
              <span>{tool.label}</span>
            </button>
          ))}
        </div>
      </nav>
      <div className="target-name"><span className="target-chevron">◆</span><span>{isPractice ? "ARCANE TARGET" : "ASHEN WARDEN"}</span><small>{isPractice ? "PRACTICE TARGET · PASSIVE" : `LOCAL OPPONENT · ${enemyActivity.toUpperCase()}`}</small></div>
      <div className="arena-top-stats">
        <section className="hud player-status"><div className="wizard-badge">✧</div><div className="player-copy"><p className="eyebrow">{isPractice ? "PRACTICE CASTER" : "DUELIST"}</p><h2>LYRA VELL</h2></div><div className="resource-block"><div className="resource-label"><span>VITALITY</span><strong>{playerHealth} / 100</strong></div><div className="resource-bar vitality"><span style={{ width: `${playerHealth}%` }} /></div></div><div className="resource-block"><div className="resource-label"><span>MANA</span><strong>{isPractice ? "∞ FREE" : `${Math.round(mana)} / 100`}</strong></div><div className="resource-bar mana"><span style={{ width: `${isPractice ? 100 : Math.max(0, Math.min(100, mana))}%` }} /></div></div></section>
        <section className={`hud encounter-card${isPractice ? " encounter-card-practice" : ""}`}><p className="eyebrow">{isPractice ? "FREE-CAST RANGE" : "CURRENT ENCOUNTER"}</p><h2>{isPractice ? "PRACTICE TARGET" : "THE ASHEN WARDEN"}</h2><div className="encounter-rule"><span style={{ width: `${health}%` }} /></div><div className="encounter-meta"><span>{isPractice ? "PASSIVE TARGET" : "WARDEN CORE"}</span><strong>{isPractice ? "READY" : `${health}%`}</strong></div><div className="encounter-resources"><div><span>{isPractice ? "RESOURCE" : "MANA"}</span><strong>{isPractice ? "∞" : Math.round(enemyMana)}</strong></div><div><span>COOLDOWN</span><strong>{isPractice ? "NONE" : enemyCooldown > 0 ? `${enemyCooldown.toFixed(1)}s` : "READY"}</strong></div></div></section>
      </div>
      <footer className="hud footer-hint"><span className="mouse-icon">◉</span><span className={`footer-feedback gesture-${gesture.status}`} aria-live="polite"><strong>{gesture.message}</strong><small>{gesture.hint}</small>{phase !== "ready" && <em>{isPractice ? `${phaseLabel} · FREE CAST` : `${phaseLabel} · ${cooldown.toFixed(1)}s`}</em>}</span><i /><span>{isPractice ? "FREE CAST" : "RESONANCE"}</span><div className="resonance-dots"><b /><b /><b /><b /><b /></div></footer>
       {!isPractice && gameState !== "playing" && <section className={`game-result game-result-${gameState}`} role="status"><p className="eyebrow">DUEL COMPLETE</p><h2>{gameState === "victory" ? "WARDEN VANQUISHED" : "LYRA FALLS"}</h2><p>{gameState === "victory" ? "Your rune timing broke the Ashen Warden." : "The Ashen Warden's spells found their mark."}</p><div className="result-actions"><button className="result-action result-action-primary" type="button" onClick={() => router.push(`/arena?${requestedSpellId ? `spell=${requestedSpellId}&` : ""}restart=${Date.now()}`)}>PLAY AGAIN</button><Link className="result-action" href="/">RETURN TO MENU</Link></div></section>}
    </main>
  );
}
