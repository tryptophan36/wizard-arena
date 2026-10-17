# Wizard Arena

Wizard Arena is a Next.js browser-game project where players cast spells as
wizards and defeat their opponents. The first playable slice is now live: a
procedural Ember Sanctum arena with the Lyra Vell wizard, the Ashen Warden
training target, and the Ember Lance spell.

## First playable slice

- Press `Space` or click the `CAST` button to launch Ember Lance.
- Click anywhere in the arena to quick-cast.
- Watch the cast charge, projectile trail, impact burst, target recoil, mana
  cost, and cooldown feedback.
- Repeat the cast until the training target's health reaches zero.

The scene uses original procedural Phaser artwork rather than external game
assets, so the prototype can be rebuilt and run without a separate asset
pipeline. The next quality bar is to replace selected procedural pieces with
licensed, hand-authored sprites and audio while preserving the same simulation
and effects interfaces.

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
