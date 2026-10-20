# Build 06.2 · Native keyboard joining

## Defect and scope

In Build 06.1, pressing Enter in the invite text field implicitly activated the first submit button in its form: Close. The lobby disappeared without validation or joining. This was reproduced in actual cloud Chromium before the fix, including focus returning to Invite friends.

Join now lives in a separate sibling form inside the same dialog. Its only submit button is Join. The submit handler synchronously prevents navigation, then uses the existing allowed-origin invitation parser and idempotent join flow. There is no custom keydown interception; native Enter, button activation and input-method behavior use the browser’s form semantics.

The original method=dialog form retains explicit Close and Create. Native Escape dismissal remains untouched. Both dialogs reference their visible heading via aria-labelledby. No game rules, session recovery, styles, dependencies or server code changed.

## Verification

145 automated checks, adding nine focused cases to the previous 136. These verify non-nested form ownership and default submitters, unique accessible-name references, synchronous navigation prevention, valid and invalid Join submission, server rejection, repeated-submit locking, explicit Close, independent Create and local/Rules controls. Invalid submissions retain the dialog and input focus in the production-app fixture.

The fixture does not emulate browser default actions or native dialog focus restoration. Those need scoped browser checks; these tests and accessible-name attributes are not a WCAG compliance claim. Mobile, real-device touch and screen-reader testing remain unverified.
