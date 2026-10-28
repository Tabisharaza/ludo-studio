# Explicit move previews

## Source-backed interaction gap

Before this change, a route could be inspected by hovering or keyboard-focusing a piece. Clicking the same piece immediately played it. There was no separately labeled Preview action for someone using touch or otherwise unable to hover. This was established from production event handlers, not claimed as a native-device failure.

## Bounded presentation change

- Four separate Preview buttons mirror the four existing piece choices; illegal choices cannot be previewed. There are no nested buttons and the existing piece cards still move on one click.
- Selecting Preview draws the existing engine-derived route and description without mutating state, persisting a game change or making a network request.
- The explicit selection survives pointer exit/blur and unchanged room polling. Another Preview replaces it; pressing the selected button again or Dismiss clears it.
- Pressed state and specific accessible names identify the inspected piece. Dismiss restores focus to its Preview button without activating Move. Descriptions use a polite live region.
- Renders invalidate the selected route, including changed room versions, legal moves, state, disconnection and terminal recovery. Animation cancellation and opening a dialog also clear it. Stale event handlers recheck current legality and availability.
- Preview controls have 44-pixel minimum-height targets and a separate grid row. This introduces additional vertical content; no viewport-fit or no-scroll guarantee is made without native layout review.
- Game rules, API, dice and token animations, local/online Move behavior and underlying replay mechanics are unchanged.

## Verification

Eleven additional production-app fixture tests cover local/online no-mutation/no-request preview behavior, pointer/blur persistence, toggle/dismiss focus, first-click Move, unchanged/new-version polling, stale controls, illegal/unavailable states, dialogs, focused-control restoration, semantic markup, target-size/hidden styles and reduced motion.

The original source fails the first new explicit-control regression. All 175 checks/groups now pass, including the unchanged six gameplay groups containing 51,526 deterministic cases. Those cases are not additional test suites. Source syntax checks and the bundled Worker build pass on Node.js 24.22.1.

The fixtures run actual production handlers with a modeled DOM; they do not certify native mobile touch, CSS layout, screen-reader announcements or assistive-technology behavior. No browser restriction was bypassed, and no hosted deployment is claimed.
