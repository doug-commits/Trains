#!/usr/bin/env sh
#
# Sign an app bundle with a keystore that never leaves this machine.
#
#   ./tools/sign-aab.sh app-release.aab ~/.android/upload.jks [alias]
#
# The other half of running the Android workflow with "Build unsigned"
# ticked. CI compiles the thing, which needs an Android SDK; this signs it,
# which needs a private key — and those two want to live in different places.
# A signing key on a build server is a signing key held by whoever can read
# that build server's secrets, and the only copy of yours is valid until 2053.
#
# It asks for the passwords rather than taking them as arguments. An argument
# is in your shell history, in the process list while it runs, and in any
# terminal scrollback you later paste somewhere.
#
# An .aab is signed as a JAR, not with the APK signature schemes — apksigner
# does not handle bundles, and jarsigner is the documented tool for this one.

set -eu

AAB=${1:-}
KEYSTORE=${2:-}
ALIAS=${3:-}

if [ -z "$AAB" ] || [ -z "$KEYSTORE" ]; then
  echo "usage: $0 <bundle.aab> <keystore.jks> [alias]" >&2
  exit 2
fi
[ -f "$AAB" ] || { echo "no such bundle: $AAB" >&2; exit 1; }
[ -f "$KEYSTORE" ] || { echo "no such keystore: $KEYSTORE" >&2; exit 1; }

command -v jarsigner >/dev/null || {
  echo "jarsigner is not on the path. It ships with the JDK — on macOS," >&2
  echo "'brew install temurin' or Android Studio's bundled JDK both provide it." >&2
  exit 1
}

# One alias, or the one you named. Guessing between several would be the kind
# of help that signs with the wrong key and looks like it worked.
if [ -z "$ALIAS" ]; then
  echo "Which key? Reading the aliases in $KEYSTORE — this will ask for the store password."
  keytool -list -keystore "$KEYSTORE" | grep -i 'PrivateKeyEntry' || true
  printf 'alias: '
  read -r ALIAS
fi

echo
echo "Signing $AAB"
jarsigner -verbose:summary \
  -sigalg SHA256withRSA -digestalg SHA-256 \
  -keystore "$KEYSTORE" \
  "$AAB" "$ALIAS"

echo
echo "Verifying"
jarsigner -verify "$AAB" | head -3

# The number Play matches on. Printed here so the check happens before the
# upload rather than in the Play Console's error dialog, which names two
# fingerprints and no cause.
#
# Read out of the bundle, not out of the keystore. -printcert -jarfile needs no
# password, so it does not ask for one a second time — and more to the point it
# reports what is actually in the file you are about to upload rather than what
# was in the keystore you hoped it used.
echo
echo "Signed by:"
keytool -printcert -jarfile "$AAB" | grep -E 'Owner:|SHA1:|SHA256:' || true
echo
echo "(\"The signer's certificate is self-signed\" above is expected — an Android"
echo "upload key is self-signed by design, and jarsigner says so every time.)"
echo
echo "Play must be expecting the SHA1 above. If it is not, this upload will be"
echo "refused — check it against Test and release -> App integrity -> App signing."
