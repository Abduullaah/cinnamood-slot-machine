/* ============================================================================
   CINNAMOOD — SKIN BOOT
   ----------------------------------------------------------------------------
   Mounts the shared cabinet, wires it to the engine, starts the loop.
   All three approaches run this identical file — the ONLY thing that differs
   between them is CSS. So when you compare them you're comparing art direction,
   not three machines that happen to behave differently.
   ============================================================================ */

function bootSkin(opts = {}) {
  const W = opts.machineW || 780;
  const H = opts.machineH || 1320;
  const ROWS = opts.rows || 3;

  const cfg = loadConfig();
  const audio = new CinnaAudio(cfg.audio);

  /* ---- who is playing ----------------------------------------------------
     Nobody pulls this lever anonymously any more. `guest` holds the person
     whose details have been taken and who has therefore bought exactly one
     pull; it is set when the form is accepted and cleared the moment the
     result lands, which is the whole of the one-pull-per-guest rule.

     Declared up here because the machine's hooks and the lever's canPull both
     close over it, and both are built further down. */
  const leads = new LeadStore(cfg.leads || {});
  let gate = null;
  let guest = null;
  let guestTimer = null;

  /* NOTHING FAILS QUIETLY.

     This machine stands on its own for hours. If something throws — a browser
     quirk, an update that changed an API, a case nobody thought of — the only
     symptom staff see is a lever that stopped working, and by the time anyone
     mentions it there is nothing left to look at. So every uncaught error and
     rejected promise goes into the activity log, which survives reloads and
     can be copied out of the staff panel. */
  window.addEventListener('error', e => {
    const where = e.filename ? ' (' + String(e.filename).split('/').pop() +
                               ':' + e.lineno + ')' : '';
    leads._note('error', (e.message || 'Script error') + where);
  });
  window.addEventListener('unhandledrejection', e => {
    const r = e.reason;
    leads._note('error', 'Unhandled: ' + ((r && r.message) ? r.message : String(r)));
  });

  const $ = id => document.getElementById(id);
  const fit = $('fit');
  const machine = $('machine');
  const revealEl = $('reveal');
  const liveEl = $('live');

  /* ---- build the machine ------------------------------------------------ */
  machine.innerHTML = buildCabinet(cfg, { logo: opts.logo });

  /* ---- fit it to whatever screen it lands on ----------------------------
     The cabinet is authored once at a fixed size and scaled, so proportions can
     never drift and portrait vs landscape is a single number.

     The width budget includes SWING: at the midpoint of a pull the ball sweeps
     well outside the cabinet, and if that isn't reserved it gets clipped by the
     screen edge exactly when the customer is looking at it. OVERHANG_Y does the
     same for anything hanging above the cabinet, like Patisserie's awning. */
  const SWING = opts.swingPad ?? 140;
  const OVERHANG_Y = opts.overhangY ?? 0;

  /* layout() runs before the lever exists, so it can't close over the `const`
     below without tripping over the temporal dead zone. */
  let fitScale = 1;
  let leverRef = null;

  function layout() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const wide = vw / vh > 1.05;
    document.body.classList.toggle('wide', wide);

    const padX = wide ? 0.62 : 0.95;
    const padY = wide ? 0.93 : 0.90;
    const s = Math.min((vw * padX) / (W + SWING),
                       (vh * padY) / (H + OVERHANG_Y));

    // Centre on what's VISIBLE, not on the box: with an overhang above, the
    // box midpoint sits below the composition's midpoint and the machine hangs
    // low on the screen.
    fit.style.cssText =
      `position:absolute;left:50%;top:50%;width:${W}px;height:${H}px;` +
      `margin-left:${-W / 2}px;margin-top:${-H / 2 + OVERHANG_Y / 2}px;` +
      `transform-origin:center center;transform:scale(${s});`;

    /* The lever measures a pull in screen pixels but is authored in cabinet
       pixels, so it needs the same number the cabinet was scaled by. */
    fitScale = s;
    if (leverRef) leverRef.setScale(s);

    if (window._cm) window._cm.reels.forEach(r => r.relayout());
  }
  /* Bulbs are laid out in layout pixels, so they must be built after the
     cabinet has been sized — offsetWidth is 0 before first layout. */
  buildBulbs($('bulbs'), { gap: opts.bulbGap ?? 62,
                           rt: opts.bulbRt ?? 0, rb: opts.bulbRb ?? 0 });

  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', () => setTimeout(layout, 120));
  layout();

  /* ---- meters ----------------------------------------------------------- */
  let winsToday = 0;
  const meterWins = $('meterWins');
  const meterLast = $('meterLast');

  /* Real machines roll their counters rather than swapping the number, and it's
     a surprisingly large part of why they feel mechanical. */
  function rollTo(el, target) {
    if (!el) return;
    const from = parseInt(el.textContent, 10) || 0;
    if (target === from) return;
    const t0 = performance.now(), dur = 620;
    (function step(now) {
      const k = Math.min((now - t0) / dur, 1);
      el.textContent = Math.round(from + (target - from) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step);
      else { el.classList.add('bumped'); setTimeout(() => el.classList.remove('bumped'), 500); }
    })(t0);
  }

  /* ---- the machine ------------------------------------------------------ */
  const celebrate = new Celebration($('confetti'), $('confettiFront'));

  const m = new SlotMachine({
    config: cfg,
    audio,
    reelEls: [$('r0'), $('r1'), $('r2')],
    rows: ROWS,
    hooks: {
      onSpinStart() {
        machine.classList.add('spinning');
        machine.classList.remove('inviting', 'won', 'settling',
                                 'landed0', 'landed1', 'landed2',
                                 'knock0', 'knock1', 'knock2');
        document.body.classList.remove('revealing');
        document.body.classList.add('running');
        revealEl.classList.remove('tap-on');
        celebrate.clear();
        say('Reels spinning');
      },

      onAnticipate() { machine.classList.add('hot'); say('Two match — third reel slowing'); },

      /* The last reel is settling: everything else in the room quiets down. */
      onFinalReel() { machine.classList.add('settling'); },

      onReelLand(i) {
        /* A physical knock through the whole cabinet as each reel lands.
           ALL knock classes have to come off first. Removing only this reel's
           class left the previous one applied, and since every knock class sets
           the same `animation`, the computed value never changed — so the
           reflow restarted nothing and only the first reel ever shook. */
        machine.classList.remove('knock0', 'knock1', 'knock2');
        void machine.offsetWidth;              // force reflow so it re-runs
        machine.classList.add('knock' + i, 'landed' + i);
      },

      onResult(result) {
        machine.classList.remove('spinning', 'hot', 'settling');
        document.body.classList.remove('running');

        /* What this guest actually won, written back onto their own row rather
           than a second one — so the sheet reads one line per person and the
           team can see at a glance who is owed a roll. */
        if (guest) leads.attachResult(guest.id, result);
        clearGuest();
        if (result.isWin) {
          machine.classList.add('won');
          winsToday++;
          rollTo(meterWins, winsToday);
          if (meterLast) meterLast.textContent = result.prize.label;

          /* Light the row on the belly glass that just paid out. The paytable
             is printed from the real prize table, so it already knows this
             prize — having it stay inert while the machine celebrates is a
             missed connection between what you won and where it's written. */
          const row = machine.querySelector(
            `.pay-row[data-prize="${CSS.escape(result.prize.id)}"]`);
          if (row) {
            row.classList.add('paid');
            setTimeout(() => row.classList.remove('paid'), 6000);
          }
        }
        showReveal(result);
      },

      onReset() {
        document.body.classList.remove('revealing');
        revealEl.classList.remove('tap-on');
        machine.classList.add('locked');
        machine.classList.remove('won');
        celebrate.clear();
        say('Ready for the next pull');
      },

      /* The cooldown is over. Whether the lever is live now depends on whether
         anyone has signed up for it — if not, the form comes back instead. */
      onArmed() {
        if (guest) {
          machine.classList.remove('locked');
          machine.classList.add('inviting');
        } else {
          machine.classList.add('locked');
          gate && gate.open();
        }
      },

      onIdle() {
        if (m.state !== 'idle') return;
        // Don't tease a lever nobody can reach, and don't chirp at an empty
        // room over the top of the form.
        if (!guest || (gate && gate.open_)) return;
        machine.classList.add('inviting');
        lever.tease();
        audio.tick(true);
      }
    }
  });
  window._cm = m;

  /* ---- reveal ----------------------------------------------------------- */
  function showReveal(result) {
    const p = result.prize, win = result.isWin;

    $('cardTitle').textContent = p.label;
    $('cardSub').textContent = p.sub || '';
    $('cardKicker').textContent = win ? 'You won' : (result.nearMiss ? 'So close' : 'This pull');
    $('cardClaim').style.display = win ? '' : 'none';
    $('cardSym').innerHTML = symbolSVG(win ? p.symbol : 'heart');

    revealEl.classList.toggle('miss', !win);
    document.documentElement.style.setProperty('--hold', (cfg.feel.holdMs / 1000) + 's');

    setTimeout(() => {
      document.body.classList.add('revealing');
      revealEl.classList.add('tap-on');
      if (win) {
        const r = revealEl.getBoundingClientRect();
        celebrate.burst(p.tier, { x: r.width / 2, y: r.height * 0.4 });
        if (p.tier === 'jackpot') {
          setTimeout(() => celebrate.burst('big', { x: r.width * 0.22, y: r.height * 0.5 }), 380);
          setTimeout(() => celebrate.burst('big', { x: r.width * 0.78, y: r.height * 0.5 }), 620);
        }
      }
    }, opts.revealDelay ?? 620);   /* let the machine's own win flourish play
                                      first — the ring of light and the sweep
                                      across the glass are on the CABINET, and
                                      the card would otherwise cover them
                                      almost immediately. */

    say(win ? `You won ${p.label}` : p.label);
  }

  revealEl.addEventListener('pointerdown', () => { if (m.dismiss()) audio.tick(); });

  /* ---- lever ------------------------------------------------------------ */
  const lever = new Lever($('lever'), {
    audio,
    travel: opts.leverTravel || 230,
    canPull: () => m.canSpin && !!guest,
    onPull: () => m.spin(),
    onProgress: v => {
      machine.style.setProperty('--pull', v.toFixed(3));
      if (v > 0.02) m.noteInteraction();
    }
  });
  leverRef = lever;
  lever.setScale(fitScale);

  /* Reaching for the lever with no details on file opens the form. The Lever
     itself refuses the drag (canPull is false), so this listener is the only
     thing that happens — a guest who walks up and grabs the handle, which is
     what the machine is visibly asking them to do, gets the form rather than a
     dead lever and no explanation. */
  const askForDetails = () => {
    if (guest || !m.canSpin) return;
    gate && gate.open({ userGesture: true });
  };
  $('lever').addEventListener('pointerdown', askForDetails);
  machine.addEventListener('pointerdown', askForDetails);

  /* ---- sound ------------------------------------------------------------ */
  const muteBtn = $('mute');
  const ICON_ON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none"/>
      <path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/></svg>`;
  const ICON_OFF = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none"/>
      <path d="M17 9.5l4 5M21 9.5l-4 5"/></svg>`;

  function syncMute() { muteBtn.innerHTML = audio.muted ? ICON_OFF : ICON_ON; }
  muteBtn.addEventListener('click', e => {
    e.stopPropagation();
    audio.unlock(); audio.setMuted(!audio.muted); syncMute();
    /* Remember it. Sound now ships ON, so this button's only job is turning it
       off — and a mute that came back by itself after the next reload would be
       worse than no button at all. */
    cfg.audio.startMuted = audio.muted;
    saveConfig({ prizes: cfg.prizes, feel: cfg.feel, audio: cfg.audio });
    if (!audio.muted) audio.tick();
  });
  syncMute();

  /* Safari won't make a sound until the page has been touched once. */
  const unlock = () => { audio.unlock(); syncMute();
    window.removeEventListener('pointerdown', unlock); };
  window.addEventListener('pointerdown', unlock);

  /* ---- the guest gate --------------------------------------------------- */
  /* THE ARMED GUEST SURVIVES A RELOAD.

     Between handing over their details and pulling the lever there is a gap of
     a few seconds, and an iPad on a stand reloads inside that gap more often
     than you would think: Safari reaps a backgrounded tab, the screen locks,
     someone triple-taps, the wifi blips and the page refreshes. Before this,
     that guest lost their pull AND — with repeats switched off, which is how
     this ships — could never enter again, because their details were already
     recorded. They would be standing at the counter, correctly told they had
     already played, having never seen a reel turn.

     So the armed guest is written down, and picked back up on boot if it is
     still fresh and they never got a result. */
  const ARMED_KEY = 'cinnamood.armed';

  function rememberGuest(rec) {
    try {
      localStorage.setItem(ARMED_KEY, JSON.stringify({ id: rec.id, at: Date.now() }));
    } catch (e) { /* the machine still works, it just forgets across a reload */ }
  }

  function forgetGuest() {
    try { localStorage.removeItem(ARMED_KEY); } catch (e) {}
  }

  function restoreGuest() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(ARMED_KEY) || 'null'); } catch (e) {}
    forgetGuest();
    if (!saved || !saved.id) return null;

    // Stale claims are worse than none: a lever left armed overnight would hand
    // the first person through the door a free pull under someone else's name.
    const window_ = (cfg.leads && cfg.leads.armedTimeoutMs) || 90000;
    if (Date.now() - Number(saved.at || 0) > window_) return null;

    const rec = leads.list.find(r => r.id === saved.id);
    // Only if they never actually got a result.
    if (!rec || rec.won !== null) return null;
    return rec;
  }

  function setGuest(rec) {
    guest = rec;
    rememberGuest(rec);
    machine.classList.remove('locked');
    machine.classList.add('inviting');
    m.noteInteraction();

    /* Someone can hand over their details and then be called to the counter,
       or simply change their mind and walk off. Without this, the next person
       to touch the machine gets a free pull recorded against a stranger's
       name. After the timeout the lever locks again and the form comes back —
       the lead itself is kept, because they did give it to us. */
    clearTimeout(guestTimer);
    const wait = (cfg.leads && cfg.leads.armedTimeoutMs) || 0;
    if (wait > 0) {
      guestTimer = setTimeout(() => {
        if (!guest || m.state !== 'idle') return;
        clearGuest();
        gate.open();
      }, wait);
    }
    say(`Thank you ${rec.first}. Pull the lever.`);
  }

  function clearGuest() {
    guest = null;
    clearTimeout(guestTimer);
    forgetGuest();
    machine.classList.add('locked');
  }

  try {
    gate = new LeadGate(leads, {
      audio,
      copy: (cfg.leads && cfg.leads.copy) || {},
      onGuest: setGuest
    });
  } catch (err) {
    /* Without a form there is no way to take details, and the lever is locked
       behind having them — so the machine would sit dead with no explanation.
       Say so on screen instead, in the one place staff will look. */
    leads._note('error', 'The details form failed to build: ' + (err.message || err));
    const msg = document.createElement('div');
    msg.setAttribute('style',
      'position:fixed;inset:0;z-index:200;display:grid;place-items:center;' +
      'background:#1F040E;color:#F6F1EA;font:16px Verdana,sans-serif;' +
      'text-align:center;padding:8vmin;line-height:1.6');
    msg.textContent = 'This machine needs attention. Please close and reopen it.';
    document.body.appendChild(msg);
    return;
  }

  /* ---- staff panel ------------------------------------------------------ */
  new AdminPanel(m, audio, cfg, leads);

  function say(msg) { if (liveEl) liveEl.textContent = msg; }

  // Invite immediately rather than after an idle timeout — otherwise someone
  // walking up to a fresh machine sees a static object with no cue to touch it.
  machine.classList.add('inviting');

  /* The machine starts locked and asking — unless someone was mid-visit when
     the page reloaded, in which case they get the pull they already paid for
     rather than being turned away as a duplicate. */
  machine.classList.add('locked');
  const returning = restoreGuest();
  if (returning) {
    setGuest(returning);
    say(`Welcome back ${returning.first}. Pull the lever.`);
  } else {
    gate.open();
  }

  /* The arrival animation runs ONCE and is then taken away for good.
     `knock0/1/2` and `won` all set the same `animation` longhand on `.machine`,
     so while the arrival lived on the bare selector, removing any of those
     classes simply revealed it again and the whole cabinet re-dropped into
     frame — at the start of every spin, and after every single reveal. */
  machine.classList.add('booting');
  setTimeout(() => machine.classList.remove('booting'), 1000);

  /* ---- picking up a new version ------------------------------------------
     The iPad runs from its own cached copy, which is what lets it start with
     no network. The cost is that a published fix only appears on the SECOND
     reload — and a machine on a stand is never reloaded, so in practice it
     would never arrive at all.

     The worker tells us when a newer version has finished downloading, and we
     restart into it at a moment that cannot cost anyone their pull: nobody
     registered, nothing spinning, no result on screen. If someone is mid-visit
     the restart simply waits for them to finish. */
  let updateWaiting = false;

  function restartIfSafe() {
    if (!updateWaiting) return;
    if (guest || m.state !== 'idle' || (gate && gate.open_ && document.activeElement &&
        document.activeElement.tagName === 'INPUT')) return;
    leads._note('update', 'Restarting to pick up a new version');
    location.reload();
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', e => {
      if (!e.data || e.data.type !== 'cinnamood-updated') return;
      updateWaiting = true;
      restartIfSafe();
    });
  }
  // And try again whenever the machine falls back to rest.
  setInterval(restartIfSafe, 15000);

  // Three-finger tap resets a stuck demo without opening the panel.
  window.addEventListener('touchstart', e => { if (e.touches.length === 3) m.reset(); });

  // Keep the screen awake on the stand, where supported.
  if ('wakeLock' in navigator) {
    const keepAwake = () => navigator.wakeLock.request('screen').catch(() => {});
    keepAwake();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') keepAwake();
    });
  }

  return { m, audio, lever, celebrate, cfg };
}
