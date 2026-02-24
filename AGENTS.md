# AGENTS.md

Guidance for coding agents working in this repository.

## Project Snapshot

- Stack: Node.js + Express backend, vanilla HTML/CSS/JS frontend.
- Entry point: `server.js`.
- Static client assets: `public/index.html`, `public/styles.css`, `public/app.js`.
- Package manager: `npm` (`package-lock.json` present).
- Runtime port: `PORT` env var, default `5050`.
- Product focus: **mobile-centric Git review UI** with desktop support.

## Repository Rules Sources

- Cursor rules: none found (`.cursor/rules/` not present, `.cursorrules` not present).
- Copilot rules: none found (`.github/copilot-instructions.md` not present).
- If these files are added later, treat them as high-priority instructions and update this file.

## Setup And Run Commands

Run from repository root: `/Users/sergioghislergomez/Documents/projects/openreview`.

```bash
npm install
npm start
```

Open `http://localhost:5050`.

Useful alternatives:

```bash
npm run dev
PORT=6060 npm start
```

## Build / Lint / Test Commands

Current `package.json` scripts:

- `npm start` -> starts server (`node server.js`).
- `npm run dev` -> same as start.

Important current state:

- No dedicated `build` script.
- No dedicated `lint` script.
- No dedicated test runner script (`npm test` not configured).
- No test files found (`*.test.*` / `*.spec.*` not found).

Agent behavior for validation in this repo:

1. For now, validate by running `npm start` and exercising affected endpoints/UI paths.
2. If you add linting/tests, also add scripts in `package.json` and update this section.
3. Prefer lightweight checks that fit current stack (vanilla JS + Express).

### Single-Test Guidance (When Tests Are Added)

Because no framework is configured yet, use the runner-specific pattern once introduced:

- Node test runner: `node --test path/to/file.test.js`
- Vitest: `npx vitest run path/to/file.test.ts`
- Jest: `npx jest path/to/file.test.js`

If you introduce one of these, add a canonical script such as:

- `"test": "<runner>"`
- `"test:single": "<runner> <path-pattern>"`

## Architecture Notes

- `server.js` contains all API routes and utility helpers.
- Server executes Git/GitHub CLI via `child_process.spawn` (`runCommand`).
- Frontend state and interactions are centralized in `public/app.js`.
- Styling and responsive behavior live in `public/styles.css`.
- Mobile behaviors include drawer sidebar, pull-to-refresh, swipe stage/unstage, diff panel transitions.

## Code Style Guidelines

### JavaScript / Node Conventions

- Use `const` by default; use `let` only when reassignment is required.
- Prefer small pure helper functions for parsing/transforms.
- Keep route handlers thin: validate input -> call helper -> return JSON.
- Use async/await (existing style) instead of raw Promise chaining where practical.
- Prefer early returns for invalid states.
- Keep function names verb-first and descriptive:
  - `ensureDirectory`, `getProjectSnapshot`, `loadOpenPrsForActiveProject`.

### Imports

- Server uses CommonJS (`require`), not ESM.
- Group Node built-ins first, then external modules.
- Keep import list stable and minimal; remove unused imports.

### Formatting

- Follow existing formatting (2-space indentation, semicolons, double quotes).
- Keep lines readable; break long argument arrays/objects across lines.
- Preserve existing quote style in touched files.
- Avoid introducing formatting-only churn in unrelated code.

### Types And Data Shapes

- This repo is JavaScript-only (no TypeScript).
- Preserve response shape stability for frontend/server contracts.
- When adding new payload fields, update both server route and frontend consumption.
- Use explicit boolean coercion when intent matters (e.g., `Boolean(...)`).
- Parse numeric values defensively (e.g., `Number.parseInt(..., 10) || 0`).

### Naming

- Use lowerCamelCase for variables/functions.
- Use UPPER_SNAKE_CASE for constants (`STORAGE_KEY`, thresholds, limits).
- Use clear state object names in client code (`actionState`, `worktreeState`).
- DOM element refs should end with `El` where already established.

### Error Handling

- Wrap route handlers in `try/catch` and return JSON errors consistently.
- Use HTTP 400 for user/input issues, 500 for unexpected failures.
- Prefer actionable, user-facing error strings.
- Preserve existing fallback patterns for command incompatibility (e.g., restore -> reset fallback).
- Do not swallow errors silently unless intentionally degrading (and consistent with file style).

### Security And Shelling Out

- Only execute trusted commands through `runCommand`.
- Keep command + args split (avoid shell string concatenation).
- Validate and normalize user-provided paths (`ensureDirectory`, `path.resolve`).
- Continue using constrained `okExitCodes` for commands that can validly return non-zero.

## Mobile-Centric UI Requirements (Important)

- Treat mobile behavior as first-class, not an afterthought.
- Preserve `@media (max-width: 980px)` interactions when modifying layout.
- Keep touch gestures working:
  - swipe-to-stage/unstage in file list,
  - pull-to-refresh in panel content,
  - sidebar drawer open/close and scroll locking.
- Ensure tap targets remain usable on small screens.
- Avoid desktop-only assumptions for hover/precision pointer behavior.
- Validate both file-list and diff views on mobile when touching navigation logic.

## API And UI Change Checklist

- If changing API payloads, update frontend reads/writes in `public/app.js`.
- If changing Git behavior, verify command exit code handling and user messaging.
- If changing mobile UI, manually test sidebar, diff transition, pull-to-refresh, and swipe actions.
- If adding dependencies/scripts/tooling, update `README.md` and this `AGENTS.md`.

## File Touch Priorities

- Prefer minimal diffs in `server.js` (large file, many endpoints).
- In `public/app.js`, avoid global regressions by scoping state updates.
- In `public/styles.css`, keep variable-driven theming and responsive sections coherent.

## What To Avoid

- Do not introduce TypeScript without explicit request.
- Do not add heavy frameworks for simple UI behavior already handled in vanilla JS.
- Do not break offline/local-first assumptions (app is for local machine workflows).
- Do not remove mobile interaction affordances to simplify desktop layout.
