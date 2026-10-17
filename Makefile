.PHONY: test lint build dev start docker-build docker-run

# Runs the repository's offline-capable checks after dependencies are installed.
test: lint build

lint:
	npm run lint

build:
	npm run build

dev:
	npm run dev

start:
	npm run start

docker-build:
	docker build -t wizard-arena .

docker-run:
	docker run --rm -p 3000:3000 wizard-arena
