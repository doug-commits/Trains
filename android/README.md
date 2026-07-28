# Overland SEA for Android

A WebView over the same program the website serves — built for the app rather
than copied from the site, and with one difference that is the whole reason it
exists.

**It works with no signal.** The planner already fetches nothing at runtime:
the network data, the coastline, the rail alignments, the itinerary logic and
the fonts are all inside the page. Bundling it means the app answers "does the
Padang Besar connection hold?" on a platform in southern Thailand with the
phone in flight mode, which is exactly when you need it and exactly when a
website is useless.

## What the app leaves out

Built with `APP=1`, which changes three things and nothing else:

**No photographs.** The library is 22 MB of what was a 46 MB app. Stations
without one already fall back to drawn scene art, so this is a path the page
takes every day rather than an untested branch. 4.9 MB of page becomes 0.9 MB.

**No links to the written-up route pages.** Those are separate documents on the
site. Inside a single bundled file every one of them is a dead end.

**Opens in day mode.** A website is arrived at inside a browser already set the
way its reader likes it, so following the system is the polite default there.
An app is opened on its own, and a chart is read in daylight more often than
not. The toggle still offers all three and remembers what it is told.

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

    node tools/build-android.mjs
    cd android && ./gradlew bundleRelease

`tools/build-android.mjs` runs the app build itself and stages `dist/app.html`
into `app/src/main/assets/index.html` (about 0.9 MB), then writes
`version.properties`. The version code is ten-minute ticks since 2026-01-01 rather than a number someone
has to remember to increment, because Play rejects a repeat and a manual
counter is a counter you will eventually forget.

It counts ticks rather than days because a bug found in a build that has
already been uploaded gets fixed the same day, and a day counter hands that fix
the same code as the build it is fixing. Ten minutes is finer than anyone can
rebuild, and still four thousand years short of Play's ceiling of 2100000000.

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
