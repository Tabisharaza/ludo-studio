# Ludo Studio

Original responsive Ludo for 2–4 people, locally on one screen or online in invite-only tables on a public website. No accounts, chat, ads, diamonds, payments or external assets. Fixed color aliases, server-generated dice, and a pure shared rules engine.

Play online: https://ludo-studio-sentinel.tabisharaza.chatgpt.site

## Development

Node.js 24 or newer. No dependencies to install.

    npm test
    npm run dev

Open http://localhost:8792. The development server uses Node's built-in SQLite and stores local room data in ignored `.local/`. `npm run build` bundles the frontend and API into a Cloudflare-compatible Worker. Hosted data uses the Sites-provisioned D1 binding `DB`, with the schema migration in `drizzle/`. GitHub Pages alone cannot run this backend; publish the source on GitHub and link the hosted game, or deploy the Worker to a compatible host.

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
- 11 API/security checks using real in-memory SQLite, with separate client sessions, concurrent joins/moves, stale writes, duplicates, reconnects, authorization and expiry
- 5 server-side checkpoint and bounded-event replay checks
- 6 independent frontend transport race checks
- 23 deterministic frame-clock dice/token animation and asynchronous interaction checks
- JavaScript syntax and bundled Worker module checks

On 14 October 2026, the deployed Build 04 was inspected in actual cloud Chromium at approximately 1165px viewport width. Two naturally rolled consecutive sixes displayed the 3D rolling overlay and matching settled faces. A yard release and six-square path move were observed at intermediate and final positions, with controls locked during playback. This is a scoped desktop check; mobile/tablet devices, full-game browser play, capture/rollback browser playback and assistive-technology checks remain unverified.

## Future mobile apps

A web app manifest and scalable icon are included. This is a responsive web game, not an App Store or Play Store submission. Native packaging, device testing, privacy/store disclosures, developer accounts and review remain separate release work.

## Visual direction and animation

The redesigned interface uses a midnight-green tabletop, raised ivory/enamel board, original SVG pawns, player seats around the board, a mobile-first move picker, and a six-face CSS 3D die. The die lifts and tumbles while awaiting the server, then settles to the authoritative lastRoll. Repeated identical results animate separately; reduced-motion preference removes tumble/bounce.

Design research used public examples as references only; no third-party game assets or paid component code are included:
- Ludo King UI references: https://flomob.com/discover-games/ludo-king-40
- Dice motion reference: https://www.framer.com/marketplace/components/dice-rolling/
- CSS 3D guidance: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/transform-style

The original SVG board and pawns were initially inspected with Inkscape. The subsequent live Chromium desktop inspection is described under Verification.

## Motion edition (build 04)

Dice and token animations use a deterministic frame driver with requestAnimationFrame and a timer fallback, without requiring the Web Animations API. A visible roll stage stays on screen through tumble, settle and result. The die itself and the Roll button are both interactive. Motion defaults to Auto (respecting system reduced-motion preference), with explicit Full and Reduced options. Reduced mode keeps clear rolling/result feedback without travel or tumble.

Tokens hop square by square along the actual path, launch from the yard, return after capture, visibly arrive at home before hiding, and rewind only post-checkpoint changes. Server-provided sanitized action events retain the latest 32 actions, so online clients can replay a roll and move received together. Input stays locked through playback; newer room versions queue. If history cannot be safely replayed or is too long, the client reconciles to authoritative state rather than inventing actions. Module URLs are versioned to distinguish this build from cached earlier clients.
