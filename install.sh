#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RC="${ZDOTDIR:-$HOME}/.zshrc"
START="# >>> logapp >>>"
END="# <<< logapp <<<"

if grep -qF "$START" "$RC" 2>/dev/null; then
  sed -i '' "/$START/,/$END/d" "$RC"
fi

{
  echo ""
  echo "$START"
  echo "alias logapp='node \"$DIR/bin/logapp.js\"'"
  echo "alias -g -- --logapp='| logapp'"
  echo "$END"
} >> "$RC"

echo "logapp installed."
echo "Open a new terminal (or run: source \"$RC\")."
echo
echo "Usage:"
echo "  <your start command> --logapp     # append --logapp, watch at http://localhost:9999"
echo "  npm start | logapp                # same thing, explicit pipe"
echo "  logapp                            # just open the UI"
