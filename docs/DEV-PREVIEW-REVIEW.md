# Development preview argument compatibility

## Reproduced defect

The managed preview daemon invoked the existing development script with
`--host 127.0.0.1 --port 4173 --strictPort`. The script ignored all arguments,
listened on its hardcoded port 8792, and preview startup timed out without
returning a browser URL. No browser access denial or warning was encountered
in that attempt. No alternate route or manual server was used for browser QA.

## Bounded repair

The development script now accepts those separated arguments, validates before
loading the Worker or opening SQLite, and uses the requested port for both the
listener and request origin. Defaults remain `127.0.0.1:8792`.

Only `127.0.0.1` is permitted as the host. This does not enable LAN/public binding,
change sandbox/network permissions, or expose the development database. Port
values must be canonical positive decimal integers from 1 through 65535. Every
flag is single-use; unexpected options fail. Ports are always strict, whether
or not `--strictPort` is explicitly present. Address-in-use errors exit nonzero;
there is no automatic fallback port.

No hosted Worker, API, engine, UI, credential, dependency or deployment change.
The displayed/request origin now uses `127.0.0.1` rather than `localhost`; current
Worker behavior routes by pathname and no cookie/origin behavior depends on this
host spelling. Existing `http://localhost:8792` access still reaches the default
loopback listener when localhost resolves normally.

## Checks

- 24 new development-adapter tests: argument defaults/order/bounds, rejected
  network hosts, duplicate/unknown/missing flags, custom-port real HTTP request
  origin, occupied-port strict error, and invalid arguments before DB/Worker load.
- Integration tests use isolated temporary SQLite directories and clean up their
  subprocesses/listeners. They are not browser tests or public room operations.
- All 199 test groups pass (175 existing plus 24 new), including the existing
  51,526 embedded gameplay cases. The Worker build passes with no new dependencies.
- Three integration regressions fail against the original dev script: requested
  port readiness, strict occupied-port handling, and invalid arguments before load.
- Independent review passed the full suite/build and 26 additional parser probes.
- Browser QA, deployment and actual touch/assistive-technology observations must
  be recorded separately; this source repair alone does not establish them.

## Actual supported desktop preview check (October 28, 2026)

After the repair passed independent review, one supported managed-preview retry
returned `http://127.0.0.1:4173/`, and the exact URL opened successfully in cloud
Chromium. This was a local preview of the published explicit-Preview UI plus
this unpublished development-adapter repair; the four built distribution files
were byte-identical to the published Preview baseline.

Observed through native browser actions and screenshots:
- Local dice roll and reduced-motion selection worked.
- Preview displayed a route/pressed state while all four eligible pieces remained
  in their yard; Dismiss restored focus without moving a piece.
- Enter activated the focused Preview control. Opening and closing Rules cleared
  the pinned preview while preserving the pending legal move.
- One click on Move after Preview released exactly one piece, cleared the preview
  controls, and enabled the earned next roll.
- The board and action controls were usable at the available desktop viewport.
  The additional Preview row required vertical scrolling; this is not a claim
  that every control stays above the fold.

The local QA tab was closed and the managed preview was stopped afterward. No
public game or hosted deployment changed. Mobile emulation was not retried because
an earlier organization-policy restriction remains recorded. Actual mobile/touch,
assistive technology, online two-client preview behavior and full-game browser
play remain unverified by this pass. The existing automated interaction tests
cover additional stale-state and online transitions, not native-device behavior.
