"use client";

import { useCallback, useRef, useState } from "react";
import PhaserArena, { type ArenaHandle } from "@/components/PhaserArena";

const MAX_MANA = 100;

export default function ArenaShell() {
  const arenaRef = useRef<ArenaHandle>(null);
  const [mana, setMana] = useState(MAX_MANA);
  const [health, setHealth] = useState(100);
  const [cooldown, setCooldown] = useState(0);
  const [phase, setPhase] = useState<"ready" | "charging" | "flying" | "impact">("ready");
  const cast = useCallback(() => arenaRef.current?.cast(), []);
  const canCast = cooldown === 0 && mana >= 25 && phase === "ready";
  const phaseLabel = phase === "ready" ? "READY TO CAST" : phase === "charging" ? "WEAVING SPELL" : phase === "flying" ? "SPELL IN FLIGHT" : "DIRECT HIT";

  return (
    <main className="arena-shell">
      <PhaserArena ref={arenaRef} onManaChange={setMana} onTargetHealthChange={setHealth} onCooldownChange={setCooldown} onPhaseChange={setPhase} />
      <div className="vignette" />
      <header className="hud top-hud">
        <div className="brand-lockup"><div className="brand-mark">✦</div><div><p className="eyebrow">THE ARCANE CIRCUIT</p><h1>WIZARD ARENA</h1></div></div>
        <div className="round-status"><span className="status-dot" /><span>TRIAL 01</span><i /><span>EMBER SANCTUM</span></div>
        <div className="top-actions"><span className="key-hint">SPACE</span><span>QUICK CAST</span></div>
      </header>
      <section className="hud encounter-card"><p className="eyebrow">CURRENT ENCOUNTER</p><h2>THE ASHEN WARDEN</h2><div className="encounter-rule"><span style={{ width: `${health}%` }} /></div><div className="encounter-meta"><span>WARDEN CORE</span><strong>{health}%</strong></div></section>
      <div className="target-name"><span className="target-chevron">◆</span><span>ASHEN WARDEN</span><small>TRAINING TARGET</small></div>
      <section className="hud spell-panel"><div className="spell-icon"><span>✦</span></div><div className="spell-copy"><p className="eyebrow">EQUIPPED SPELL</p><h2>EMBER LANCE</h2><p className="spell-description">A focused bolt of living flame.</p></div><div className="spell-cost"><strong>25</strong><span>MANA</span></div><button className={`cast-button ${!canCast ? "is-disabled" : ""}`} type="button" onClick={cast} disabled={!canCast}><span className="cast-button-label">{cooldown > 0 ? `${cooldown.toFixed(1)}s` : "CAST"}</span><span className="cast-button-sub">{phaseLabel}</span></button></section>
      <section className="hud player-status"><div className="wizard-badge">✧</div><div className="player-copy"><p className="eyebrow">DUELIST</p><h2>LYRA VELL</h2></div><div className="resource-block"><div className="resource-label"><span>VITALITY</span><strong>100 / 100</strong></div><div className="resource-bar vitality"><span /></div></div><div className="resource-block"><div className="resource-label"><span>MANA</span><strong>{Math.round(mana)} / 100</strong></div><div className="resource-bar mana"><span style={{ width: `${mana}%` }} /></div></div></section>
      <footer className="hud footer-hint"><span className="mouse-icon">◉</span><span>CLICK ANYWHERE IN THE ARENA TO CAST</span><i /><span>RESONANCE</span><div className="resonance-dots"><b /><b /><b /><b /><b /></div></footer>
    </main>
  );
}
