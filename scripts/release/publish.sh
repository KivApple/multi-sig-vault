#!/usr/bin/env bash
# Publishes the build in dist/ and points the site root at the stable release.
#
#   releases/<id>/   every published release, kept for good (the app downloads updates from here)
#   releases.json    the list of them, newest first
#   /                a copy of the stable release: what a first-time visitor loads
#
# Usage: publish.sh            publish dist/ and refresh the root
#        publish.sh --promote  only refresh the root (after a release got signed)
# Needs the RCLONE_S3_* variables and docker.
set -euo pipefail

BUCKET=":s3:multi-sig.quoi.dev"
WORK=.publish
KEEP=(--exclude "/releases/**" --exclude "/releases.json")

rc() {
	docker run --rm -u "$(id -u):$(id -g)" -v "$PWD:/w" -w /w \
		-e RCLONE_S3_PROVIDER -e RCLONE_S3_ENDPOINT -e RCLONE_S3_REGION \
		-e RCLONE_S3_ACCESS_KEY_ID -e RCLONE_S3_SECRET_ACCESS_KEY \
		-e RCLONE_CONFIG=/dev/null -e RCLONE_CACHE_DIR=/tmp/rclone \
		rclone/rclone:1.76.0 "$@"
}

# Downloads a file from the bucket root if it is there; a failure to look is an error, not "absent".
fetch_root() {
	if [ -n "$(rc lsf --files-only "$BUCKET" --include "/$1")" ]; then rc copyto "$BUCKET/$1" "$WORK/$2"; fi
}

rm -rf "$WORK" && mkdir -p "$WORK"
BUILT=""
fetch_root releases.json old.json
if [ "${1:-}" != "--promote" ]; then
	BUILT=$(node -p 'require("./dist/release.json").id')
	rc copy --checksum dist "$BUCKET/releases/$BUILT"
	node scripts/release/list.mjs "$WORK/old.json" dist/release.json > "$WORK/releases.json"
	rc copyto "$WORK/releases.json" "$BUCKET/releases.json"
else
	cp "$WORK/old.json" "$WORK/releases.json"
fi

fetch_root release.json root.json
STABLE=$(node scripts/release/stable.mjs "$WORK/releases.json" "$WORK/root.json")
if [ -z "$STABLE" ]; then
	echo "root: left as it is"
elif [ -f "$WORK/root.json" ] && [ "$(node -p 'require("./'"$WORK"'/root.json").id')" = "$STABLE" ]; then
	echo "root: already serves $STABLE"
elif [ "$STABLE" = "$BUILT" ]; then
	rc sync --checksum -v dist "$BUCKET" "${KEEP[@]}"
else
	rc copy "$BUCKET/releases/$STABLE" "$WORK/stable"
	# Never put at the root anything that is not exactly the release it claims to be.
	test "$(node scripts/release/check.mjs "$WORK/stable")" = "$STABLE"
	rc sync --checksum -v "$WORK/stable" "$BUCKET" "${KEEP[@]}"
fi
