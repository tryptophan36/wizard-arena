"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import PhaserArena from "@/components/PhaserArena";
import type { ArenaGameState, EnemyActivity, GestureFeedback } from "@/game/ArenaScene";
import { getSpell, isSpellId, type SpellId } from "@/game/spellData";

const MAX_MANA = 100;

export default function ArenaShell() {
  const searchParams = useSearchParams();
  const requestedSpellId = searchParams.get("spell");
  const initialSpellId: SpellId = isSpellId(requestedSpellId) ? requestedSpellId : "ember-lance";
  const [spellId, setSpellId] = useState<SpellId>(initialSpellId);
  const spell = getSpell(spellId);
  const [mana, setMana] = useState(MAX_MANA);
  const [health, setHealth] = useState(100);
  const [playerHealth, setPlayerHealth] = useState(100);
  const [enemyActivity, setEnemyActivity] = useState<EnemyActivity>("waiting");
  const [gameState, setGameState] = useState<ArenaGameState>("playing");
  const [cooldown, setCooldown] = useState(0);
  const [phase, setPhase] = useState<"ready" | "charging" | "flying" | "impact">("ready");
  const [gesture, setGesture] = useState<GestureFeedback>({ status: "idle", message: `DRAW ${spell.name} RUNE`, hint: spell.gesture.hint });
  const phaseLabel = phase === "ready" ? "READY TO CAST" : phase === "charging" ? "WEAVING SPELL" : phase === "flying" ? "SPELL IN FLIGHT" : "DIRECT HIT";

  return (
    <main className="arena-shell">
      <PhaserArena spellId={initialSpellId} onManaChange={setMana} onTargetHealthChange={setHealth} onPlayerHealthChange={setPlayerHealth} onEnemyActivityChange={setEnemyActivity} onGameStateChange={setGameState} onCooldownChange={setCooldown} onPhaseChange={setPhase} onGestureChange={setGesture} onSpellChange={setSpellId} />
      <div className="vignette" />
      <header className="hud top-hud">
        <div className="brand-lockup"><div className="brand-mark">✦</div><div><p className="eyebrow">THE ARCANE CIRCUIT</p><h1>WIZARD ARENA</h1></div></div>
        <div className="round-status"><span className="status-dot" /><span>TRIAL 01</span><i /><span>{spell.school}</span><i /><span>WARDEN {enemyActivity.toUpperCase()}</span></div>
        <div className="top-actions"><span className="mouse-hint">MOUSE</span><span>DRAW RUNE</span><Link className="spellbook-nav" href="/spells">SPELLBOOK ↗</Link></div>
      </header>
      <section className="hud encounter-card"><p className="eyebrow">CURRENT ENCOUNTER</p><h2>THE ASHEN WARDEN</h2><div className="encounter-rule"><span style={{ width: `${health}%` }} /></div><div className="encounter-meta"><span>WARDEN CORE</span><strong>{health}%</strong></div></section>
      <div className="target-name"><span className="target-chevron">◆</span><span>ASHEN WARDEN</span><small>LOCAL OPPONENT · {enemyActivity.toUpperCase()}</small></div>
      <section className="hud spell-panel"><div className={`spell-icon spell-icon-${spell.id}`}>{spell.id === "freeze" ? <span className="freeze-symbol" aria-label={spell.symbol}><i /><i /></span> : <span>{spell.symbol}</span>}</div><div className="spell-copy"><p className="eyebrow">EQUIPPED SPELL</p><h2>{spell.name}</h2><p className="spell-description">{spell.description}</p></div><div className="spell-cost"><strong>{spell.manaCost}</strong><span>MANA</span></div><div className={`gesture-status gesture-${gesture.status}`} aria-live="polite"><strong>{gesture.message}</strong><span>{gesture.hint}</span>{phase !== "ready" && <small>{phaseLabel} · {cooldown.toFixed(1)}s</small>}</div></section>
      <section className="hud player-status"><div className="wizard-badge">✧</div><div className="player-copy"><p className="eyebrow">DUELIST</p><h2>LYRA VELL</h2></div><div className="resource-block"><div className="resource-label"><span>VITALITY</span><strong>{playerHealth} / 100</strong></div><div className="resource-bar vitality"><span style={{ width: `${playerHealth}%` }} /></div></div><div className="resource-block"><div className="resource-label"><span>MANA</span><strong>{Math.round(mana)} / 100</strong></div><div className="resource-bar mana"><span style={{ width: `${mana}%` }} /></div></div></section>
      <footer className="hud footer-hint"><span className="mouse-icon">◉</span><span>{spell.gesture.hint}</span><i /><span>RESONANCE</span><div className="resonance-dots"><b /><b /><b /><b /><b /></div></footer>
      {gameState !== "playing" && <section className={`game-result game-result-${gameState}`} role="status"><p className="eyebrow">DUEL COMPLETE</p><h2>{gameState === "victory" ? "WARDEN VANQUISHED" : "LYRA FALLS"}</h2><p>{gameState === "victory" ? "Your rune timing broke the Ashen Warden." : "The Ashen Warden's spells found their mark."}</p><div className="result-actions"><Link className="result-action result-action-primary" href="/arena">PLAY AGAIN</Link><Link className="result-action" href="/">RETURN TO MENU</Link></div></section>}
    </main>
  );
}
