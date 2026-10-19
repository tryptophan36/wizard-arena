"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { SPELLS, type SpellId } from "@/game/spellData";

function gestureLabel(type: string) {
  if (type === "one-stroke") return "ONE STROKE";
  if (type === "three-stroke") return "THREE STROKES";
  return "TWO STROKES";
}

function RuneDiagram({ spellId }: { spellId: SpellId }) {
  const titleId = `rune-drawing-${spellId}`;

  return (
    <svg className={`spellbook-rune-svg spellbook-rune-svg-${spellId}`} viewBox="0 0 180 130" role="img" aria-labelledby={titleId}>
      <title id={titleId}>How to draw the {spellId} rune</title>
      {spellId === "ember-lance" && <>
        <path className="spellbook-rune-stroke" d="M76 16V99" />
        <path className="spellbook-rune-stroke" d="M76 99L137 43" />
        <circle className="spellbook-rune-start" cx="76" cy="16" r="4" />
      </>}
      {spellId === "lightning" && <>
        <path className="spellbook-rune-stroke" d="M42 17L91 55" />
        <path className="spellbook-rune-stroke" d="M91 55L48 99" />
        <path className="spellbook-rune-stroke" d="M48 99L123 119" />
        <circle className="spellbook-rune-start" cx="42" cy="17" r="4" />
      </>}
      {spellId === "aegis" && <>
        <path className="spellbook-rune-stroke" d="M48 18H132V102H48V18Z" />
        <circle className="spellbook-rune-start" cx="48" cy="18" r="4" />
      </>}
      {spellId === "freeze" && <>
        <circle className="spellbook-rune-stroke" cx="90" cy="65" r="49" />
        <circle className="spellbook-rune-stroke" cx="90" cy="65" r="27" />
        <circle className="spellbook-rune-start" cx="90" cy="16" r="4" />
      </>}
      {spellId === "ghost-portal" && <>
        <circle className="spellbook-rune-stroke" cx="47" cy="52" r="25" />
        <circle className="spellbook-rune-stroke" cx="133" cy="52" r="25" />
        <circle className="spellbook-rune-stroke" cx="90" cy="103" r="25" />
        <circle className="spellbook-rune-start" cx="47" cy="27" r="4" />
        <circle className="spellbook-rune-start" cx="133" cy="27" r="4" />
        <circle className="spellbook-rune-start" cx="90" cy="78" r="4" />
      </>}
    </svg>
  );
}

export default function SpellsPage() {
  const [pageIndex, setPageIndex] = useState(0);
  const spell = SPELLS[pageIndex];
  const isFirstPage = pageIndex === 0;
  const isLastPage = pageIndex === SPELLS.length - 1;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "ArrowLeft" && !isFirstPage) setPageIndex((current) => current - 1);
      if (event.key === "ArrowRight" && !isLastPage) setPageIndex((current) => current + 1);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFirstPage, isLastPage]);

  return (
    <main className="spellbook-reader-page">
      <div className="spellbook-reader-stars" aria-hidden="true" />
      <header className="spellbook-reader-header">
        <Link className="spellbook-back" href="/arena">
          <span aria-hidden="true">←</span> RETURN TO ARENA
        </Link>
        <div className="spellbook-brand">
          <div className="brand-mark" aria-hidden="true">✦</div>
          <div>
            <p className="eyebrow">THE ARCANE CIRCUIT</p>
            <h1>THE SPELLBOOK</h1>
          </div>
        </div>
        <div className="spellbook-status"><span className="status-dot" /> PAGE TURNER</div>
      </header>

      <section className="spellbook-reader-intro" aria-labelledby="spellbook-title">
        <div>
          <p className="eyebrow">SPELLBOOK <span className="eyebrow-divider">/</span> ARCANE GRIMOIRE</p>
          <h2 id="spellbook-title">TURN THE <em>PAGE.</em></h2>
          <p>Each page holds one spell. Study its mark, learn the gesture, then carry it into the arena.</p>
        </div>
        <div className="spellbook-reader-key"><span>←</span><span>→</span><small>USE ARROW KEYS TO READ</small></div>
      </section>

      <section className="spellbook-reader" aria-label="Spellbook pages">
        <div className="spellbook-book-wrap">
          <div className="spellbook-book-shadow" aria-hidden="true" />
          <div className="spellbook-book" key={spell.id}>
            <article className="spellbook-leaf spellbook-art-leaf" aria-label={`${spell.name} illustration`}>
              <div className="spellbook-page-corner" aria-hidden="true" />
              <div className="spellbook-leaf-topline"><span>ARCANE FIELD NOTES</span><span>FOLIO {String(pageIndex + 1).padStart(2, "0")}</span></div>
              <div className={`spellbook-art-stage spellbook-art-${spell.id}`}>
                <span className="spellbook-art-orbit spellbook-art-orbit-one" aria-hidden="true" />
                <span className="spellbook-art-orbit spellbook-art-orbit-two" aria-hidden="true" />
                <span className="spellbook-art-rune" role="img" aria-label={`${spell.name} rune symbol`}>{spell.symbol}</span>
                <div className="spellbook-art-image">
                  <Image src={`/assets/${spell.assetKey}.svg`} alt={`${spell.name} spell illustration`} fill sizes="(max-width: 800px) 72vw, 390px" />
                </div>
              </div>
              <div className="spellbook-art-caption">
                <div><span className="detail-label">VISUAL SIGNATURE</span><strong>{spell.school}</strong></div>
              </div>
              <div className="spellbook-rune-card">
                <div className="spellbook-rune-heading"><span className="detail-label">RUNE DRAWING</span><strong>TRACE THIS SYMBOL</strong></div>
                <div className="spellbook-rune-diagram"><RuneDiagram spellId={spell.id} /></div>
                <p>{spell.gesture.hint}</p>
              </div>
              <p className="spellbook-quote">&ldquo;{spell.description}&rdquo;</p>
            </article>

            <div className="spellbook-spine" aria-hidden="true" />

            <article className="spellbook-leaf spellbook-detail-leaf" aria-live="polite">
              <div className="spellbook-page-corner spellbook-page-corner-right" aria-hidden="true" />
              <div className="spellbook-leaf-topline"><span>{spell.difficulty} PATTERN</span><span>THE ARCANE GRIMOIRE</span></div>
              <div className="spellbook-detail-heading">
                <p className="eyebrow">{spell.school}</p>
                <h3>{spell.name}</h3>
                <p>{spell.description}</p>
              </div>

              <div className="spellbook-stat-grid" aria-label={`${spell.name} spell statistics`}>
                <div><span>MANA</span><strong>{spell.manaCost}</strong></div>
                <div><span>COOLDOWN</span><strong>{spell.cooldown}<small> SEC</small></strong></div>
                <div><span>IMPACT</span><strong>{spell.damage}<small> DMG</small></strong></div>
              </div>

              <section className="spellbook-detail-section">
                <div className="spellbook-section-label"><span>01</span><div><span className="detail-label">GESTURE</span><strong>{gestureLabel(spell.gesture.type)}</strong></div></div>
                <p className="spellbook-gesture-hint">{spell.gesture.hint}</p>
              </section>

              <section className="spellbook-detail-section spellbook-effect-section">
                <div className="spellbook-section-label"><span>02</span><div><span className="detail-label">SPELL EFFECT</span><strong>WHAT THE WEAVE DOES</strong></div></div>
                <p>{spell.effect}</p>
              </section>

              <section className="spellbook-detail-section spellbook-steps-section">
                <div className="spellbook-section-label"><span>03</span><div><span className="detail-label">DRAWING ORDER</span><strong>FOLLOW THE STROKES</strong></div></div>
                <ol className="spellbook-step-list">
                  {spell.gesture.steps.map((step) => (
                    <li key={step.number}>
                      <span>{step.number}</span>
                      <div><strong>{step.title}</strong><p>{step.description}</p></div>
                      <b>{step.gesture}</b>
                    </li>
                  ))}
                </ol>
              </section>

              <div className="spellbook-detail-footer">
                <div className="spellbook-tags">{spell.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
                <Link className="spellbook-arena-cta" href={`/arena?spell=${spell.id}`}>PRACTICE THIS SPELL <span aria-hidden="true">↗</span></Link>
              </div>
            </article>
          </div>
        </div>

        <nav className="spellbook-page-navigation" aria-label="Spellbook navigation">
          <button type="button" aria-label="Previous spell" onClick={() => setPageIndex((current) => current - 1)} disabled={isFirstPage}>
            <span aria-hidden="true">←</span>
          </button>
          <button type="button" aria-label="Next spell" onClick={() => setPageIndex((current) => current + 1)} disabled={isLastPage}>
            <span aria-hidden="true">→</span>
          </button>
        </nav>
      </section>
    </main>
  );
}
