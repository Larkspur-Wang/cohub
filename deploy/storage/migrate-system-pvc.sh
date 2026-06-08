#!/usr/bin/env bash
# Migrate cohub-system-pvc from root-level space dirs to an env subpath.
#
# Intended to run inside a temporary Kubernetes pod/job with the whole
# cohub-system-pvc mounted at SYSTEM_ROOT (default: /system-storage), without subPath.
#
# Examples:
#   ./migrate-system-pvc.sh dev dry-run
#   ./migrate-system-pvc.sh dev run
#   ./migrate-system-pvc.sh dev verify
#
# The migration is copy-only: it never deletes old root-level data.

set -euo pipefail

ENV_NAME="${1:-}"
MODE="${2:-dry-run}"
SYSTEM_ROOT="${SYSTEM_ROOT:-/system-storage}"

if [[ ! "$ENV_NAME" =~ ^(dev|prod)$ ]]; then
  echo "Usage: $0 <dev|prod> <dry-run|run|verify>" >&2
  exit 2
fi

if [[ ! "$MODE" =~ ^(dry-run|run|verify)$ ]]; then
  echo "Usage: $0 <dev|prod> <dry-run|run|verify>" >&2
  exit 2
fi

if [[ ! -d "$SYSTEM_ROOT" ]]; then
  echo "System root does not exist: $SYSTEM_ROOT" >&2
  exit 1
fi

TARGET_ROOT="$SYSTEM_ROOT/$ENV_NAME"
UUID_RE='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

list_source_dirs() {
  find "$SYSTEM_ROOT" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' \
    | grep -E "$UUID_RE" \
    | sort
}

count_source_dirs() {
  list_source_dirs | wc -l | tr -d ' '
}

count_target_dirs() {
  if [[ ! -d "$TARGET_ROOT" ]]; then
    echo 0
    return
  fi
  find "$TARGET_ROOT" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' \
    | grep -E "$UUID_RE" \
    | wc -l \
    | tr -d ' '
}

print_summary() {
  echo "SYSTEM_ROOT=$SYSTEM_ROOT"
  echo "ENV_NAME=$ENV_NAME"
  echo "TARGET_ROOT=$TARGET_ROOT"
  echo "source_uuid_dirs=$(count_source_dirs)"
  echo "target_uuid_dirs=$(count_target_dirs)"
}

verify_one() {
  local id="$1"
  local src="$SYSTEM_ROOT/$id"
  local dst="$TARGET_ROOT/$id"
  [[ -d "$dst" ]] || { echo "missing target: $dst" >&2; return 1; }
  if [[ -d "$src/repo" ]]; then
    [[ -d "$dst/repo" ]] || { echo "missing repo: $dst/repo" >&2; return 1; }
  fi
  if [[ -d "$src/tmp" ]]; then
    [[ -d "$dst/tmp" ]] || { echo "missing tmp: $dst/tmp" >&2; return 1; }
  fi
}

case "$MODE" in
  dry-run)
    print_summary
    echo
    echo "First 30 planned copies:"
    list_source_dirs | sed -n '1,30p' | while read -r id; do
      echo "  $SYSTEM_ROOT/$id -> $TARGET_ROOT/$id"
    done
    ;;

  run)
    print_summary
    echo
    mkdir -p "$TARGET_ROOT"
    list_source_dirs | while read -r id; do
      src="$SYSTEM_ROOT/$id"
      dst="$TARGET_ROOT/$id"
      echo "copy $src -> $dst"
      mkdir -p "$dst"
      # Copy only missing files. Existing target files are kept intact, making
      # repeated runs idempotent and avoiding accidental overwrite.
      cp -a -n "$src/." "$dst/"
    done
    echo
    echo "Migration copy finished. Running verification..."
    "$0" "$ENV_NAME" verify
    ;;

  verify)
    print_summary
    echo
    failed=0
    total=0
    while read -r id; do
      total=$((total + 1))
      if ! verify_one "$id"; then
        failed=$((failed + 1))
      fi
    done < <(list_source_dirs)
    echo "verified_source_dirs=$total"
    echo "failed=$failed"
    if [[ "$failed" -ne 0 ]]; then
      exit 1
    fi
    ;;
esac
