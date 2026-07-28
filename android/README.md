# Overland SEA for Android

A WebView over the same page the website serves — with one difference that is
the whole reason the app exists.

**It works with no signal.** The planner already fetches nothing at runtime:
the network data, the coastline, the rail alignments, the itinerary logic, the
fonts and 93 photographs are all inside the page. Bundling it means the app
answers "does the Padang Besar connection hold?" on a platform in southern
Thailand with the phone in flight mode, which is exactly when you need it and
exactly when a website is useless.

That is also why this is not the wrapper-around-a-website that Play rejects
under its minimum-functionality policy. There is no website being wrapped;
there is a program that happens to be written in HTML, running offline.

## No internet permission

The manifest requests **no** `INTERNET` permission, deliberately and
permanently. The app cannot phone home even by accident. Outbound links —
Google Maps, an operator's booking page, a hotel search — are handed to the
browser as intents, which needs no permission of ours and puts the reader on
an address bar that tells them whose site they are on.

This makes the Play data-safety declaration trivially true: no data collected,
no data shared, nothing transmitted.

## Building

Neither the development container nor this repo can build it: the Android
Gradle Plugin and the SDK both live on `dl.google.com`. CI does it instead.

    Actions → Android → Run workflow

That produces `overland-sea-android` containing an `.aab` for Play and an
`.apk` you can sideload. To build locally you need Android Studio or the SDK,
then:

    node tools/build.mjs && node tools/build-android.mjs
    cd android && ./gradlew bundleRelease

`tools/build-android.mjs` stages `index.html` and `data/photos/` into
`app/src/main/assets/` (about 22 MB) and writes `version.properties`. The
version code is days-since-2026-01-01 rather than a number someone has to
remember to increment, because Play rejects a repeat and a manual counter is a
counter you will eventually forget.

## Signing

Set four repository secrets and the CI bundle comes out signed:

| secret | what it is |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 upload.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | the store password |
| `ANDROID_KEY_ALIAS` | the key alias |
| `ANDROID_KEY_PASSWORD` | the key password |

Generate the keystore once, and keep it. Losing it means you can never update
the app under the same listing:

    keytool -genkey -v -keystore upload.jks -keyalg RSA -keysize 2048 \
      -validity 10000 -alias upload

With the secrets unset the workflow still runs and still produces an artefact,
but says in the job summary that it is unsigned. That is deliberate: a debug
key would sign successfully and then fail at upload with an error that does
not explain itself.

## Notes on the implementation

**Assets are served over `https://appassets.androidplatform.net/` rather than
`file://`.** Not cosmetic. Modern WebView refuses `localStorage` on a file
origin, and both the theme choice and the folded search panel live there — on
`file://` the app would forget both on every launch with no error to explain
why.

**`minSdk` is 26** (Android 8). Set by the adaptive launcher icon, which has
no pre-26 form, and no real loss: an older device ships a WebView that cannot
render the canvas map or the CSS this page is built on, so it would install and
then look broken.

**Back walks the itinerary before it leaves.** The planner keeps its route in
the URL hash, so WebView history is a real trail through the app.
