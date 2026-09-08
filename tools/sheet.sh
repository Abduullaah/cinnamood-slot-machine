#!/bin/sh
# Push the sheet script and redeploy it to the address the kiosk uses.
# The whole point is that there is one command and it always updates the
# deployment the machine actually talks to — three deployments quietly
# diverging is what cost an afternoon.
set -e
cd "$(dirname "$0")/.."
DEPLOY_ID="AKfycbwGZ7d3E0B_FmbxnfYMLjrL-FEdqvYkt00hOHXBoc7o83KWR9rGrJ_3aoFRcg5cB5_B"

cp tools/leads-sheet.gs .script/Code.js
cd .script
clasp push --force
clasp deploy --deploymentId "$DEPLOY_ID" --description "${1:-Update}"
cd ..

echo
echo "Live script version now:"
curl -s --max-time 30 "https://script.google.com/macros/s/$DEPLOY_ID/exec"
echo
