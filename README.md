# Wizard Arena

Wizard Arena is a Next.js browser-game project where players cast spells as
wizards and defeat their opponents. The first playable slice is now live: a
procedural Ember Sanctum arena with the Lyra Vell wizard, the Ashen Warden
training target, and a data-driven spellbook containing Ember Lance and
Lightning plus the reactive Aegis shield.

## First playable slice

- Draw Ember Lance with its long downward stroke followed by an up-right hook.
- Open the spellbook to learn Lightning: draw three connected diagonal strokes
  (down-right, down-left, down-right), or draw the zig-zag continuously.
- Draw Aegis as a closed square followed by two opposite diagonals while a
  projectile is travelling to raise a ward and absorb that impact.
- Select `LEARN IN ARENA` on a spell card to equip it with the matching symbol
  and gesture; opening `/` keeps Ember Lance equipped by default.
- Open `/spells` or choose `SPELLBOOK` in the arena header to study the rune
  diagram and drawing order before entering the duel.
- Each gesture must be long enough to pass recognition before its spell launches;
  a short or malformed rune shows a failure hint and does not spend mana.
- Projectile travel is deliberately slower, giving the defender time to draw
  Aegis and react. Watch the cast charge, trail, impact burst, target recoil,
  mana cost, and cooldown feedback for the selected spell.
- Repeat the cast until the training target's health reaches zero.

The scene uses original procedural Phaser artwork rather than external game
assets, so the prototype can be rebuilt and run without a separate asset
pipeline. The next quality bar is to replace selected procedural pieces with
licensed, hand-authored sprites and audio while preserving the same simulation
and effects interfaces.

## Adding a spell

Spell content lives in [`data/spells.json`](data/spells.json). Add a record with
its symbol, costs, timings, gesture metadata, asset key, and visual kind. Add a
recognizer to the registry in [`game/spellRecognition.ts`](game/spellRecognition.ts)
only when the gesture is a new shape; existing recognizers can be reused. Add a
visual renderer in `ArenaScene` only for a genuinely new effect style. The arena
tries every registered recognizer after each completed drawing, so the matching
symbol chooses the spell rather than the currently selected card.

## Requirements

- Node.js 22.14.0 (the version is pinned in [`.nvmrc`](.nvmrc))
- npm (included with Node.js)
- Docker 20.10+ for the container workflow

Next.js 16.4.2 requires Node.js 20.9.0 or newer. Using the pinned version
keeps local and container builds consistent.

## Setup

With [nvm](https://github.com/nvm-sh/nvm) installed:

```bash
nvm install
nvm use
npm ci
```

Without nvm, install Node.js 22.14.0 using your preferred Node version
manager, then run:

```bash
npm ci
```

`npm ci` uses `package-lock.json` and installs the exact locked dependency
tree. Dependencies are local to this project; no global npm packages are
required.

## Run locally

Start the development server with hot reload:

```bash
npm run dev
```

Open <http://localhost:3000>.

To serve a production build locally:

```bash
npm run build
npm run start
```

## Test and checks

Install dependencies first, then run the single project check command:

```bash
make test
```

`make test` runs the configured ESLint check followed by the Next.js
production build. Both checks run locally without fetching additional
resources once `npm ci` has completed.

The individual commands are also available when needed:

```bash
npm run lint
npm run build
```

## Deploy with Docker

Build the reproducible production image and run it on port 3000:

```bash
docker build -t wizard-arena .
docker run --rm -p 3000:3000 wizard-arena
```

Or use the Makefile shortcuts:

```bash
make docker-build
make docker-run
```

Then open <http://localhost:3000>. The Docker image uses Node.js 22.14.0,
installs from the committed lockfile with `npm ci`, builds the app, and starts
it with `next start`.
