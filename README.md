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
| `just dev` | Start a local dev server with hot-reloading frontend |
| `just build` | Run tests then produce `dist/Uke.zip` (Apple Silicon) |
| `just test` | Run the Playwright E2E test suite |
| `just frontend` | Build the frontend bundle only |
| `just clean` | Remove all build artifacts |

## Challenges

### 1. Multi-pack Handling 

Products like the 'Drop 002 Coffee Pack' represent three individual bags of coffee, but Shopify returns them as a single line item with no metadata indicating what's inside. The app expands packs into their component coffees before aggregating.

Pack contents — along with per-product bag weight overrides — live in [`frontend/src/config.json`](frontend/src/config.json), which is bundled into the app at build time. To add a new pack, append an entry to `packs` (the `title` is matched case-insensitively against the Shopify line-item title) and run `just frontend` — no code change needed:

```json
{
  "title": "Drop 004 Coffee Pack",
  "contents": ["Coffee One - Origin", "Coffee Two - Origin"]
}
```

Products default to 200g bags; anything different needs an entry in `baseWeights` (matched as a case-insensitive substring of the product title).

### 2. Cross-platform development

The app is built for a MacBook user, but development happens on Linux. Go's cross-compilation handles the hard part — `just build` produces an Apple Silicon binary from Linux without any extra tooling — but it means the final binary can rarely be run locally to manually verify a release. The Playwright test suite exists partly to compensate for that, catching regressions that would otherwise only surface on the target machine.

