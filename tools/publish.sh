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

git add -A
git diff --cached --quiet || git commit -m "${1:-Update the machine}"
git push origin main
git subtree push --prefix site origin gh-pages

echo
echo "Live in a minute or two at:"
echo "  https://abduullaah.github.io/cinnamood-slot-machine/"
echo
echo "iPads already running it pick the change up on their next reload."
