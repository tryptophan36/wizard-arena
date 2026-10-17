import Link from "next/link";
import { SPELLS } from "@/game/spellData";

export default function SpellsPage() {
  return (
    <main className="spellbook-page">
      <div className="spellbook-stars" aria-hidden="true" />
      <header className="spellbook-header">
        <Link className="spellbook-back" href="/">
          <span aria-hidden="true">←</span> RETURN TO ARENA
        </Link>
        <div className="spellbook-brand">
          <div className="brand-mark" aria-hidden="true">✦</div>
          <div>
            <p className="eyebrow">THE ARCANE CIRCUIT</p>
            <h1>RUNE ARCHIVE</h1>
          </div>
        </div>
        <div className="spellbook-status"><span className="status-dot" /> TRAINING MODE</div>
      </header>

      <section className="spellbook-intro" aria-labelledby="page-title">
        <div>
          <p className="eyebrow">SPELLBOOK <span className="eyebrow-divider">/</span> RUNE ARCHIVE</p>
          <h2 id="page-title">CHOOSE YOUR <em>WEAVE</em></h2>
          <p className="spellbook-lede">Study each spell&apos;s symbol and gesture before taking it into the circuit. Ember Lance remains the initiate pattern; Lightning attacks and Aegis answers with a reactive ward.</p>
        </div>
        <div className="difficulty-card" aria-label={`${SPELLS.length} spells archived`}>
          <span className="detail-label">ARCHIVED SPELLS</span>
          <strong>{String(SPELLS.length).padStart(2, "0")}</strong>
          <span className="difficulty-dots" aria-hidden="true"><i /><i /><i /><i /><i className="is-muted" /></span>
        </div>
      </section>

      <section className="spell-cards" aria-label="Spells to learn">
        {SPELLS.map((spell, index) => (
          <article className={`spell-card spell-card-${spell.id}`} key={spell.id}>
            <div className="spell-card-topline">
              <span className="spell-card-index">SPELL {String(index + 1).padStart(2, "0")}</span>
              <span className="rune-state"><span className="status-dot" /> {spell.difficulty}</span>
            </div>
            <div className="spell-card-heading">
              <div className="spell-card-symbol" aria-hidden="true">{spell.symbol}</div>
              <div>
                <p className="eyebrow">{spell.school}</p>
                <h3>{spell.name}</h3>
                <p>{spell.description}</p>
              </div>
            </div>
            <div className="spell-card-stats">
              <div><span>MANA</span><strong>{spell.manaCost}</strong></div>
              <div><span>COOLDOWN</span><strong>{spell.cooldown}<small> SEC</small></strong></div>
              <div><span>IMPACT</span><strong>{spell.damage}<small> DMG</small></strong></div>
            </div>
            <div className="spell-card-rune">
              <div className="mini-rune" aria-hidden="true">
                {spell.id === "aegis" ? <span className="mini-rune-square" /> : <><span className="mini-rune-line" /><span className="mini-rune-turn" />{spell.id === "lightning" && <span className="mini-rune-strike" />}</>}
              </div>
              <div>
                <span className="detail-label">GESTURE</span>
                <strong>{spell.gesture.type === "three-stroke" ? "THREE STROKES" : "TWO STROKES"}</strong>
                <p>{spell.gesture.hint}</p>
              </div>
            </div>
            <div className="spell-card-effect"><span className="detail-label">EFFECT</span><p>{spell.effect}</p></div>
            <ol className="spell-card-steps">
              {spell.gesture.steps.map((step) => <li key={step.number}><span>{step.number}</span><div><strong>{step.title}</strong><p>{step.description}</p></div><b>{step.gesture}</b></li>)}
            </ol>
            <div className="spell-card-footer">
              <div className="spell-tags">{spell.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
              <Link className="arena-cta" href={`/?spell=${spell.id}`}>LEARN IN ARENA <span aria-hidden="true">↗</span></Link>
            </div>
          </article>
        ))}
      </section>

      <footer className="spellbook-footer">
        <div><p className="eyebrow">ARCHIVE STATUS</p><p className="footer-prompt">Three patterns ready for the circuit.</p></div>
        <Link className="arena-cta" href="/">RETURN TO ARENA <span aria-hidden="true">↗</span></Link>
      </footer>
    </main>
  );
}
