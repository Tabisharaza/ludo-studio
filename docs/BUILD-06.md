# Build 06 · Clear play

## References reviewed on 19 October 2026

Official store descriptions, used for product reference only:

- [Ludo King, Gametion](https://play.google.com/store/apps/details?id=com.ludo.king): local/online play, friend invitations, save/load and accessibility to lower-end devices are useful priorities.
- [Ludo Club, Moonfrog](https://apps.apple.com/us/app/ludo-club-fun-dice-board-game/id1267900294): quick social multiplayer and clear 2/4-player choices reinforce making table setup easy.
- [Ludo STAR, Gameberry](https://apps.apple.com/gb/app/ludo-star/id1198143062): animated dice and friend play reinforce lively but understandable game feedback.

These are widely used reference products, not a verified global ranking. No game assets, branding, code, monetization, chat or currencies were copied. This milestone preserves the original board and all existing custom rules. No changes were made to the rules engine or server API.

## Implemented

- Four consistently positioned piece cards show legal outcomes and why other pieces cannot move.
- Hovering or keyboard-focusing a legal piece traces its real board route and destination. Previews never mutate game state or send a move.
- Capture count, safe landing, yard release, protected home lane, exact home and game-winning finish each have precise descriptions derived from the engine.
- Capture-locked pieces clearly explain the need to use another piece.
- Persistent turn cues distinguish local pass-and-play, your online turn, another player's turn, unfilled seats and connection recovery.
- Your online seat is labeled YOU; unfilled seats are visibly marked as waiting. Joined seats are not claimed to be currently connected.
- The join form accepts full invite links or grouped/spaced 16-character codes. Links must use the production/current origin, root path and exact room fragment, with no userinfo or query data. Parsing does not visit pasted URLs.
- Keyboard entry cannot start fresh actions while disconnected or a dialog is open. Focus skips disabled cards after a roll.
- Larger mobile text and controls, responsive two-column move cards, reduced-motion-safe destination feedback.

## Verification

116 automated checks: 85 previous checks, 10 additional production-app UI/transport regressions, and 21 pure presentation/invite tests. The seeded guidance check compares legality, destinations and captures with the unchanged engine over 7,500 iterations across 2/3/4-player games. Existing tests also simulate 500 complete games and cover authoritative room races, capture checkpoints, rollback, motion and keyboard focus.

Automated DOM fixtures do not prove actual CSS rendering. Browser observations for this release are recorded in README when completed. Mobile emulation was previously denied by browser organization policy and is not retried; no mobile or real-device QA is claimed.
