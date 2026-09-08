# The leads sheet

**Already set up. There is nothing to do on any iPad — open the link and it works.**

Guest details are saved in two places. On the iPad, written the instant someone taps Play, before anything touches the network. And on a Google Sheet, sent straight after, so you can open it from your phone anywhere.

The iPad copy is a working copy and a buffer for when the wifi drops. The sheet is the record. Browser storage on an iPad is not a safe: iOS can clear it when the device runs low, and so does deleting the home screen icon.

## What you get

The script builds the whole workbook itself the first time a lead arrives. Three tabs, no layout to do by hand.

**Guests** — one row per person, newest at the bottom, in Cinnamood colours. Filter or sort any column from the header. Won rows are highlighted, so you can see at a glance who is owed something.

**Dashboard** — guests all time, today, and over the last seven days. Pulls played, prizes won, win rate, the time of the most recent guest, and a breakdown of which prizes have gone out. All live formulas, so nothing needs re-running.

**Email list** — first name, last name, email, phone, newest first, ready to paste straight into a mail tool.

## Setting it up

This is already done for the sheet in use. These steps are here for replacing it, or setting up a second shop.

1. Go to [sheets.new](https://sheets.new) to make a blank sheet. Name it something like *Cinnamood Guests*.
2. In the menu choose **Extensions**, then **Apps Script**.
3. Delete whatever is in the editor and paste in the whole of `tools/leads-sheet.gs`.
4. On line 30, replace `change-me-to-something-only-you-know` with a passphrase of your own. Keep it to hand for step 8. It is the only thing stopping a stranger who sees the address from writing into your sheet.
5. Save, with the disk icon or Cmd+S.
6. Click **Deploy**, then **New deployment**. Click the gear next to *Select type* and choose **Web app**.
7. Set **Execute as** to *Me*, and **Who has access** to *Anyone*. Click **Deploy**, then **Authorize access** and allow the permissions. Copy the **Web app URL** at the end. It ends in `/exec`.

That "Anyone" setting sounds alarming and is not. It only means the address can be reached without a Google login, which the iPad needs. Your passphrase decides who may actually write.

That is the whole of it. The address and passphrase are already stored on the site's server, so **there is nothing to set up on any iPad**. Open the link and it is connected.

## Putting it on an iPad

Open https://cinnamood.netlify.app in Safari. Share, then **Add to Home Screen**. Open it from that icon and it runs full screen with no browser bars.

No sheet address to type, no passphrase, no settings. A brand-new iPad, or one that has been wiped, works the moment it opens the link. That is deliberate: when those details lived on each device, an iPad that nobody remembered to set up looked completely normal while saving nowhere but itself.

To check it is talking to the sheet, hold the top-left corner of the screen for three seconds to open the staff panel. **Guest details** should say it is connected.

## Testing mode

The panel has **Same guest may play again**, currently set to *Straight away — TESTING*, so you can play over and over with the same details. A red banner shows in the panel the whole time it is on, and repeated entries are marked in the sheet's Repeat column.

**Set it to *Never* before real customers play.** That is the one-pull-per-guest rule we agreed.

## If the wifi drops

Nothing is lost. Leads queue on the iPad and go out by themselves once the connection returns, and the panel shows how many are waiting. Retries are safe: every lead carries an id and the script never writes an id twice. The line at the top of Guest details is the one to watch. In red, sync is failing and the iPad is the only copy.

## Changing the passphrase later

Change it in the Apps Script editor and save. Then **Deploy**, **Manage deployments**, and edit the existing deployment so the address stays the same.

Then update the server, not the iPads:

```bash
netlify env:set SHEET_KEY "your-new-passphrase" --context production
netlify deploy --prod
```

The address lives in `SHEET_URL` the same way. Neither is in the site's source, so neither can be read out of the page.

## Why the iPad does not talk to Google directly

The site is public, so anything the page needs in order to reach the sheet would be readable by anyone who views its source — and with the address and passphrase, a stranger could write whatever they liked into the guest list. Instead the iPad posts to Cinnamood's own address, `/api/leads`, and the server adds the credentials and forwards it. The code is in `netlify/functions/leads.mjs`.

The iPad still keeps its own copy first, so this bridge being down never costs a guest. The queue simply goes out later.

## A note on consent

The wording under the form is stored with every lead, so your record shows what each guest was actually told rather than what the wording says today. Edit it in `site/shared/config.js` under `leads.copy.consent`.

Worth checking against local rules before going live. The form requires name, email and phone, and treats submitting as agreement to the notice shown. In the EU and UK, marketing consent normally has to be a separate unticked box rather than a condition of playing. If you want that, it is a small change and better made now than after the first customer.
