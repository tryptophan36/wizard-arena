.PHONY: test backend-test backend-typecheck lint build css-check shared-test dev server server-dev start docker-build docker-run

# Runs the repository's offline-capable checks after dependencies are installed.
test: backend-test backend-typecheck lint build css-check shared-test

backend-test:
	npm run test:backend

backend-typecheck:
	npm run typecheck:backend

lint:
	npm run lint

build:
	npm run build

css-check:
	node scripts/check-built-css.mjs

shared-test:
	node --import tsx --test shared/multiplayer.test.ts

dev:
	npm run dev

server:
	npm run server

server-dev:
	npm run server:dev

start:
	npm run start

docker-build:
	docker build -t wizard-arena .

docker-run:
	docker run --rm -p 3000:3000 wizard-arena
