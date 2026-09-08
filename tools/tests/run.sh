#!/bin/sh
# Every check that guards the guest details. Run this before any deploy.
cd "$(dirname "$0")/../.."
L="site/shared/leads.js"
G="tools/leads-sheet.gs"
fail=0
for t in storage sync settings-version; do
  echo "── $t ──"
  node "tools/tests/$t.test.js" "$L" || fail=1
done
echo "── sheet ──"
node tools/tests/sheet.test.js "$G" || fail=1
[ $fail -eq 0 ] && echo "ALL GREEN" || echo "SOMETHING FAILED"
exit $fail
