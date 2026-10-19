.PHONY: test lint build css-check dev start docker-build docker-run

# Runs the repository's offline-capable checks after dependencies are installed.
test: lint build css-check

lint:
	npm run lint

build:
	npm run build

css-check:
	node scripts/check-built-css.mjs

dev:
	npm run dev

start:
	npm run start

docker-build:
	docker build -t wizard-arena .

docker-run:
	docker run --rm -p 3000:3000 wizard-arena
