/* ============================================================================
   CINNAMOOD SLOT MACHINE — CONFIGURATION
   ----------------------------------------------------------------------------
   This is the single source of truth for prizes, stock and the event clock.
   The prize list below is the REAL one for the event, confirmed 2026-09-14.

   HOW A PRIZE IS WON
   ------------------
   Real slot machines do NOT spin randomly and see what lands. They decide the
   outcome first, then arrange the reels to show it. We do the same — and the
   deciding is done by the prize bank (prizes.js), which knows three things a
   plain draw does not: how many of each prize is left (`stock`), what time it
   is (`event`), and how long a released prize has been waiting.

   `weight` no longer sets how OFTEN anyone wins — the event clock does that.
   It sets WHICH prize a win is: the higher the weight, the easier the prize.
   ============================================================================ */

const CINNAMOOD_CONFIG = {

  /* ---- PRIZE LIST GENERATION ---------------------------------------------
     BUMP THIS WHENEVER THE PRIZE LIST OR THE ODDS CHANGE FOR REAL.

     Staff weights saved on an iPad are only kept while this number matches, so
     bumping it is how a new deploy takes over from whatever was tuned in-store.
     A weight only means anything relative to the list it was set on, so
     carrying old ones onto a new list would quietly produce wrong odds.
     Prize NAMES staff have edited are always kept.
  ------------------------------------------------------------------------- */
  version: 2,

  /* ---- TEST MODE ---------------------------------------------------------
     true  — for trying the machine out. The details form is skipped and the
             lever works for anyone, nothing is saved as a guest, and prizes
             run on a rolling 20-minute rehearsal of the evening so wins can
             be seen now rather than only on the day. A TEST MODE label sits
             on screen the whole time so it cannot go live unnoticed.
     false — the real machine: details before every pull, the real event clock.

     MUST BE false BEFORE THE EVENT. The publish script shouts if it is not.
  ------------------------------------------------------------------------- */
  testMode: false,

  /* ---- EVENT SIMULATION --------------------------------------------------
     enabled: true — a full dress rehearsal on the iPad. Everything is the
     real machine (details form, guests saved to the sheet, stock, jackpot
     rules), except the clock: the evening does NOT start at 5pm on the day.
     It sits READY, where every pull loses, until someone presses "Start the
     event simulation" in the staff panel. From that moment the whole 5–7pm
     schedule runs squeezed into `minutes`. A SIMULATION label stays on screen.

     MUST BE enabled: false BEFORE THE EVENT, together with the repeat rule
     below going back to 0.
  ------------------------------------------------------------------------- */
  /* autoStart: true is PRACTICE — the same simulation, but rounds start by
     themselves and a fresh one begins whenever the last has finished, so the
     details form and the spinning can be tried at any moment with prizes
     actually coming out. */
  simulation: { enabled: false, minutes: 20, autoStart: false },

  /* ---- FRESH START -------------------------------------------------------
     Change this string and every iPad that opens the new version clears
     everything the machine has saved on it — guests, activity log, prize
     count, rehearsal, staff settings — exactly once.

     It is how test data is wiped off devices nobody can reach by hand.
     NEVER change it during the event: a guest not yet sent to the sheet would
     be lost with everything else.
  ------------------------------------------------------------------------- */
  resetStamp: 'fresh-2026-09-16-event',

  /* ---- THE EVENT ---------------------------------------------------------
     Agreed 2026-09-15 (a change from the earlier 5–7pm evening): the machine
     runs from 10am to midnight, regular prizes can be won all day, scattered
     at random, and the jackpot only between 5pm and 7pm.

     start / end   — the iPad's own local time. Nothing is won before start.
                     CHANGE THESE if the event times change.

     releaseSpan   — the regular prizes (everything but the jackpot) unlock
                     across this share of the day. It is cut into one equal
                     stretch per prize and each prize unlocks at a RANDOM
                     moment inside its stretch: evenly spread, unpredictable.
                     0.88 of 10:00–24:00 ends the last stretch about 22:20,
                     leaving time for anything still waiting. (0.93 was tried
                     first: the last prize could unlock near 23:00, and when
                     the crowd is mostly lunch and evening nobody was left to
                     win it — 1 day in 5 at 100 guests.)

     jackpotFrom / jackpotTo — the only time the jackpot can be won.
     jackpotReleaseBy — the jackpot unlocks at a random moment within this
                     share of its window (0.5 = between 17:00 and 18:00).
     jackpotFloorFrom / jackpotFloor — from this share of its window (0.75 =
                     18:30) the jackpot's chance on each pull is held at least
                     at jackpotFloor, so it goes before 19:00 if anyone plays.
     jackpotAfterWindow — true: if nobody won it by 19:00 (only possible if
                     almost nobody played 5–7), it stays in play afterwards at
                     jackpotFloor until it goes. Agreed with the owner: "if no
                     one plays between 5–7 then give it whenever after that".

     finalStretch  — from here (about 22:20) anything still waiting gets at
                     least `chance.finalFloor` (90%) on every pull: late at
                     night there may only be a guest or two left to win it.

     chance        — how likely a released prize is to come up on a pull.
                     `base` straight after release, plus `perMinute` for every
                     minute it has been waiting, plus `perBacklog` for each
                     further released prize still waiting, capped at `max`.
                     Tuned by simulating whole days of guests — see
                     tools/tests/prizes.test.js before changing any of these.
  ------------------------------------------------------------------------- */
  event: {
    start: '2026-09-16T10:00',
    end:   '2026-09-17T00:00',
    releaseSpan: 0.88,
    jackpotFrom: '2026-09-16T17:00',
    jackpotTo:   '2026-09-16T19:00',
    jackpotReleaseBy: 0.5,
    jackpotFloorFrom: 0.75,
    jackpotFloor: 0.9,
    jackpotAfterWindow: true,
    finalStretch: 0.88,
    chance: { base: 0.2, perMinute: 0.06, perBacklog: 0.15, finalFloor: 0.9, max: 0.9 }
  },

  /* ---- PRIZES ------------------------------------------------------------
     stock  — how many exist. A hard limit: once they have gone, they never
              come up again.
     weight — which prize a win is. Higher = easier. Coffee is the easiest,
              then the boxes of 2, 4 and 6, then the mug and the T-shirt,
              which are equally hard.
     tier controls how loud the celebration is:
       'jackpot' — full screen takeover, longest fanfare, most confetti
       'big'     — big reveal, strong fanfare
       'mid'     — warm reveal, gentle chime
       'small'   — modest reveal, soft chime
       'none'    — the miss state
     symbol must match an id in SYMBOLS below.
  ------------------------------------------------------------------------- */
  prizes: [
    {
      id: 'jackpot',
      tier: 'jackpot',
      symbol: 'tag',
      label: '20% Off for a Year',
      sub: 'The Cinnamood jackpot',
      stock: 1,
      weight: 1
    },
    {
      id: 'coffee',
      tier: 'small',
      symbol: 'coffee',
      label: 'Coffee of Your Choice',
      sub: 'Any coffee, on the house',
      stock: 5,
      weight: 8
    },
    {
      id: 'box2',
      tier: 'mid',
      symbol: 'box2',
      label: 'Box of 2 Rolls',
      sub: 'Two rolls to take home',
      stock: 1,
      weight: 6
    },
    {
      id: 'box4',
      tier: 'mid',
      symbol: 'box4',
      label: 'Box of 4 Rolls',
      sub: 'Four rolls to take home',
      stock: 1,
      weight: 4
    },
    {
      id: 'box6',
      tier: 'big',
      symbol: 'box6',
      label: 'Box of 6 Rolls',
      sub: 'A full box to take home',
      stock: 1,
      weight: 3
    },
    {
      id: 'mug',
      tier: 'big',
      symbol: 'mug',
      label: 'Cup of Mood',
      sub: 'Our exclusive mug',
      stock: 1,
      weight: 2
    },
    {
      id: 'tee',
      tier: 'big',
      symbol: 'tee',
      label: 'Cinnamood T-Shirt',
      sub: 'Exclusive merch',
      stock: 1,
      weight: 2
    },
    {
      id: 'none',
      tier: 'none',
      symbol: null,
      label: 'Not This Time',
      // Deliberately no supporting line. A loss should be short and let the
      // person move on; anything added here either over-explains or makes a
      // promise about a future visit that the machine can't keep.
      sub: '',
      stock: 0,
      weight: 0
    }
  ],

  /* ---- FEEL --------------------------------------------------------------
     nearMissRate — of all the losing spins, what share should stop with two
     matching symbols and the third one agonisingly close. This is the single
     biggest lever on how exciting the machine feels. 0 = never tease,
     1 = tease on every loss (which gets tiring). 0.38 is a good place.

     holdMs       — how long the result stays on screen before easing away.
     cooldownMs   — lever stays locked this long after reset, so one person
                    can't chain spins while staff is still handing over.
  ------------------------------------------------------------------------- */
  feel: {
    nearMissRate: 0.38,
    holdMs: 10000,
    cooldownMs: 2500,
    idleAttractMs: 22000   // how long before the machine starts inviting people
  },

  /* ---- AUDIO -------------------------------------------------------------
     All sound is synthesised in the browser — there are no audio files to
     host, and nothing to load.

     Ships LOUD. Sound is on unless a staff member turns it off, either with
     the speaker button in the corner or in the staff panel — and that choice
     is remembered on the iPad.

     Safari still won't make a sound until the screen has been touched once,
     but that is no longer a problem: the guest now types their details before
     they can pull, so the machine is always unlocked well before it has
     anything to say.
  ------------------------------------------------------------------------- */
  audio: {
    startMuted: false,
    volume: 0.7
  },

  /* ---- GUEST DETAILS -----------------------------------------------------
     Nobody pulls the lever without leaving a name, a last name, an email and a
     phone number, and the same details never buy a second pull.

     armedTimeoutMs   — a guest has given their details but hasn't pulled. This
                        is how long the lever stays theirs before it locks again
                        and the form comes back. Without it, someone who signs
                        up and then wanders off hands a free pull to whoever
                        walks up next, recorded against their name. 0 = never
                        expire, which is only sensible if staff watch the
                        machine constantly.

     settingsVersion  — bump this to force every iPad back onto the file's
                        repeat rule, throwing away whatever was last chosen in
                        the panel on that device. Without it, an iPad where
                        someone had once opened the panel kept its own saved
                        setting forever, so turning testing mode off in this
                        file would have left that machine still accepting the
                        same guest over and over — with nothing on screen to
                        show it, since the panel would look correct on every
                        OTHER device. Bump it whenever the rule must change
                        everywhere at once.

     dedupeWindowDays — 0 means a set of details never plays twice, ever. This
                        is live now, and it is what was agreed: one pull per
                        guest.

                        -1 is TESTING MODE, where the same details may play
                        repeatedly so the machine can be demonstrated without
                        inventing a new email address for every pull. The staff
                        panel shows a red banner the whole time it is on. Set it
                        back to -1 for a demo, and bump settingsVersion when you
                        set it back to 0.

                        Set it to 30 and a guest may come back after a month,
                        which is what you want if this becomes a permanent
                        fixture rather than a campaign. Staff can also change
                        this in the
                        panel, and that choice wins over this file.

     consent          — shown under the button and STORED WITH EVERY LEAD, so
                        the record says what each guest was actually told
                        rather than what the wording happens to say today.
                        Check it against local rules before going live.
  ------------------------------------------------------------------------- */
  leads: {
    /* WHERE THE SECOND COPY GOES — the Google Sheet, directly.

       This briefly went via a small server on Netlify, which kept the
       passphrase private. That was the wrong trade for this machine and it is
       gone: every one of those server calls spends Netlify credits, the shop
       has a fixed allowance, and a machine that stops recording guests halfway
       through an event because a hosting quota ran out is a far worse outcome
       than a passphrase being readable.

       Going straight to Google also takes the host out of the path entirely.
       Once the page has loaded, the only thing between a guest and the sheet is
       Google — free, and nowhere near any quota this could reach.

       Both values sit in this file ON PURPOSE, so ANY iPad works the moment it
       opens the link. When they lived on each device, an iPad nobody
       remembered to set up looked perfectly normal while saving nowhere but
       itself, which is the worst kind of failure because nothing looks wrong.

       WHAT IT COSTS: this file is public, so anyone who looks can read both and
       write rows INTO the sheet. They cannot read the sheet, and they cannot
       touch the machine. If junk ever turns up, change the passphrase in the
       Apps Script and here, and redeploy.

       Staff can point one machine elsewhere in the panel; that wins over this. */
    syncUrl: 'https://script.google.com/macros/s/AKfycbwGZ7d3E0B_FmbxnfYMLjrL-FEdqvYkt00hOHXBoc7o83KWR9rGrJ_3aoFRcg5cB5_B/exec',
    syncKey: 'cinnamoodrolls',

    armedTimeoutMs: 90000,
    settingsVersion: 6,
    dedupeWindowDays: 0,         // LIVE: one pull per guest, no repeats ever.

    copy: {
      kicker: 'One pull per guest',
      title: 'Your details',
      sub: 'Fill these in and the lever is yours.',
      button: 'Play',
      consent: 'We keep your details to contact you about Cinnamood news and offers.'
    }
  },

  /* ---- SYMBOLS -----------------------------------------------------------
     What actually appears on the reels. Losing spins draw from these too,
     so keep at least 6 or the reels look repetitive. EVERY prize's symbol
     must be in here — a reel can only stop on a symbol it carries.
  ------------------------------------------------------------------------- */
  symbols: [
    'coffee', 'box2', 'box4', 'box6', 'mug', 'tee', 'tag', 'classic', 'heart'
  ]
};

/* ---------------------------------------------------------------------------
   Admin panel overrides live in localStorage and win over the file above.

   THE PRIZE LIST IS MERGED, NOT REPLACED — and this matters more than it looks.
   The old version did `base.prizes = patch.prizes`, so any iPad on which staff
   had ever opened the panel was permanently frozen on whatever prize list
   existed that day: a prize added in a later deploy would never appear, and one
   deleted from the file would keep paying out. Since the real prize list is
   still to come, every machine in the shop would have needed its storage
   cleared by hand.

   So: the FILE owns which prizes exist and what they are (`id`, `tier`,
   `symbol`, `stock`, `weight`) and the event clock. Storage owns only the
   wording staff may edit — `label` and `sub` — and only for prizes that still
   exist, and only within the same `version`.

   Stock and weights are deliberately NOT editable on the iPad any more. They
   decide whether the right prize goes out at the right time, and a slider
   nudged on a busy counter must not be able to change that.
   --------------------------------------------------------------------------- */
/* Clears every `cinnamood.` key once per stamp. Returns how many were cleared;
   0 when there was nothing to do or storage refused. */
function applyResetStamp(storage, stamp) {
  if (!stamp || !storage) return 0;
  try {
    if (storage.getItem('cinnamood.reset') === String(stamp)) return 0;
    const doomed = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.indexOf('cinnamood.') === 0) doomed.push(k);
    }
    doomed.forEach(k => storage.removeItem(k));
    storage.setItem('cinnamood.reset', String(stamp));
    return doomed.length;
  } catch (e) {
    return 0;
  }
}

function loadConfig() {
  const base = JSON.parse(JSON.stringify(CINNAMOOD_CONFIG));
  try {
    const saved = localStorage.getItem('cinnamood.config');
    if (!saved) return base;
    const patch = JSON.parse(saved);

    if (Array.isArray(patch.prizes) && patch.version === base.version) {
      const byId = new Map(patch.prizes.map(p => [p && p.id, p]));
      base.prizes.forEach(p => {
        const s = byId.get(p.id);
        if (!s) return;                       // prize is new in this deploy
        if (typeof s.label === 'string' && s.label.trim()) p.label = s.label;
        if (typeof s.sub === 'string') p.sub = s.sub;
      });
    }

    if (patch.feel)  Object.assign(base.feel,  pickKeys(patch.feel,  base.feel));
    if (patch.audio) Object.assign(base.audio, pickKeys(patch.audio, base.audio));
  } catch (e) { /* corrupt storage shouldn't take the machine down */ }
  return base;
}

/* Only copy keys the file already defines. A bare Object.assign would happily
   pull arbitrary junk out of storage into the live config. */
function pickKeys(src, shape) {
  const out = {};
  Object.keys(shape).forEach(k => { if (k in src) out[k] = src[k]; });
  return out;
}

function saveConfig(patch) {
  try {
    localStorage.setItem('cinnamood.config',
      JSON.stringify(Object.assign({ version: CINNAMOOD_CONFIG.version }, patch)));
  } catch (e) {
    /* Quota, or Safari Private Browsing. This runs from an `oninput` handler,
       so an uncaught throw here would break the control the staff member is
       currently dragging. Losing the save is survivable; losing the panel is not. */
  }
}

function resetConfig() {
  localStorage.removeItem('cinnamood.config');
}
