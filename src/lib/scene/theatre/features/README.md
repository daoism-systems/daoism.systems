# Theatre.js scene state — per platform

Two full Theatre Studio exports drive the scroll-bound scene. Platform is
detected at page load and the matching JSON is fed to `getProject(...)` —
no merging, no overlay; refresh to switch.

| File           | Used when                    |
| -------------- | ---------------------------- |
| `desktop.json` | Non-mobile clients (default) |
| `mobile.json`  | `detectMob()` returns true   |

## Updating state from Studio

1. Load the page with `?debug=true` on the platform you're tuning (use device emulation in DevTools to hit `mobile.json`).
2. Tweak values / keyframes in Studio.
3. Studio menu → **Project → Export `dao-scene` to JSON** → save the file.
4. Overwrite the matching JSON above with the export's contents — the file format is the literal Studio output, no wrapper or transformation.
5. Commit. Page-refresh-only pickup; no HMR.

## What lives where

- All animated tracks (PostProcessing, FluidSimulation, Lighting, GroundFog, particles, etc.) exist in **both** files. After tuning desktop, copy the same keyframe edits over to `mobile.json` if they should apply on mobile too — there is no automatic propagation.
- The `Scroll` object holds Lenis lerp/multiplier values + virtual scroll height for that platform only. Each file's `Scroll.staticOverrides` carries its own values.

## Theatre objects

Each top-level Studio object maps to a registration in `src/lib/scene/theatre/TheatreController.ts` and a backing class:
