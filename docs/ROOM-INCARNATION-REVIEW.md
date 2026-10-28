# Delayed requests across room recreation

## Reproduced defect

Room codes are deterministic for a creator session, and a recreated room restarts its version at zero. A request that read an old room just before expiry could resume after recreation and match the new room's code/version. The old join then replaced a new four-seat lobby with the previous two-seat lobby. An old guest's delayed action could restore the previous board and seats, removing the replacement guest. These were reproduced with the production API and real in-memory SQLite, without a browser or hosted mutation.

When a version mismatch already prevented the write, the conflict response could still return the replacement room using the old guest's seat index. Deletion during an action instead caused a retryable 503 rather than a terminal room-unavailable response.

## Narrow fix and invariant

Join/action compare-and-swap writes now also match the original room expiry. Expiry is immutable within a room incarnation: only Create replaces an expired row, replacement requires old expiry <= now, and the new expiry is now + the positive 24-hour TTL. Therefore replacement expiry is strictly greater than the previous expiry, including exact-boundary and simultaneous fixed-clock retries. There is no sliding-expiry update or other version reset in the current API.

After a rejected write, a missing, expired or different-incarnation row returns the existing terminal 404/errorCode room_unavailable without a replacement board. Normal same-incarnation contention still returns 409 and authoritative state; an acknowledged action's retry remains idempotent.

If future work changes expiry renewal, permits early room replacement, or resets versions in place, this invariant must be reconsidered, preferably with an explicit immutable generation identifier. This patch does not change TTL, credentials, database schema, custom turn rules, or the existing treatment of requests that cross expiry without recreation/deletion.

## Checks

- Five new race/terminal regressions fail against the unmodified source and pass with the fix.
- Two additional controls cover strictly increasing expiry across repeated recreation with same-clock retries, and same-incarnation concurrent action/retry behavior.
- Full npm test: 164 checks/groups, including the unchanged six gameplay property groups covering 51,526 deterministic cases. The case count is not additional test suites.
- Node.js 24.22.1 syntax checks and bundled Worker build pass.

These are local source checks, not deployment, hosted CI, native-browser, mobile-device or live race verification. No hosted room was changed.
