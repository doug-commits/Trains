# Signing the iOS app

What to create in your Apple account, and what to paste where. Written down
because a distribution certificate expires after a year and this page is the
thing you will not remember.

**Nothing in this repository generates a signing identity, and nothing should.**
The private key is created on your machine, by you, and never leaves it except
as an encrypted `.p12` inside a GitHub secret. A key somebody else made for you
is a key somebody else has got.

The order matters: identifier, then certificate, then profile — the profile
binds the other two together and cannot be made before they exist.

---

## 1. Identifier

**Certificates, Identifiers & Profiles → Identifiers → ➕**

| Field | Value |
| --- | --- |
| Type | **App IDs** → **App** |
| Description | `Overland SEA` |
| Bundle ID | **Explicit** → `com.slowasia.overland` |
| Capabilities | **none — leave every box unticked** |

The bundle ID has to match `PRODUCT_BUNDLE_IDENTIFIER` in `ios/project.yml`
character for character. It is permanent: Apple will not let you rename or
delete it later, and a typo means starting a new identifier and a new app
record.

Tick nothing under Capabilities. The app has no push notifications, no iCloud,
no Sign in with Apple, no App Groups, no HealthKit — no entitlements at all.
Every box you tick has to be matched by an entitlement in the build, and a
capability enabled here but absent from the binary is a signing failure with a
message that does not mention this page.

## 2. Certificate

**If you already have an Apple Distribution certificate from another app, use
it and skip this whole step.** A distribution certificate belongs to the
account, not to an app — one signs everything your team ships. Apple caps you
at three, and a second identity for the same team buys nothing except another
thing to renew. The `.p12` and its password you already have in that project's
CI are the same two secrets this one wants.

What you cannot reuse is the provisioning profile: it names one App ID, and
yours is a different one. Step 3 is not optional.

Apple signs a request, it does not send you a key. So you make a key and a
certificate signing request first, and upload only the request.

**On a Mac:** Keychain Access → Certificate Assistant → *Request a Certificate
From a Certificate Authority*. Your email, any common name, **Saved to disk**.
That writes a `.certSigningRequest` and quietly puts the private key in your
login keychain.

**On anything else** — Linux, or a Mac where you would rather see what is
happening — OpenSSL does the same job in two commands:

```sh
openssl genrsa -out ios_distribution.key 2048
openssl req -new -key ios_distribution.key -out ios_distribution.csr \
  -subj "/emailAddress=doug@mukbangshow.ae/CN=Overland SEA/C=AE"
```

Keep `ios_distribution.key`. It is the half Apple never sees and cannot reissue
— lose it and the certificate it belongs to is scrap.

**Certificates → ➕**

| Field | Value |
| --- | --- |
| Type | **Apple Distribution** (under Software) |
| Upload | the `.csr` you just made |

Not "Apple Development", and not the older "iOS Distribution". The workflow
signs with `CODE_SIGN_IDENTITY="Apple Distribution"` and the names have to
agree. One certificate covers App Store and Ad Hoc both; an account is limited
to three at a time, so revoke a dead one rather than collecting them.

Download the `.cer`. Then turn the pair into the `.p12` the workflow wants:

```sh
# on a Mac, if you used Keychain Access: find the certificate, right-click,
# Export as .p12, and set a password. Otherwise, from the OpenSSL route:
openssl x509 -in distribution.cer -inform DER -out distribution.pem -outform PEM
openssl pkcs12 -export -legacy \
  -inkey ios_distribution.key -in distribution.pem \
  -out distribution.p12 -passout pass:CHOOSE_A_PASSWORD
```

`-legacy` matters on OpenSSL 3: without it the file is encrypted with a cipher
the macOS `security` tool cannot read, and the import fails on the runner with
"MAC verification failed", which reads exactly like a wrong password. The same
flag is needed to *read* the file back, so any later `openssl pkcs12 -in` on it
wants `-legacy` too.

Or skip all of the above and run `./tools/ios-signing.sh`, which does these
steps in order, refuses a certificate that does not match your key, and checks
the profile against both before you upload anything. Bringing an existing
certificate, it takes that instead:

```sh
IOS_P12=/path/to/existing.p12 ./tools/ios-signing.sh check new.mobileprovision
IOS_P12=/path/to/existing.p12 ./tools/ios-signing.sh secrets new.mobileprovision
```

## 3. Provisioning profile

**Profiles → ➕**

| Field | Value |
| --- | --- |
| Type | **App Store Connect** (under Distribution) |
| App ID | `com.slowasia.overland` |
| Certificate | the Apple Distribution one from step 2 |
| Profile Name | anything — `Overland SEA App Store` is fine |

The name genuinely does not matter: the workflow reads it back out of the
downloaded profile rather than being told, so it cannot disagree with what you
typed. Download the `.mobileprovision`.

## What carries over from another app

| | Reusable? | |
| --- | --- | --- |
| Apple Distribution certificate (`.p12`) | **Yes** | Belongs to the account. One signs everything. |
| App Store Connect API key (`.p8`) | **Yes** | Account-level, for uploading. |
| Team ID | **Yes** | One per account. |
| App ID / identifier | **No** | Must be `com.slowasia.overland`, explicitly registered. |
| Provisioning profile | **No** | Binds one App ID to one set of certificates. |

So with an existing app in the same account, the work is: register the
identifier, make one profile, and reuse everything else.

## 4. Team ID

Top right of the developer site, or **Membership details**. Ten characters,
something like `A1B2C3D4E5`.

---

## The secrets

**GitHub → the repository → Settings → Secrets and variables → Actions**

| Secret | What goes in it |
| --- | --- |
| `IOS_CERT_P12_BASE64` | `base64 -w0 distribution.p12` (Linux) or `base64 -i distribution.p12` (macOS) |
| `IOS_CERT_PASSWORD` | the password you chose when exporting the `.p12` |
| `IOS_PROFILE_BASE64` | the same base64 treatment on the `.mobileprovision` |
| `IOS_TEAM_ID` | the ten characters from step 4 |

On Linux the `-w0` is not optional — without it `base64` wraps at 76 columns
and you paste a secret with newlines through it.

With those four set, running the **iOS** workflow produces a signed `.ipa` and
verifies the signature before handing it over.

### To upload straight to TestFlight

**App Store Connect → Users and Access → Integrations → App Store Connect API**,
generate a key with the **App Manager** role.

| Secret | What goes in it |
| --- | --- |
| `APPSTORE_KEY_ID` | shown beside the key |
| `APPSTORE_ISSUER_ID` | above the key list, one per account |
| `APPSTORE_KEY_BASE64` | base64 of the `.p8` |

The `.p8` downloads exactly once and Apple keeps no copy. Then run the workflow
with **Upload to TestFlight** ticked.

---

## Getting the build to Apple

Three routes. They differ only in where the build happens and what does the
uploading.

### A. Build it in Xcode yourself

If you have a Mac with Xcode and your certificates already in its keychain,
this is the shortest path and needs none of the secrets above.

```sh
brew install xcodegen        # once
node tools/build-ios.mjs     # stages the page, stamps the version
cd ios && xcodegen generate
open Overland.xcodeproj
```

In Xcode: select the target, **Signing & Capabilities**, pick your team once
(the project is set to automatic signing so it will sort out the rest). Set the
destination to **Any iOS Device (arm64)** — Archive is greyed out while a
simulator is selected, which is the most common five minutes lost here. Then
**Product → Archive**, and in the Organizer that opens, **Distribute App → App
Store Connect → Upload**.

`node tools/build-ios.mjs` is not optional. It is what puts the planner inside
the app; without it you get a shell that opens to an error page saying exactly
that.

### B. Build in CI, upload with Xcode

Set the four signing secrets and run the workflow. It produces two artifacts:

- `overland-sea-ios` — the `.ipa`
- `overland-sea-ios-xcarchive` — the archive

For the Organizer flow, take the **archive**. Unzip it into
`~/Library/Developer/Xcode/Archives/2026-07-31/` (any dated folder; create one
if there is none) and it appears under **Window → Organizer → Archives**, where
Distribute App works as normal.

Xcode cannot open an `.ipa`. Application Loader, which could, was removed in
Xcode 11 — so for the `.ipa` specifically the tool is **Transporter**, free on
the Mac App Store: sign in, drag it in, Deliver.

### C. Build in CI, upload from CI

Add the three `APPSTORE_*` secrets and run the workflow with **Upload to
TestFlight** ticked. Nothing touches your machine. This is the one to move to
once the first submission has gone through and you are shipping updates.

---

## One thing that is not on this page

A build cannot be uploaded until an app record exists to receive it. That is in
**App Store Connect → Apps → ➕**, not in the developer portal, and it wants the
bundle ID from step 1 and a name — `Overland SEA` — that has to be unique across
the entire App Store. If the name is taken you will find out there, which is a
better place to find out than after a build.

`ios/appstore/listing.md` has every other field that page asks for.
