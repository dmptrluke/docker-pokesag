# Changelog

## Unreleased

## 1.1.0 (2026-03-16)

### Changed

- Switched receiver from psycopg2 to psycopg (v3) for PostgreSQL access.
- Replaced global `running` flag with `threading.Event` for cleaner shutdown handling.
- Converted receiver Dockerfile to multi-stage build, removing build tools from the runtime image.
- Pinned multimon-ng to release tag 1.4.1 instead of building from HEAD.
- Hardcoded stats logging interval to 60 seconds (removed `STATS_INTERVAL` env var).
- Bumped CI action versions (checkout v6, buildx v4, login v4, build-push v7).
- Fixed Docker Hub image name from `pokesag-server` to `pokesag-receiver` in CI.

### Added

- Config file validation: empty channels, missing keys, and empty protocol lists now produce clear error messages at startup.
- Health monitoring for multimon-ng subprocesses; receiver exits for restart if a decoder dies.
- Added `restart: unless-stopped` to all services in docker-compose.yml.
- Added `.dockerignore` for the receiver build context.

### Removed

- Removed `STATS_INTERVAL` environment variable (was configurable, now fixed at 60s).
- Removed `netcat-openbsd` from receiver image (unused).

## 1.0.1 (2026-03-15)

### Changed

- General code polishing and cleanup. ([`7577d9a`](https://github.com/dmptrluke/docker-pokesag/commit/7577d9a))

## 1.0.0 (2026-03-12)

_Major release: new receiver backend, frontend overhaul, and modernized build tooling._

### Added

- Hover tooltips for annotated codes in messages.
- Hash-based color coding for recipient identifiers.
- Source filtering in search.
- RTL-SDR device selection by serial number (`RTL_DEVICE_SERIAL`).
- Container healthchecks for both receiver and web services.
- Mobile layout mode with responsive design overhaul.

### Changed

- **Breaking:** Replaced Lua-based receiver with Python/GNURadio backend; configuration now uses `channels.json` instead of individual env vars.
- Replaced webpack with esbuild for frontend bundling.
- Upgraded to Node 22.
- Redesigned UI with darker theme, higher contrast, and react-bootstrap-icons.

### Removed

- Removed CodeQL analysis workflow.
