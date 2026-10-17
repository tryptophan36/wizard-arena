"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import PhaserArena from "@/components/PhaserArena";
import type { GestureFeedback } from "@/game/ArenaScene";
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
  const [cooldown, setCooldown] = useState(0);
  const [phase, setPhase] = useState<"ready" | "charging" | "flying" | "impact">("ready");
  const [gesture, setGesture] = useState<GestureFeedback>({ status: "idle", message: `DRAW ${spell.name} RUNE`, hint: spell.id === "lightning" ? spell.gesture.hint : "DOWN · UP-RIGHT HOOK · LIFT OPTIONAL" });
  const phaseLabel = phase === "ready" ? "READY TO CAST" : phase === "charging" ? "WEAVING SPELL" : phase === "flying" ? "SPELL IN FLIGHT" : "DIRECT HIT";

  return (
    <main className="arena-shell">
      <PhaserArena spellId={initialSpellId} onManaChange={setMana} onTargetHealthChange={setHealth} onCooldownChange={setCooldown} onPhaseChange={setPhase} onGestureChange={setGesture} onSpellChange={setSpellId} />
      <div className="vignette" />
      <header className="hud top-hud">
        <div className="brand-lockup"><div className="brand-mark">✦</div><div><p className="eyebrow">THE ARCANE CIRCUIT</p><h1>WIZARD ARENA</h1></div></div>
        <div className="round-status"><span className="status-dot" /><span>TRIAL 01</span><i /><span>{spell.school}</span></div>
        <div className="top-actions"><span className="mouse-hint">MOUSE</span><span>DRAW RUNE</span><Link className="spellbook-nav" href="/spells">SPELLBOOK ↗</Link></div>
      </header>
      <section className="hud encounter-card"><p className="eyebrow">CURRENT ENCOUNTER</p><h2>THE ASHEN WARDEN</h2><div className="encounter-rule"><span style={{ width: `${health}%` }} /></div><div className="encounter-meta"><span>WARDEN CORE</span><strong>{health}%</strong></div></section>
      <div className="target-name"><span className="target-chevron">◆</span><span>ASHEN WARDEN</span><small>TRAINING TARGET</small></div>
      <section className="hud spell-panel"><div className="spell-icon"><span>{spell.symbol}</span></div><div className="spell-copy"><p className="eyebrow">EQUIPPED SPELL</p><h2>{spell.name}</h2><p className="spell-description">{spell.description}</p></div><div className="spell-cost"><strong>{spell.manaCost}</strong><span>MANA</span></div><div className={`gesture-status gesture-${gesture.status}`} aria-live="polite"><strong>{gesture.message}</strong><span>{gesture.hint}</span>{phase !== "ready" && <small>{phaseLabel} · {cooldown.toFixed(1)}s</small>}</div></section>
      <section className="hud player-status"><div className="wizard-badge">✧</div><div className="player-copy"><p className="eyebrow">DUELIST</p><h2>LYRA VELL</h2></div><div className="resource-block"><div className="resource-label"><span>VITALITY</span><strong>100 / 100</strong></div><div className="resource-bar vitality"><span /></div></div><div className="resource-block"><div className="resource-label"><span>MANA</span><strong>{Math.round(mana)} / 100</strong></div><div className="resource-bar mana"><span style={{ width: `${mana}%` }} /></div></div></section>
       <footer className="hud footer-hint"><span className="mouse-icon">◉</span><span>{spell.id === "lightning" ? spell.gesture.hint : "DRAW DOWN · HOOK UP-RIGHT · LIFT OPTIONAL"}</span><i /><span>RESONANCE</span><div className="resonance-dots"><b /><b /><b /><b /><b /></div></footer>
    </main>
  );
}
