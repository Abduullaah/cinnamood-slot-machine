/* ============================================================================
   CINNAMOOD SLOT MACHINE — CONFIGURATION
   ----------------------------------------------------------------------------
   This is the single source of truth for prizes and odds.
   Everything below is PLACEHOLDER until the real prize list is confirmed.

   HOW THE ODDS WORK
   -----------------
   Real slot machines do NOT spin randomly and see what lands. They decide the
   outcome first, then arrange the reels to show it. We do the same. That means
   `weight` below is the ONLY thing controlling how often a prize is won —
   no reel-symbol maths, no surprises.

   weight = relative chance. If the weights are 1 / 8 / 12 / 20 / 59, they sum
   to 100, so they read directly as percentages. They don't have to sum to 100;
   they're normalised automatically. Set a weight to 0 to retire a prize
   without deleting it.
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
  version: 1,

  /* ---- PRIZES ------------------------------------------------------------
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
      symbol: 'box',
      label: 'Box of Six',
      sub: 'A full box, on the house',
      weight: 1
    },
    {
      id: 'classic',
      tier: 'big',
      symbol: 'classic',
      label: 'Free Classic Roll',
      sub: 'Warm from the oven',
      weight: 7
    },
    {
      id: 'pistachio',
      tier: 'big',
      symbol: 'pistachio',
      label: 'Free Pistachio Roll',
      sub: 'The one everyone asks for',
      weight: 5
    },
    {
      id: 'latte',
      tier: 'mid',
      symbol: 'latte',
      label: 'Free Iced Latte',
      sub: 'Any size you like',
      weight: 12
    },
    {
      id: 'off20',
      tier: 'small',
      symbol: 'tag',
      label: '20% Off',
      sub: 'On your order today',
      weight: 16
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
      weight: 59
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
    syncUrl: 'https://script.google.com/macros/s/AKfycbzVBC19m5OdKM5RgYfd5gIhMn8KGKiulCfYES7u5GRIkwOLTzucOP-TA-CguCHuGNDa/exec',
    syncKey: 'cinnamoodrolls',

    armedTimeoutMs: 90000,
    settingsVersion: 2,
    dedupeWindowDays: 0,         // LIVE: one pull per guest, no repeats ever.

    copy: {
      kicker: 'One pull per guest',
      title: 'Your details',
      sub: 'Fill these in and the lever is yours.',
      button: 'Play',
      consent: 'We keep your details to contact you about Cinnamood news and offers. ' +
               'Ask our team any time to be removed.'
    }
  },

  /* ---- SYMBOLS -----------------------------------------------------------
     What actually appears on the reels. Losing spins draw from these too,
     so keep at least 6 or the reels look repetitive.
  ------------------------------------------------------------------------- */
  symbols: [
    'classic', 'pistachio', 'sticks', 'chocolate', 'latte', 'coffee', 'tag', 'box', 'heart'
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
   `symbol`). Storage owns only what staff are allowed to tune — `weight`,
   `label`, `sub` — and only for prizes that still exist. Bump PRIZE_LIST_VERSION
   in config whenever the real list lands to drop stale staff weights entirely.
   --------------------------------------------------------------------------- */
function loadConfig() {
  const base = JSON.parse(JSON.stringify(CINNAMOOD_CONFIG));
  try {
    const saved = localStorage.getItem('cinnamood.config');
    if (!saved) return base;
    const patch = JSON.parse(saved);

    if (Array.isArray(patch.prizes)) {
      const sameGeneration = patch.version === base.version;
      const byId = new Map(patch.prizes.map(p => [p && p.id, p]));
      base.prizes.forEach(p => {
        const s = byId.get(p.id);
        if (!s) return;                       // prize is new in this deploy
        // Labels and copy carry across generations; tuned odds do not, because
        // a weight only means something relative to the list it was set on.
        if (typeof s.label === 'string' && s.label.trim()) p.label = s.label;
        if (typeof s.sub === 'string') p.sub = s.sub;
        if (sameGeneration && Number.isFinite(Number(s.weight))) {
          p.weight = Math.max(0, Number(s.weight));
        }
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
