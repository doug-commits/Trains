#!/bin/sh
# Apple signing, start to finish, on your machine.
#
# Already have an Apple Distribution certificate from another app? Reuse it —
# it belongs to your account, not to that app. Skip to step 3 with:
#
#   IOS_P12=/path/to/existing.p12 ./tools/ios-signing.sh check new.mobileprovision
#
# The provisioning profile is the half that cannot be reused: it names one App
# ID, and yours is a different one.
#
#   ./tools/ios-signing.sh csr            1. make a key and a request
#   ./tools/ios-signing.sh p12 dist.cer   2. after Apple hands back a .cer
#   ./tools/ios-signing.sh check *.mobileprovision   3. before you trust any of it
#   ./tools/ios-signing.sh secrets        4. what to paste into GitHub
#
# RUN THIS ON YOUR OWN COMPUTER. Not in CI, not in a shared shell, and not
# anywhere an assistant can read the working directory. Step 1 creates a
# private key that Apple never sees and cannot reissue: it is the half that
# proves the certificate is yours, and anyone holding a copy can sign software
# as you. This script never prints it, never uploads it, and leaves it in one
# file you should back up somewhere you trust.
#
# Everything here is openssl and shell, so it works the same on macOS and
# Linux. On a Mac you could do steps 1 and 2 through Keychain Access instead;
# this way you can see what is happening, which matters for something you have
# to repeat in a year when the certificate expires.

set -eu

DIR="${IOS_SIGNING_DIR:-./ios-signing}"
KEY="$DIR/distribution.key"
CSR="$DIR/distribution.csr"
# Overridable, because a distribution certificate belongs to the account and
# not to an app. If you already have one from another project, that is the one
# to use — Apple caps you at three, and a second identity for the same team
# buys nothing:
#
#   IOS_P12=~/keys/apple-dist.p12 ./tools/ios-signing.sh check profile.mobileprovision
P12="${IOS_P12:-$DIR/distribution.p12}"
BUNDLE_ID="com.slowasia.overland"

# GNU wraps base64 at 76 columns and BSD does not have -w at all. A wrapped
# secret is a secret with newlines through it, which fails on the runner as
# something that reads like a wrong password.
# OpenSSL 3 needs -legacy to read back what -legacy wrote — the ciphers Apple's
# tooling requires live in the legacy provider at both ends. Without this, the
# check below cannot open the .p12 this script itself just created, and reports
# it as a wrong password: precisely the confusion the flag exists to avoid.
LEGACY=""
if openssl version | grep -q 'OpenSSL 3'; then LEGACY="-legacy"; fi

b64() {
  if base64 --help 2>&1 | grep -q -- '-w'; then base64 -w0 "$1"; else base64 -i "$1"; fi
}

# `security cms` on macOS, openssl elsewhere. A .mobileprovision is a CMS
# signed message wrapped around a plist, and both of these unwrap it.
unwrap_profile() {
  if command -v security >/dev/null 2>&1; then
    security cms -D -i "$1" 2>/dev/null
  else
    openssl smime -inform DER -verify -noverify -in "$1" 2>/dev/null
  fi
}

# Every <data> blob inside the DeveloperCertificates array, one per line.
#
# Deliberately blind to how the plist is laid out. Apple wraps these across
# many lines; a profile from any other tool may put the whole array on one. The
# first two attempts at this both keyed off line structure and both silently
# extracted nothing, reporting a warning that read like fussiness rather than
# the bug it was. So: read the file as one string and walk it.
embedded_certs() {
  awk '
    { all = all $0 }
    END {
      gsub(/[ \t\r]/, "", all)
      i = index(all, "<key>DeveloperCertificates</key>")
      if (i == 0) exit
      rest = substr(all, i)
      e = index(rest, "</array>")
      if (e > 0) rest = substr(rest, 1, e)
      while ((s = index(rest, "<data>")) > 0) {
        rest = substr(rest, s + 6)
        t = index(rest, "</data>")
        if (t == 0) break
        print substr(rest, 1, t - 1)
        rest = substr(rest, t + 7)
      }
    }
  ' "$1"
}

# Read one string out of a plist without needing plutil, which is macOS-only.
plist_value() {
  sed -n "s/.*<key>$2<\/key>[[:space:]]*<string>\([^<]*\)<\/string>.*/\1/p" "$1" | head -1
}

case "${1:-}" in

csr)
  mkdir -p "$DIR"
  if [ -f "$KEY" ]; then
    echo "$KEY already exists."
    echo "If you are renewing an expired certificate you can reuse it: skip to"
    echo "the upload below with the existing $CSR. If you have lost track of"
    echo "which certificate it belongs to, delete both and start again — an"
    echo "unused key costs nothing, a wrong one costs a failed build."
    exit 1
  fi

  printf 'Email for the request [doug@mukbangshow.ae]: '
  read -r EMAIL
  EMAIL="${EMAIL:-doug@mukbangshow.ae}"
  printf 'Two-letter country code [AE]: '
  read -r COUNTRY
  COUNTRY="${COUNTRY:-AE}"

  openssl genrsa -out "$KEY" 2048 2>/dev/null
  chmod 600 "$KEY"
  openssl req -new -key "$KEY" -out "$CSR" \
    -subj "/emailAddress=$EMAIL/CN=Overland SEA/C=$COUNTRY"

  cat <<EOF

Made two files in $DIR:

  distribution.key   the private half. Never upload this, anywhere, to anyone.
                     Back it up somewhere you trust — losing it means the
                     certificate it belongs to is scrap.
  distribution.csr   the request. This is the one Apple wants.

Next, at developer.apple.com → Certificates, Identifiers & Profiles:

  1. Certificates → + → Apple Distribution   (under Software)
       Not "Apple Development", and not the older "iOS Distribution".
       The build signs with CODE_SIGN_IDENTITY="Apple Distribution" and the
       names have to agree.
  2. Upload $CSR
  3. Download the .cer it gives you, then run:

       $0 p12 /path/to/the.cer

EOF
  ;;

p12)
  CER="${2:-}"
  [ -n "$CER" ] || { echo "usage: $0 p12 <downloaded.cer>" >&2; exit 2; }
  [ -f "$KEY" ] || { echo "no $KEY — run '$0 csr' first" >&2; exit 2; }
  [ -f "$CER" ] || { echo "no such file: $CER" >&2; exit 2; }

  # Apple hands back DER. Everything downstream wants PEM.
  #
  # Converted to a scratch file and only moved into place once it has been
  # checked. The first version wrote straight to distribution.pem and then
  # validated, so a rejected certificate was still left sitting there under the
  # right name — and the next thing to read it got the wrong one, silently.
  PENDING="$DIR/.pending.pem"
  openssl x509 -in "$CER" -inform DER -out "$PENDING" -outform PEM 2>/dev/null \
    || openssl x509 -in "$CER" -out "$PENDING" -outform PEM

  # The certificate and the key have to be two halves of one pair. They will
  # not be if you have made a second CSR since, and the failure that produces
  # is a signing error on the runner that names neither file.
  KEY_MOD=$(openssl rsa -noout -modulus -in "$KEY" | openssl md5)
  CRT_MOD=$(openssl x509 -noout -modulus -in "$PENDING" | openssl md5)
  if [ "$KEY_MOD" != "$CRT_MOD" ]; then
    rm -f "$PENDING"
    echo "This certificate does not match $KEY." >&2
    echo "It was almost certainly issued from a different request. Download the" >&2
    echo "certificate made from $CSR, or start again with '$0 csr'." >&2
    exit 1
  fi
  mv "$PENDING" "$DIR/distribution.pem"

  printf 'Choose a password for the .p12 (you will paste it into a GitHub secret): '
  stty -echo 2>/dev/null || true
  read -r PW
  stty echo 2>/dev/null || true
  echo
  [ -n "$PW" ] || { echo "An empty password will not import on the runner." >&2; exit 2; }

  # -legacy on OpenSSL 3, which otherwise writes a .p12 encrypted with a cipher
  # the macOS security tool cannot read. That fails on the runner as "MAC
  # verification failed", which is indistinguishable from a wrong password and
  # has cost people entire afternoons.
  # shellcheck disable=SC2086
  openssl pkcs12 -export $LEGACY \
    -inkey "$KEY" -in "$DIR/distribution.pem" \
    -out "$P12" -passout "pass:$PW"
  chmod 600 "$P12"

  EXPIRES=$(openssl x509 -noout -enddate -in "$DIR/distribution.pem" | cut -d= -f2)

  cat <<EOF

Wrote $P12 — expires $EXPIRES.

Keep that password: it goes in IOS_CERT_PASSWORD and there is no way to
recover it from the file.

Next, still at developer.apple.com:

  Profiles → + → App Store Connect   (under Distribution)
    App ID:      $BUNDLE_ID
    Certificate: the Apple Distribution one you just made
    Name:        anything — the build reads it back out of the file

Download the .mobileprovision, then check the whole set before trusting it:

  $0 check /path/to/the.mobileprovision

EOF
  ;;

check)
  PROFILE="${2:-}"
  [ -n "$PROFILE" ] || { echo "usage: $0 check <profile.mobileprovision>" >&2; exit 2; }
  [ -f "$PROFILE" ] || { echo "no such file: $PROFILE" >&2; exit 2; }
  [ -f "$P12" ] || {
    echo "no $P12" >&2
    echo "Either run '$0 p12 <cer>' to make one, or point at a certificate you" >&2
    echo "already have: IOS_P12=/path/to/existing.p12 $0 check $PROFILE" >&2
    exit 2
  }

  mkdir -p "$DIR"
  PLIST="$DIR/profile.plist"
  unwrap_profile "$PROFILE" > "$PLIST"
  [ -s "$PLIST" ] || { echo "Could not read $PROFILE — is it really a profile?" >&2; exit 1; }

  FAIL=0
  say() { printf '  %-4s %s\n' "$1" "$2"; }

  APP_ID=$(sed -n 's/.*<key>application-identifier<\/key>[[:space:]]*<string>\([^<]*\)<\/string>.*/\1/p' "$PLIST" | head -1)
  case "$APP_ID" in
    *".$BUNDLE_ID") say ok "bundle id: $APP_ID" ;;
    "") say FAIL "no application-identifier in the profile"; FAIL=1 ;;
    *) say FAIL "profile is for $APP_ID, the app is $BUNDLE_ID"; FAIL=1 ;;
  esac

  NAME=$(plist_value "$PLIST" Name)
  say ok "name: ${NAME:-(none)}"

  # An App Store profile provisions no specific devices. One that lists them is
  # an Ad Hoc profile, which builds and signs and is then rejected at upload.
  if grep -q ProvisionedDevices "$PLIST"; then
    say FAIL "this is an Ad Hoc profile — it lists devices. You want App Store Connect."
    FAIL=1
  else
    say ok "App Store profile (no device list)"
  fi

  EXPIRY=$(sed -n 's/.*<key>ExpirationDate<\/key>[[:space:]]*<date>\([^<]*\)<\/date>.*/\1/p' "$PLIST" | head -1)
  say ok "expires: ${EXPIRY:-unknown}"

  # The profile embeds the certificates it will accept. If the one you are
  # about to upload is not among them, the archive signs and the export fails
  # with a message about no matching profile — pointing at neither file.
  # shellcheck disable=SC2086
  CERT_FP=$(openssl pkcs12 -in "$P12" -clcerts -nokeys $LEGACY -passin pass: 2>/dev/null \
    | openssl x509 -noout -fingerprint -sha1 2>/dev/null | cut -d= -f2 || true)
  if [ -z "$CERT_FP" ]; then
    printf '  Password for %s: ' "$(basename "$P12")"
    stty -echo 2>/dev/null || true
    read -r PW
    stty echo 2>/dev/null || true
    echo
    # shellcheck disable=SC2086
    CERT_FP=$(openssl pkcs12 -in "$P12" -clcerts -nokeys $LEGACY -passin "pass:$PW" 2>/dev/null \
      | openssl x509 -noout -fingerprint -sha1 2>/dev/null | cut -d= -f2 || true)
  fi
  if [ -z "$CERT_FP" ]; then
    say FAIL "could not open $P12 with that password"
    FAIL=1
  else
    say ok "certificate opens with that password"
    # The profile embeds the certificates it will accept, one base64 DER blob
    # per entry. Apple wraps them across lines; other tools may not.
    MATCH=0
    FOUND=0
    for BLOB in $(embedded_certs "$PLIST"); do
      FOUND=$((FOUND + 1))
      echo "$BLOB" | base64 -d 2>/dev/null > "$DIR/.embedded.der" || continue
      FP=$(openssl x509 -inform DER -in "$DIR/.embedded.der" -noout -fingerprint -sha1 2>/dev/null | cut -d= -f2 || true)
      [ "$FP" = "$CERT_FP" ] && MATCH=1
    done
    rm -f "$DIR/.embedded.der"
    if [ "$MATCH" = 1 ]; then
      say ok "the profile accepts this certificate"
    elif [ "$FOUND" = 0 ]; then
      # Nothing was extracted, so this says nothing about the profile — only
      # that the parser did not recognise it. Not a reason to stop.
      say WARN "could not read the certificate list out of the profile"
    else
      # Certificates were read and none is the one being uploaded. That is a
      # real mismatch, and it fails at export with "no matching provisioning
      # profile" — a message that names neither file.
      say FAIL "this profile lists $FOUND certificate(s), none of them this one"
      echo "       Rebuild the profile at developer.apple.com and tick the"
      echo "       Apple Distribution certificate this .p12 came from."
      FAIL=1
    fi
  fi

  echo
  if [ "$FAIL" = 0 ]; then
    echo "Looks right. Run '$0 secrets $PROFILE' for what to paste."
  else
    echo "Fix the failures above before uploading anything."
    exit 1
  fi
  ;;

secrets)
  PROFILE="${2:-}"
  [ -n "$PROFILE" ] || { echo "usage: $0 secrets <profile.mobileprovision>" >&2; exit 2; }
  [ -f "$P12" ] || {
    echo "no $P12 — run '$0 p12 <cer>', or set IOS_P12 to one you already have" >&2
    exit 2
  }

  OUT="$DIR/secrets"
  mkdir -p "$OUT"
  b64 "$P12" > "$OUT/IOS_CERT_P12_BASE64.txt"
  b64 "$PROFILE" > "$OUT/IOS_PROFILE_BASE64.txt"

  cat <<EOF

Wrote two files to $OUT. Paste the contents of each into the matching secret
at: GitHub → the repository → Settings → Secrets and variables → Actions

  IOS_CERT_P12_BASE64    $OUT/IOS_CERT_P12_BASE64.txt
  IOS_PROFILE_BASE64     $OUT/IOS_PROFILE_BASE64.txt
  IOS_CERT_PASSWORD      the password you chose for the .p12
  IOS_TEAM_ID            ten characters, top right of developer.apple.com

Then run the iOS workflow. It archives, exports, and verifies the signature
before handing anything over — a build App Store Connect would reject fails in
CI rather than at upload.

Delete $OUT when you have pasted them. They are the same secrets in plain text
in a directory that is easy to forget about. The key and the .p12 in $DIR are
worth keeping — you will need them again when the certificate expires.

EOF
  ;;

*)
  sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
  ;;
esac
