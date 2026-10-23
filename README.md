# Wizard Arena

Wizard Arena is a Next.js browser-game project where players cast spells as
wizards and defeat intelligent computer opponents. The current game flow has
a home menu, a computer duel, a free-cast practice range, a spell book, five
drawable spells, and a victory/defeat loop for duels.

## Game flow

- `/` — home menu with `COMPUTER`, `PRACTICE`, `SPELL BOOK`, and `MULTIPLAYER`.
- `/arena` — local computer duel against the Ashen Warden.
- `/practice` — free-cast practice range with a passive target; every registered spell can be drawn and released with `A` without mana or cooldown limits.
- `/spells` — learn every currently available rune before entering the arena.
- `/multiplayer` — create or join a two-player Colyseus room, view the room roster, and ready up for the network duel.

The computer opponent evaluates its mana, cooldown, health, projectile state,
and the player's shield before choosing between Ember Lance, Lightning, Freeze,
Aegis, and Ghost Portal. A successful Lightning hit deals 20 damage and stuns
the computer for 1.8 seconds, interrupting any active cast. Freeze binds the
target for 2.5 seconds. Ghost Portal deals 10 damage and empties the target's
mana. It uses deterministic timing and local simulation. The multiplayer
backend is available as a separate Colyseus process described below.

## First playable slice

- Draw Ember Lance with its long downward stroke followed by an up-right hook.
- Open the spellbook to learn Lightning: draw three connected diagonal strokes
  (down-right, down-left, down-right), or draw the zig-zag continuously. It
  costs 35 mana, deals 20 damage, and briefly stuns the computer on hit.
- Draw Aegis as one closed square while a projectile is travelling to raise a
  ward and absorb that impact; do not add the former crossing diagonals.
- Draw Freeze as two nearby, concentric closed circles, one circle per stroke;
  it costs 50 mana, deals no damage, and freezes the target for 2.5 seconds.
  An active Aegis ward consumes itself and reduces that freeze to 1 second.
- Draw Ghost Portal as three separate closed circles, one circle per stroke. It
  costs 50 mana, opens beside the caster, sends three attacking ghosts across
  the arena, deals 10 damage, and drains the opponent's mana to zero on impact.
- Select `LEARN IN ARENA` on a spell card to equip it with the matching symbol
  and gesture; opening `/` keeps Ember Lance equipped by default.
- Open `/spells` or choose `SPELLBOOK` in the arena header to study the rune
  diagram and drawing order before entering the duel.
- Use the arena drawing toolbar to switch between Freehand, Circle, Square, and
  Line tools. Freehand is selected by default, and the selected tool stays
  active until you change it.
- Draw as many strokes as the rune needs, switching tools between strokes when
  useful. Spells never match or execute automatically: press `A` when the full
  rune is ready to match and release. An incomplete rune stays on the arena so
  you can keep drawing; a malformed rune disappears after a failed match.
- Projectile travel is deliberately slower, giving the defender time to draw
  Aegis and react. Watch the cast charge, trail, impact burst, target recoil,
  mana cost, and cooldown feedback for the selected spell.
- Repeat the cast until the training target's health reaches zero.
- Choose `PRACTICE` from the home menu to enter a passive free-cast range. Draw any registered rune and press `A` to replay its normal cast animation without opponent attacks, duel end states, mana costs, or cooldown waits.

The scene uses original procedural Phaser artwork rather than external game
assets, so the prototype can be rebuilt and run without a separate asset
pipeline. The next quality bar is to replace selected procedural pieces with
licensed, hand-authored sprites and audio while preserving the same simulation
and effects interfaces.

## Multiplayer backend

The first multiplayer slice is a standalone Colyseus server under
[`server/`](server/). It is independent of the Next.js/React UI and listens
on port `2567` by default:

```bash
npm run server
# or, with automatic restart during backend work:
npm run server:dev
```

Set `PORT` to choose another port. The registered room type is
`wizard_duel`. Colyseus creates a unique room ID for each room; a client can
create a room with `joinOrCreate("wizard_duel", metadata)`, then share the
returned `room.roomId` and use `joinById(roomId, metadata)` for the second
player. Join metadata accepts `displayName` and `wizardId`.

The authoritative room state contains at most two players and follows these
transitions:

- `waiting` — fewer than two players are connected.
- `ready` — two players are connected and at least one is not ready.
- `playing` — both players have sent `ready: true`.
- `finished` — a player leaves during play; the remaining player is recorded as
  the winner and the room is locked.

Supported client messages are `ready` (`{ ready: boolean }`), `ping`
(`{ nonce?: string }`), and `leave` (`{ reason?: string }`). A valid `ping`
receives a typed `pong` containing the nonce and authoritative server time.
The server also handles normal Colyseus client disconnects through the same
room lifecycle rules.

The browser connects through [`lib/multiplayer/duel-client.ts`](lib/multiplayer/duel-client.ts),
a UI-independent adapter around the Colyseus SDK. The lobby and multiplayer
arena do not import or manage raw WebSocket lifecycle details. Set
`NEXT_PUBLIC_COLYSEUS_URL` when the backend is not running at the local default;
`.env.example` contains the local development values.

The multiplayer arena streams bounded drawing previews, sends completed strokes
to the room for server-side recognition, and renders server-authored spell
phases and impacts. Health, mana, cooldowns, shields, freezes, stuns, damage,
mana drain, and the winner are all resolved by the Colyseus room rather than by
the browser.

## Adding a spell

Spell content lives in [`data/spells.json`](data/spells.json). Add a record with
its symbol, costs, timings, gesture metadata, asset key, and visual kind.
Spell-specific recognizers live in [`game/recognition`](game/recognition), with
shared geometry helpers in `shared.ts`; register a new recognizer in
[`game/spellRecognition.ts`](game/spellRecognition.ts) only when the gesture is
a new shape. Add a visual renderer in `ArenaScene` only for a genuinely new
effect style. The arena tries every registered recognizer after each completed
drawing, so the matching symbol chooses the spell rather than the currently
selected card.

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

In a second terminal, start the standalone multiplayer server:

```bash
npm run server
```

Open <http://localhost:3000>. Choose `MULTIPLAYER`, create a room, then open a
second browser window and join with the displayed room ID. Both players can
ready up, enter the Phaser arena, draw runes, see each other's live drawing,
and observe server-authoritative spell impacts in real time.

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

`make test` runs the backend integration test and typecheck, the configured
ESLint check, the Next.js production build, and the repository CSS/shared
checks. All checks run locally without fetching additional resources once
`npm ci` has completed.

The individual commands are also available when needed:

```bash
npm run lint
npm run build
npm run test:backend
npm run typecheck:backend
npx tsx --test lib/multiplayer/duel-client.test.ts
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

The same image can run the standalone multiplayer process instead:

```bash
docker build -t wizard-arena .
docker run --rm -p 2567:2567 wizard-arena npm run server
```

The frontend and multiplayer backend are separate processes. Configure the
frontend container with `NEXT_PUBLIC_COLYSEUS_URL` pointing at the public
`ws://`/`wss://` address of the backend.
