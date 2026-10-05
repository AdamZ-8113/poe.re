# PoB Codes map import

`/import?app=pob.codes&data=<base64url UTF-8 JSON>` is a PoE1-only,
English-only receiver. It previews a selection and creates a new browser-local
profile only after confirmation. Other sources/games are not supported.

## Wire contract (version 1)

Exactly one `app` and `data` query parameter and these six JSON fields:

```json
{
  "schema": "map-exclusions",
  "version": 1,
  "game": "poe",
  "idNamespace": "poe.re-map-token",
  "name": "PoB Codes map checks",
  "excludeIds": [246480838, -2064669900]
}
```

The sender encodes UTF-8 JSON as canonical, unpadded base64url (no `+`, `/`,
`=`). Maximum complete URL: 8 KiB; decoded JSON: 4 KiB; trimmed profile name:
1-80 printable Unicode characters; selection: 1-256 unique signed int32 IDs.
Unknown JSON/query keys, unsupported discriminators, malformed encoding,
non-integers, duplicates, reserved names, and empty selections fail visibly.
`PobCodesImportFixtures.json` contains shared valid, partial, all-unknown,
extra-key, unsafe-name, collision, and overlong-name examples. Malformed
encoding/oversize byte boundaries are generated in the parser tests.

IDs belong to the receiver's generated English map-token catalog, not GGG stat
IDs. Unknown IDs appear separately. With at least one known ID, the user may
explicitly choose **Import recognized modifiers only**. Zero known IDs fails.

## Profile and navigation contract

The adapter starts from current `defaultSettings` and overlays only `name`,
`language: "ENGLISH"`, and recognized `map.badIds`. Receiver-owned defaults,
including trade filters, stay intact. Repeat imports propose the first free
case-insensitive name, then ` (2)`, ` (3)`, etc.; the name remains editable.
A suffix truncates the base only as needed to keep the 80-character bound.

The import page does not mount the shared profile controls or change profile
contexts while previewing. The ordinary layout may perform the same first-visit
initialization as other routes. Confirmation calls `createImportProfile` at the
existing storage boundary. It re-reads profiles, rejects existing own/case
keys, writes and verifies the new profile, then writes/verifies selection.
On failure it rolls back its own unchanged write; concurrent storage changes
are not overwritten. Existing add, rename, and generic **Overwrite** flows
continue using their existing APIs and semantics.

After successful persistence, `location.replace("/maps")` loads a fresh
document so English language/profile context hydrates before maps autosaves.
The flow test explicitly unmounts/re-mounts the real layout in jsdom, which
cannot perform a real document navigation itself.

The page captures the query in render-phase state, then scrubs it through
React Router replacement. Reload/back do not replay a received payload.
The initial query necessarily reaches the hosting/CDN layer and may be visible
to scripts already loaded by the document. It is not encrypted. Send only
non-sensitive token IDs and a generic display name; never PoB codes, build
URLs/IDs, account/character data, equipment, credentials, or analysis details.
Do not log or send import queries to analytics.

## Validation and rollout

From the repository root:

```sh
pnpm exec vitest run src/pages/import/PobCodesImportPayload.test.ts src/pages/import/PoeImportPage.test.tsx src/pages/import/PoeImportFlow.test.tsx src/utils/LocalStorage.test.ts src/layout/Poe1Routes.test.tsx
pnpm typecheck
pnpm build:poe
pnpm test
```

VZ reviews/merges the upstream PR and deploys through the existing Pages Git
integration. Direct query navigation/reload must serve the application shell;
success must leave a clean `/maps` URL and preserve every existing profile.
The PoB Codes outbound button is a separate follow-up and must remain disabled
until the deployed receiver is proven. Receiver/sender contract changes require
matching versioned fixtures. Reverting this route does not delete user profiles
or change the existing `/maps` workflow.

## Review screenshots

[Desktop confirmation](../../../../docs/pob-codes-import/desktop.png) and
[mobile partial-import confirmation](../../../../docs/pob-codes-import/mobile.png)
use synthetic selections only.
