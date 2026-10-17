import Link from "next/link";

const drawingSteps = [
  {
    number: "01",
    title: "Draw the ember stroke",
    description: "Begin at the crown and pull one steady line straight down. Keep the stroke long and centered to anchor the spell.",
    gesture: "CROWN  ↓  TURN",
  },
  {
    number: "02",
    title: "Hook toward the flame",
    description: "Without lifting the mouse, turn from the bottom and finish with a clean diagonal sweep up and right.",
    gesture: "TURN  ↗  POINT",
  },
];

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
          <p className="eyebrow">SPELL 01 <span className="eyebrow-divider">/</span> EMBER SANCTUM</p>
          <h2 id="page-title">LEARN THE <em>EMBER LANCE</em></h2>
          <p className="spellbook-lede">A focused bolt of living flame. Trace this initiate rune cleanly, then return to the arena and put it through the Ashen Warden&apos;s guard. Greater spells will demand longer chains and tighter turns.</p>
        </div>
        <div className="difficulty-card" aria-label="Difficulty: initiate">
          <span className="detail-label">DIFFICULTY</span>
          <strong>INITIATE</strong>
          <span className="difficulty-dots" aria-hidden="true"><i /><i /><i /><i className="is-muted" /><i className="is-muted" /></span>
        </div>
      </section>

      <div className="spellbook-content">
        <section className="rune-card" aria-labelledby="rune-title">
          <div className="card-heading">
            <div><p className="eyebrow">RUNE PATTERN <span className="eyebrow-divider">/</span> 01</p><h3 id="rune-title">EMBER LANCE</h3></div>
            <span className="rune-state"><span className="status-dot" /> STABLE</span>
          </div>
          <div className="rune-stage">
            <div className="rune-orbit rune-orbit-one" aria-hidden="true" />
            <div className="rune-orbit rune-orbit-two" aria-hidden="true" />
            <svg className="rune-diagram" viewBox="0 0 360 320" role="img" aria-label="Ember Lance rune: a downward stroke followed by an up-right hook">
              <defs>
                <linearGradient id="runeGlow" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0" stopColor="#ffe4a3" />
                  <stop offset="0.48" stopColor="#ff9b55" />
                  <stop offset="1" stopColor="#ff684f" />
                </linearGradient>
                <filter id="softGlow" x="-60%" y="-60%" width="220%" height="220%">
                  <feGaussianBlur stdDeviation="5" result="blur" />
                  <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
              </defs>
              <circle className="rune-ring" cx="180" cy="160" r="112" />
              <path className="rune-ghost" d="M180 47L180 246L270 151" />
              <path className="rune-stroke rune-stroke-main" d="M180 48L180 246" pathLength="1" />
              <path className="rune-stroke rune-stroke-wing rune-stroke-wing-right" d="M180 246L270 151" pathLength="1" />
              <path className="rune-flare" d="M180 48L171 62M180 48L189 62M270 151L253 153M270 151L263 166" />
              <g className="rune-nodes" aria-hidden="true">
                <circle cx="180" cy="48" r="13" /><text x="180" y="52">1</text>
                <circle cx="180" cy="246" r="13" /><text x="180" y="250">2</text>
                <circle cx="270" cy="151" r="13" /><text x="270" y="155">3</text>
              </g>
            </svg>
            <p className="rune-stage-caption"><span>TRACE IN ORDER</span><i /> <span>KEEP YOUR WRIST LIGHT</span></p>
          </div>
        </section>

        <aside className="spell-profile" aria-labelledby="profile-title">
          <div className="card-heading"><div><p className="eyebrow">SPELL PROFILE</p><h3 id="profile-title">COMBAT READOUT</h3></div><span className="profile-symbol" aria-hidden="true">✦</span></div>
          <dl className="spell-stats">
            <div><dt>MANA COST</dt><dd><strong>25</strong><span> MANA</span></dd></div>
            <div><dt>COOLDOWN</dt><dd><strong>2.4</strong><span> SEC</span></dd></div>
            <div><dt>IMPACT</dt><dd><strong>25</strong><span> DAMAGE</span></dd></div>
          </dl>
          <div className="effect-callout"><span className="detail-label">EFFECT</span><p>Direct hit. A condensed lance of living flame strikes the target and leaves a brief ember trail.</p></div>
          <div className="spell-tags"><span>FOCUSED</span><span>FIRE</span><span>SINGLE TARGET</span></div>
        </aside>
      </div>

      <section className="steps-section" aria-labelledby="steps-title">
        <div className="steps-heading"><div><p className="eyebrow">THE WEAVE</p><h3 id="steps-title">TWO MOTIONS TO IGNITION</h3></div><span className="steps-note">DRAWING ORDER <strong>01—02</strong></span></div>
        <ol className="steps-list">
          {drawingSteps.map((step) => (
            <li key={step.number}>
              <span className="step-number">{step.number}</span>
              <div className="step-copy"><h4>{step.title}</h4><p>{step.description}</p></div>
              <span className="step-gesture">{step.gesture}</span>
            </li>
          ))}
        </ol>
      </section>

      <footer className="spellbook-footer">
        <div><p className="eyebrow">LESSON COMPLETE?</p><p className="footer-prompt">Take the Ember Lance to the circuit.</p></div>
        <Link className="arena-cta" href="/">ENTER THE ARENA <span aria-hidden="true">↗</span></Link>
      </footer>
    </main>
  );
}
