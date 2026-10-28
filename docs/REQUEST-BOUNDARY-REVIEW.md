# Request-boundary fixes

Reviewed source: `eb1c6482e751037ef28baa45a849f56553c3028a`, verified against the remote main tree on October 28, 2026. All tests use synthetic data in in-memory SQLite; no hosted endpoint or production database was exercised.

## Reproduced capacity failure

Creation previously checked `SELECT COUNT(*)` before a separate `INSERT OR IGNORE`. With 1,999 unexpired synthetic records, two different-token Create requests were paused immediately before their inserts. Both had passed the capacity check. Releasing them produced two HTTP 200 responses and 2,001 stored rooms, exceeding the intended 2,000-room cap.

`server-boundary-review.mjs` deterministically exercises that interleaving. The final-slot test fails against the old source (`[200, 200]` rather than `[200, 503]`), without relying on timing or load generation.

## Capacity change and invariant

The capacity predicate now belongs to the write:

```sql
INSERT OR IGNORE INTO rooms (code, data, version, expires)
SELECT ?, ?, 0, ? WHERE (SELECT COUNT(*) FROM rooms) < 2000
```

For a database at or below capacity, each successful new insertion observes and claims a remaining slot within one statement. Existing expiry cleanup is unchanged. The subsequent code lookup distinguishes a capacity rejection from an already-created same-token room, so two retries can both succeed after one claims the final slot. No schema migration, explicit transaction API, dependency, gameplay or seat-ownership change is required.

[Cloudflare documents D1's SQLite query engine and SQL conventions](https://developers.cloudflare.com/d1/sql-api/sql-statements/). SQLite supports [INSERT from SELECT](https://www.sqlite.org/lang_insert.html) and executes statements within [transactions with only one simultaneous writer](https://www.sqlite.org/lang_transaction.html). The local fixture executes the actual prepared SQL, not a string-matched emulation. Hosted D1 execution remains unverified.

## Reproduced ID type-coercion failure

The token and action-ID regexes implicitly converted JSON arrays to strings. A single-element token array was accepted like its contained string. An action-ID array also committed successfully, but an exact retry returned 409 instead of idempotent 200 because two arrays do not match by identity. The existing version guard still prevented a duplicate mutation; this is not an authentication bypass. Objects with non-callable coercion properties could also fall through to a generic 503 instead of the intended validation response.

Both fields now require primitive strings before regex evaluation. Invalid token types retain the existing 401 `invalid_session` response, and invalid action-ID types receive the existing 400 response. Valid string tokens, seat hashes, ID format and successful replay behavior are unchanged. Red tests independently confirmed array tokens returned 200 instead of 401 and array action IDs returned 200 instead of 400 before their corresponding guards were added.

## Verification

Eleven new regression groups cover:

1. Two distinct requests below capacity both succeed.
2. Two distinct requests competing for the final slot yield one success and one capacity response.
3. A new request at capacity changes no existing record.
4. Concurrent same-token requests share the final slot and both succeed.
5. An existing same-token retry at capacity preserves its original room.
6. Expired records, including the request's own expired room, release capacity for recreation.
7. An insert failure returns a sanitized retryable error without consuming the slot.
8. A lost result after a committed insert recovers idempotently at capacity.
9. Non-string tokens, including arrays and objects, reject on all four routes before database access.
10. Non-string action IDs reject without changing stored state, version or replay history.
11. Primitive-string tokens and action IDs preserve successful same-action retries without a second write.

Local Node.js 24.22.1: all 210 test groups pass (199 existing plus 11 new), including the existing 51,526 deterministic gameplay cases. JavaScript syntax checks, the bundled Worker import/build, and byte-identical repeated builds pass.

This is a source-level request-boundary fix. It does not add distributed rate limiting, change seat ownership or token hashing, establish browser/device coverage, or claim a hosted deployment or hosted CI result.
