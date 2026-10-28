# Ludo Studio

Original responsive Ludo for 2–4 people, locally on one screen or online in invite-only tables on a public website. No accounts, chat, ads, diamonds, payments or external assets. Fixed color aliases, server-generated dice, and a pure shared rules engine.

Play online: https://ludo-studio-sentinel.tabisharaza.chatgpt.site

## Keyboard lobby patch (Build 06.2)

Pressing Enter in the invite input now submits Join and runs the same validation as clicking it. Join has its own native form, separate from Close/Create, and both dialogs have accessible names tied to their visible headings. Explicit Close, Escape and existing game/session behavior are retained.

[Patch details](docs/KEYBOARD-06.2.md). All 145 automated checks and the Worker build pass. The pre-patch Enter-to-Close defect was also reproduced in cloud Chromium. The automated fixture alone does not establish native-browser keyboard behavior or overall accessibility compliance.

## Room recovery patch (Build 06.1)

Expired or missing tables and invalid seat sessions now stop reconnecting and offer an accurate Create / join table path. Only the invalid tab session is removed; the last board remains visible. Temporary network/server failures keep the saved seat and safe same-action retry. Ordinary turn conflicts do not invalidate a seat. Server error metadata is additive; game rules, dice, expiry duration and authoritative validation are unchanged.

[Patch evidence and scope](docs/RECOVERY-06.1.md). All 136 automated checks and the Worker build pass. Terminal recovery is covered with the production app in deterministic DOM/transport fixtures and real in-memory SQLite API tests; this is not a claim of browser or real-device terminal-expiry testing.

## Clear play (Build 06)

Move cards now explain captures, safe squares, exact finishes and blocked pieces. Hover or focus a legal choice to preview its actual route. Visible turn cues, your-seat labels, open-seat indicators and pasted invite links make online tables easier to follow. All custom rules and the authoritative server remain unchanged.

[Implementation and official product references](docs/BUILD-06.md). Build 06 has 116 automated checks, including 7,500 seeded engine/presentation comparisons. Live cloud Chromium verified Build 06 table creation, allowed-origin invite joining and foreign-link rejection, two-client turn/move synchronization, same-tab seat recovery, keyboard destination/path previews, disabled-choice reasons and the corrected full action dock at 1188 × 761. Mobile/tablet rendering and complete-game real-device testing remain unverified. The Build 05 observations below are historical.

## Arena edition (Build 05)

A compact violet game arena replaces the editorial page: saturated red/green/yellow/blue board, corner player pods, integrated dice/action dock, reduced-motion setting, and large legal-piece shortcuts. Mobile safe-area and landscape layouts are implemented. The custom rules and authoritative multiplayer are unchanged.

On 19 October 2026, actual cloud Chromium inspection verified the desktop arena, 3D rolling overlay, online two-client room creation/join, turn synchronization, and same-tab reconnect. A below-fold action dock was found and corrected in deployment version 6. Mobile emulation was blocked by browser organization policy; mobile/tablet rendering, full-game browser play, and real-device touch/accessibility testing remain outstanding.

## Development

Use Node.js **24.22.1**, pinned in `.node-version`, as the recommended development and CI security/toolchain baseline. The [October 21, 2026 security release](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases) includes the eMudhra CA remediation and other security fixes; see the [24.22.1 release notes](https://nodejs.org/en/blog/release/v24.22.1).

The unchanged `package.json` declaration, `engines.node: ">=24"`, is a compatibility range, not the security baseline or a claim that every matching version has those fixes. Select 24.22.1 before running the commands below. No dependencies to install.

    npm test
    npm run dev

Open http://localhost:8792. The development server uses Node's built-in SQLite and stores local room data in ignored `.local/`. `npm run build` bundles the frontend and API into a Cloudflare-compatible Worker. Hosted data uses the Sites-provisioned D1 binding `DB`, with the schema migration in `drizzle/`. GitHub Pages alone cannot run this backend; publish the source on GitHub and link the hosted game, or deploy the Worker to a compatible host.

For managed preview (or a different local port), the development adapter accepts:

    npm run dev -- --host 127.0.0.1 --port 4173 --strictPort

The default remains port 8792 on loopback. Only `127.0.0.1` is accepted as the bind host; no public-network binding is enabled. Ports are always strict: an occupied port exits with an error rather than selecting another. Invalid, repeated, or unknown options fail before loading the Worker or creating a local database. The development adapter and its flags do not change the hosted Worker. See [the preview-harness repair evidence](docs/DEV-PREVIEW-REVIEW.md).

## Custom rules

- Six starts a yard piece or moves an eligible piece six steps.
- Every roll must be used. A capture permanently commits the board. An unusable result rolls back only moves after the most recent capture; before any capture, it rolls back the whole current turn. Captured pieces stay in the yard.
- Capturing grants a bonus roll, but the capturing piece is locked for the rest of the turn. Use another piece; a six may bring another yard piece into play.
- Six and capture each grant a bonus, but a capturing six grants one bonus, not two. Three consecutive sixes roll back moves after the latest capture, or the whole turn before any capture.
- Finishing requires the exact number. A non-final finish earns no bonus. An exact fourth-piece finish closes the game immediately; all rolled values have been consumed and no further bonus is owed.
- Starts and ring-marked squares are safe. Shared squares are allowed, with no blockades.

## Online transport

Room sessions expire after 24 hours. Random room-scoped seat keys remain in the browser's session storage; only SHA-256 hashes are stored server-side. Room invitation codes reveal no seat secret. Rejoin/reload in the same tab recovers the seat. Closing the tab may lose the seat, so keep it open for the game.

The server is authoritative: clients cannot choose dice, submit a board, move another seat, or overwrite a newer version. Compare-and-swap writes resolve races; action IDs prevent duplicate moves on network retries. Short polling pauses in background tabs. Room creation/join retries reuse the same temporary session so lost responses do not consume another seat. Origin checks, small request limits, per-isolate best-effort throttling and an active-room cap are included. This is not a substitute for managed abuse protection at large scale.

Rooms are inaccessible after expiry. Expired records are removed on new room creation. No analytics are collected by the app; hosting infrastructure can maintain ordinary network logs.

## Verification

- 11 core tests, including 500 simulated complete games
- 16 independent custom-rule checks
- 12 API/security checks using real in-memory SQLite, with separate client sessions, concurrent joins/moves, stale writes, duplicates, reconnects, authorization and expiry
- 5 server-side checkpoint and bounded-event replay checks
- 6 independent frontend transport race checks
- 24 deterministic frame-clock dice/token animation and asynchronous interaction checks
- 61 arena keyboard, form-ownership, recovery, motion-preference, polling, preview, invitation and keyboard-focus regression checks
- 21 move-guidance, seeded consistency, invitation parsing and turn-cue checks
- 6 independent gameplay properties over 51,526 deterministic cases
- 13 authoritative expiry/reconnect checks, including exact-boundary creation, delayed old-room writes, same-incarnation contention and safe retries
- 11 authoritative request-boundary checks, including concurrent capacity admission, same-token retries, expiry cleanup, sanitized SQL failures and strict ID types
- 24 development-preview argument and server checks
- JavaScript syntax and bundled Worker module checks

210 automated checks in total. GitHub Actions reads the exact Node.js version from `.node-version` (24.22.1), asserts the actual runtime matches, and runs the same tests and build with read-only permissions; no dependency installation is needed. This pins the Node.js used by project commands, not the GitHub runner's separate action runtime or the hosted Cloudflare Worker runtime; neither environment is patched or redeployed by this change.

Local verification on October 23, 2026 with Node.js 24.22.1: all 157 checks, 21 JavaScript module syntax checks and the Worker build passed; repeated builds were byte-identical. These local results do not establish hosted CI, deployment, or new browser/device coverage.

Earlier local-browser setup was blocked. The later scoped Chromium results and remaining device limits are documented above.

## Future mobile apps

A web app manifest and scalable icon are included. This is a responsive web game, not an App Store or Play Store submission. Native packaging, device testing, privacy/store disclosures, developer accounts and review remain separate release work.

## Visual direction and animation

Build 04 used a midnight-green tabletop, raised ivory/enamel board, original SVG pawns, player seats around the board, a mobile-first move picker, and a six-face CSS 3D die. The die lifts and tumbles while awaiting the server, then settles to the authoritative lastRoll. Repeated identical results animate separately; reduced-motion preference removes tumble/bounce.

Design research used public examples as references only; no third-party game assets or paid component code are included:
- Ludo King UI references: https://flomob.com/discover-games/ludo-king-40
- Dice motion reference: https://www.framer.com/marketplace/components/dice-rolling/
- CSS 3D guidance: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/transform-style

The actual SVG board and pawns were rendered with Inkscape for component-level visual inspection. Later desktop layout and animation observations are described in the Arena edition section.

## Motion edition (build 04)

Dice and token animations use a deterministic frame driver with requestAnimationFrame and a timer fallback, without requiring the Web Animations API. A visible roll stage stays on screen through tumble, settle and result. The die itself and the Roll button are both interactive. Motion defaults to Auto (respecting system reduced-motion preference), with explicit Full and Reduced options. Reduced mode keeps clear rolling/result feedback without travel or tumble.

Tokens hop square by square along the actual path, launch from the yard, return after capture, visibly arrive at home before hiding, and rewind only post-checkpoint changes. Server-provided sanitized action events retain the latest 32 actions, so online clients can replay a roll and move received together. Input stays locked through playback; newer room versions queue. If history cannot be safely replayed or is too long, the client reconciles to authoritative state rather than inventing actions. Module URLs are versioned to distinguish this build from cached earlier clients.

## Expiry-boundary source fix (October 20, 2026)

The API now removes rooms at or before their expiry timestamp before attempting idempotent creation. This fixes a successful Create response returning an already-expired room at the exact 24-hour boundary. Custom gameplay rules are unchanged. See [expiry and gameplay review](docs/EXPIRY-REVIEW.md). This source fix is not yet verified on the hosted game; the previously verified keyboard/dialog release remains separate.

## Room-incarnation source fix (October 28, 2026)

Delayed joins/actions now match the original room expiry as well as code/version, preventing an old request from overwriting a recreated table. Missing or replaced rooms return terminal recovery instead of a replacement board or retryable failure. Seven new checks bring the local total to 164; custom rules and database schema are unchanged. See [reproduction, invariant and verification limits](docs/ROOM-INCARNATION-REVIEW.md). No new hosted deployment is claimed.

## Explicit move previews (source, October 28, 2026)

Preview 1–4 buttons let players inspect a route without hovering or committing a move. A selected preview stays visible until dismissed, replaced or invalidated; the existing piece cards still move on one click. Clear button labels, pressed state and a Dismiss preview action support keyboard and touch-oriented use. Eleven new production-app fixture checks bring the source total to 175. No rule, API or animation changes are included. See [scope and test evidence](docs/EXPLICIT-PREVIEW-REVIEW.md). Actual mobile layout/touch and native assistive-technology checks remain unverified; no new hosted deployment is claimed.

## Request-boundary fixes (source, October 28, 2026)

New tables now claim capacity inside the insert statement, preventing concurrent creates from exceeding the existing 2,000-room cap. Same-token retries still recover their table, including when another retry claimed the final slot. Tokens and action IDs must now be primitive strings rather than coercible arrays or objects. Eleven new checks bring the current local total to 210, including the 24 development-preview checks. See [reproduction, SQL contract and limits](docs/REQUEST-BOUNDARY-REVIEW.md). Valid-client behavior, game rules, seat ownership, schema and expiry duration are unchanged; no hosted deployment is claimed.
