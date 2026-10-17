import Link from "next/link";

export default function HomeMenu() {
  return (
    <main className="home-menu">
      <div className="home-menu-stars" aria-hidden="true" />
      <div className="home-menu-orbit home-menu-orbit-one" aria-hidden="true" />
      <div className="home-menu-orbit home-menu-orbit-two" aria-hidden="true" />

      <header className="home-header">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">✦</div>
          <div>
            <p className="eyebrow">THE ARCANE CIRCUIT</p>
            <h1>WIZARD ARENA</h1>
          </div>
        </div>
        <div className="home-status"><span className="status-dot" /> ONLINE TRIALS</div>
      </header>

      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-copy how-to-play">
          <p className="eyebrow">ENTER THE SANCTUM <span className="eyebrow-divider">/</span> TRIAL 01</p>
          <h2 id="home-title">HOW TO<br /><em>PLAY.</em></h2>
          <p className="home-lede">Three simple steps stand between you and your first spell.</p>
          <ol className="how-to-play-list" aria-label="How to play">
            <li>
              <span className="how-to-play-number">01</span>
              <div>
                <strong>LEARN THE SYMBOL</strong>
                <p>Study the rune in the <Link href="/spells">spell book</Link>.</p>
              </div>
            </li>
            <li>
              <span className="how-to-play-number">02</span>
              <div>
                <strong>DRAW THE SYMBOL</strong>
                <p>Trace the shape in the arena with your mouse.</p>
              </div>
            </li>
            <li>
              <span className="how-to-play-number">03</span>
              <div>
                <strong>PRESS A TO EXECUTE</strong>
                <p>When the rune is complete, press <kbd>A</kbd> to cast.</p>
              </div>
            </li>
          </ol>
        </div>

        <div className="home-menu-panel">
          <div className="home-panel-heading">
            <div>
              <p className="eyebrow">CHOOSE YOUR PATH</p>
              <h3>START GAME</h3>
            </div>
            <span className="home-panel-index">01 <i /> 02</span>
          </div>

          <div className="game-mode-list" aria-label="Game modes">
            <Link className="game-mode game-mode-active" href="/arena">
              <span className="game-mode-symbol" aria-hidden="true">↗</span>
              <span className="game-mode-copy"><strong>COMPUTER</strong><small>DUEL THE ASHEN WARDEN</small></span>
              <span className="game-mode-arrow" aria-hidden="true">→</span>
            </Link>
            <button className="game-mode game-mode-disabled" type="button" disabled>
              <span className="game-mode-symbol" aria-hidden="true">◎</span>
              <span className="game-mode-copy"><strong>MULTIPLAYER</strong><small>NETWORK DUELS</small></span>
              <span className="game-mode-badge">NOT IMPLEMENTED</span>
            </button>
          </div>

          <div className="home-panel-footer">
            <span><span className="status-dot" /> COMPUTER TRIAL READY</span>
            <span>DRAW TO CAST</span>
          </div>
        </div>
      </section>

      <footer className="home-footer">
        <Link className="home-spellbook-link" href="/spells">
          <span className="home-spellbook-icon" aria-hidden="true">✧</span>
          <span><small>STUDY YOUR CRAFT</small><strong>SPELL BOOK <b aria-hidden="true">↗</b></strong></span>
        </Link>
        <div className="home-footer-meta"><span>LYRA VELL</span><i /><span>EMBER SANCTUM</span><i /><span>BUILD 01.03</span></div>
      </footer>
    </main>
  );
}
