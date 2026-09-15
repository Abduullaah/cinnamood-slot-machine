#!/bin/sh
# Put the current site live on GitHub Pages.
#
# Pages serves the `gh-pages` branch, which holds ONLY the contents of site/.
# git subtree keeps that branch in step without a second checkout to forget
# about. Run the tests first: everything that guards a guest's details is in
# there, and a deploy is the last moment it is cheap to find out.
set -e
cd "$(dirname "$0")/.."

./tools/tests/run.sh

if grep -q "testMode: true" site/shared/config.js; then
  echo
  echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
  echo "!!  TEST MODE IS ON: no details form, prizes on a rehearsal loop.   !!"
  echo "!!  Set testMode: false in site/shared/config.js before the event.  !!"
  echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
  echo
fi

if grep -q "simulation: { enabled: true" site/shared/config.js || \
   grep -q "dedupeWindowDays: -1" site/shared/config.js; then
  echo
  echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
  echo "!!  SIMULATION IS SWITCHED ON, or repeats are allowed.              !!"
  echo "!!  Before the event: simulation enabled false, dedupeWindowDays 0, !!"
  echo "!!  bump leads.settingsVersion and resetStamp.                      !!"
  echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
  echo
fi

# One build number across every asset URL, so a half-updated cache cannot
# leave the machine running two builds at once.
python3 tools/bump.py

git add -A
git diff --cached --quiet || git commit -m "${1:-Update the machine}"
git push origin main
git subtree push --prefix site origin gh-pages

echo
echo "Live in a minute or two at:"
echo "  https://abduullaah.github.io/cinnamood-slot-machine/"
echo
echo "iPads already running it pick the change up on their next reload."
