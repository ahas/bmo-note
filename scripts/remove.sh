#!/bin/sh
# Generated from bmo-app.toml by bmo-app-sdk's bmo-app-declare.
# Takes bmo-note off this machine the way bmo-app-sdk's docs/removal.md states it: the units down,
# the registrations gone, the deploy tree away. It plans by default and changes nothing until you
# say --yes; the runtime data stays until you also say --purge-data.
set -eu

NAME="bmo-note"
UNITS="bmo-note.service"
DEPLOY_ROOT="$HOME/.local/share/bmo-note"
DATA_ROOT="$HOME/.local/share/bmo/data"
DATA_FOLDER="note"
CHECKOUT="~/repos/ahas/bmo/services/note"
TOOL=""
CHECKOUTS="${BMO_DATA_DIR:-$HOME/.local/share/bmo/data}/testbed/checkouts.toml"

DRY=1
PURGE=0
for arg in "$@"; do
  case "$arg" in
    --yes) DRY=0 ;;
    --dry-run) DRY=1 ;;
    --purge-data) PURGE=1 ;;
    *)
      echo "remove-$NAME: unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

# A path this script may take away: only a root under the home's share folder or /srv/, and
# never the parent itself, which would take every application's tree at once.
guard() {
  root="$1"
  ok=0
  case "$root" in
    "$HOME/.local/share/"*) ok=1 ;;
    /srv/*) ok=1 ;;
  esac
  if [ "$ok" != 1 ]; then
    echo "remove-$NAME: refusing to touch: $root" >&2
    exit 3
  fi
}

step() {
  label="$1"
  command="$2"
  printf '%s %s: %s\n' "$([ "$DRY" = 1 ] && printf 'planned' || printf 'doing')" "$label" "$command"
  if [ "$DRY" = 0 ]; then
    sh -c "$command" || echo "remove-$NAME: $label did not finish; continuing" >&2
  fi
}

guard "$DEPLOY_ROOT"
guard "$DATA_ROOT"

# 1. The units go first: nothing may be writing while the tree is taken away.
for unit in $UNITS; do
  step "unit $unit" "systemctl --user disable --now $unit"
  step "unit file $unit" "rm -f \"\$HOME/.config/systemd/user/$unit\""
done
step "service manager" "systemctl --user daemon-reload"

# 2. The registrations: the agency's repository row and this checkout's line in the
#    machine's register. An unregistered application or a row a job holds is said and passed over.
step "agency row" "bmo repository remove $NAME"
if [ -f "$CHECKOUTS" ]; then
  # The register keeps one quoted path a line. The manifest's checkout names this
  # application's line whole; where it names none, the small-alphabet name ending a line's
  # path answers for it.
  if [ -n "$CHECKOUT" ]; then
    LINE="${CHECKOUT#\~/}"
    step "checkout register" "sed -i -e '/$LINE\\\",/d' '$CHECKOUTS'"
  else
    step "checkout register" "sed -i -e '/$NAME\\\",/d' '$CHECKOUTS'"
  fi
else
  echo "remove-$NAME: no checkout register at $CHECKOUTS to take a line from" >&2
fi

# 3. The tool goes before the tree it stands placed in, where the application registered one.
if [ -n "$TOOL" ]; then
  step "tool host" "bmo pocket take $TOOL"
fi

# 4. The tree. Releases and the deploy link stand under the deploy root and nothing else;
#    the data root keeps its contents unless this is said outright.
step "deploy tree" "rm -rf '$DEPLOY_ROOT'"
if [ "$PURGE" = 1 ]; then
  if [ -n "$DATA_FOLDER" ]; then
    # The application shares the machine's data root and owns this folder under it.
    step "runtime data" "rm -rf \"$DATA_ROOT/$DATA_FOLDER\""
  elif [ "$DATA_ROOT" = "${BMO_DATA_DIR:-$HOME/.local/share/bmo/data}" ]; then
    echo "remove-$NAME: $DATA_ROOT is the machine's shared data root; the manifest must name a data_folder before its data can go" >&2
    exit 3
  else
    step "runtime data" "rm -rf '$DATA_ROOT'"
  fi
else
  echo "remove-$NAME: runtime data kept at $DATA_ROOT (--purge-data to take it)"
fi

if [ "$DRY" = 1 ]; then
  echo "remove-$NAME: planned only; run again with --yes"
else
  echo "remove-$NAME: taken off this machine; the repository's GitHub copy and its git history stand"
fi
