.DEFAULT_GOAL := help
.PHONY: help install api ui test data data-docker build docker

help:            ## list the commands
	@grep -E '^[a-z-]+:.*##' $(MAKEFILE_LIST) | sed 's/:.*##/  -/'

install:         ## install backend and frontend dependencies
	cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
	cd frontend && npm ci

api:             ## run the API on :8000 (needs `make data` first, or set REQUIRE_REAL_DATA=0 for demo data)
	cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000

ui:              ## run the React dev server on :5173 (talks to the API on :8000)
	cd frontend && npm run dev

test:            ## run backend and frontend tests
	cd backend && .venv/bin/pytest -q
	cd frontend && npm test

data:            ## download January 2026 from Elexon into backend/data/snapshot
	cd backend && .venv/bin/python -m app.ingest

data-docker:     ## same as `data`, inside Docker
	LOCAL_UID=$$(id -u) LOCAL_GID=$$(id -g) docker compose --profile tools run --rm ingest

build:           ## build the React app (frontend/dist)
	cd frontend && npm run build

docker:          ## build and run the production image on :8000
	docker compose up --build
