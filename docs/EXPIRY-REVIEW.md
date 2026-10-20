# Expiry boundary and gameplay review

## Defect and fix

At exactly a room's expiry timestamp, Create rejected the old row as reusable (`expires > now` was false), but cleanup only removed rows strictly before now. `INSERT OR IGNORE` then retained the old row and returned success; the next state request correctly rejected it as expired. Cleanup now uses `expires <= now`, matching the API validity rule.

## Regression evidence

The new SQLite-backed regression failed before the fix and passes after it. Six authoritative tests cover one millisecond before expiry, exact expiry, after expiry, simultaneous same-token creation retries, lost capture-response recovery and a lost exact-six victory response. No database migration or custom-rule change is required.

Six independent gameplay property groups exercise 51,526 deterministic cases across supported seats, positions, dice and locks. Coverage includes safe-square capture behavior, committed capture checkpoints, serialization, exact finishes and unusable-six rollback. The capturing token, not the captured opponent, is locked for the remaining bonus-roll chain.

All 157 test groups/checks pass locally, and the Worker build succeeds. The case count is not 51,526 distinct test suites. The new tests run through the standard `npm test` command. CI and hosted deployment must be verified separately; this document does not claim live exact-expiry reproduction or mobile testing.
