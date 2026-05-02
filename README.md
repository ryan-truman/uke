# Uke

A fulfilment tool for [Uke Coffee](https://ukecoffee.com/). Pulls the week's unfulfilled Shopify orders and produces a summary of coffee varieties, grind sizes, and quantities — giving the warehouse a clear picture of what needs to go out the door.

## What it does

- Fetches unfulfilled orders from the Shopify API
- Aggregates orders by coffee product and grind type
- Expands bundle packs into their component coffees
- Surfaces any clothing/merch items separately
- Exports a formatted PDF summary ready to hand to the team

## Tech stack

- **Backend** — Go, served as a single binary that embeds the frontend
- **Frontend** — TypeScript compiled with esbuild, jsPDF for PDF generation
- **Testing** — Playwright (E2E), gitleaks (pre-commit secret scanning)

## Usage

| Command | Description |
|---|---|
| `make dev` | Start a local dev server with hot-reloading frontend |
| `make build` | Run tests then produce `dist/Uke.zip` (Apple Silicon) |
| `make test` | Run the Playwright E2E test suite |
| `make frontend` | Build the frontend bundle only |
| `make clean` | Remove all build artifacts |

## Challenges

**Pack expansion** is the trickiest part of the coffee summary. Products like the Drop 002 Coffee Pack represent three individual bags of coffee, but Shopify returns them as a single line item with no metadata indicating what's inside. The app hardcodes the pack contents and manually expands them before aggregating — which means every new bundle product requires a code change to stay accurate.

This makes the fulfilment summary brittle. If a new pack is released and the code isn't updated, it will either be missing from the summary entirely or counted incorrectly. On the next product release, the pack definitions will be pulled out into a config file so the app can adapt without a code change.

**Cross-platform development** adds friction throughout the workflow. The app is built for a MacBook user, but development happens on Linux. Go's cross-compilation handles the hard part — `make build` produces an Apple Silicon binary from Linux without any extra tooling — but it means the final binary can never be run locally to manually verify a release. The Playwright test suite exists partly to compensate for that, catching regressions that would otherwise only surface on the target machine.

## Notes

This project was a practical exercise in TypeScript and frontend development — areas that were completely new to me. The Go backend handles Shopify auth and serves the embedded frontend as a single self-contained binary.
