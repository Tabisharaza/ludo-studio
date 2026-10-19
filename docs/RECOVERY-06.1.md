# Build 06.1 · Accurate room recovery

## Reproduced defect

On Build 06, a server 404 for an expired/missing room left the UI at “Connection paused” with “Your seat is saved,” and scheduled another state poll after 1.8 seconds. Reload also discarded the definitive 404, restored the saved board as disconnected and promised recovery. Both cases were reproduced with the actual production app and focused assertions before the fix.

## Narrow fix

- Room 404 and invalid-session 401 terminate that tab’s recovery. Missing-seat 403 is identified with additive `errorCode: seat_missing` metadata so normal forbidden-turn and origin errors are not mistaken for invalid seats.
- Boot, polling and action responses share the same classification. Terminal status stops timers and animation, clears pending action retries, and removes only the invalid room entry in session storage and stale URL fragment.
- The last board remains visible but cannot act or copy a dead invite. Accurate table/seat text and Create / join table replace futile Retry controls. Keyboard focus reaches recovery without stealing focus from an open dialog.
- Network failures, server 5xx and rate limits retain the saved seat. Retry keeps the same pending action ID. Late responses cannot resurrect a terminated session or invalidate a replacement table.
- No game rules, random-dice logic, TTL, session permissions, table capacity, dependencies or visual layout changed.

## Verification

136 checks: the previous 116 plus 18 production-app recovery regressions, one real-animation terminal-cancellation regression and one invalid-session API classification regression. Existing missing-seat and expiry API assertions now verify machine-readable metadata too. All tests and the bundled Worker build pass.

Recovery cases include active polling, reload, action failure, invalid seat, same-version recovery after transient failure, exact action-ID retry, wrong-turn 403, late-response races, new-table recovery and dialog focus preservation. The tests use actual production functions, deterministic DOM/transport fixtures and real in-memory SQLite. They do not certify real browser layout, native-dialog behavior or real-device accessibility. Earlier Build 06 browser observations remain scoped to that documented baseline.

## Separate follow-up

The keyboard review identified an existing lobby issue: Enter in the invite field uses the form’s first implicit submit button, Close, rather than Join. Join-click flow is covered; native Enter behavior is not browser verified. Addressing this and adding accessible dialog names is a separate focused milestone, not part of the recovery patch.
