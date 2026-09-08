/* ============================================================================
   CINNAMOOD — THE GATE
   ----------------------------------------------------------------------------
   The details form that stands between a guest and the lever. No details, no
   pull — that is the whole of it.

   It is built from brand tokens only (the four colours, Lyno Stan, Verdana),
   so it belongs to whichever skin it lands in without being rewritten. A skin
   may override the look through the `--gate-*` variables at the top.

   THREE THINGS THAT LOOK LIKE POLISH AND ARE NOT
   ----------------------------------------------
   1. THE KEYBOARD. On an iPad the on-screen keyboard covers the bottom half of
      the screen, and the body of this app is `position:fixed` and cannot
      scroll — so a form centred in the viewport puts its own submit button
      underneath the keyboard, and the guest simply cannot finish. The card is
      lifted by the real keyboard height, read from visualViewport.

   2. AUTOFILL IS OFF. This is a shared device on a counter. Browser autofill
      would offer the previous guest's name and email to the next one, which is
      both a data leak and a way to record the wrong person.

   3. THE FIELDS ARE WIPED after every guest, for the same reason.
   ============================================================================ */

class LeadGate {
  constructor(store, opts = {}) {
    this.store = store;
    this.audio = opts.audio || null;
    this.copy = Object.assign({
      kicker: 'One pull per guest',
      title: 'Your details',
      sub: 'Fill these in and the lever is yours.',
      button: 'Play',
      consent: 'We keep your details to contact you about Cinnamood news and offers.'
    }, opts.copy || {});
    this.onGuest = opts.onGuest || (() => {});

    this.open_ = false;
    this._build();
    this._bindKeyboard();
  }

  /* ---- markup ------------------------------------------------------------ */

  _build() {
    this._injectStyles();

    const root = document.createElement('div');
    root.className = 'cm-gate';
    root.setAttribute('aria-hidden', 'true');
    /* No guest data is interpolated anywhere in here — every value written
       back into this markup goes through textContent or .value, never
       innerHTML — so a name containing a quote or a tag cannot break it. */
    root.innerHTML = `
      <div class="cm-gate-scrim"></div>
      <form class="cm-gate-card" novalidate autocomplete="off"
            role="dialog" aria-modal="true" aria-labelledby="cm-gate-title">
        <p class="cm-gate-kicker"></p>
        <h2 class="cm-gate-title" id="cm-gate-title"></h2>
        <p class="cm-gate-sub"></p>

        <div class="cm-gate-grid">
          <label class="cm-gate-f" data-for="first">
            <span>First name</span>
            <input name="cm-f" type="text" autocomplete="off" autocapitalize="words"
                   autocorrect="off" spellcheck="false" enterkeyhint="next" maxlength="60">
            <i class="cm-gate-fe"></i>
          </label>
          <label class="cm-gate-f" data-for="last">
            <span>Last name</span>
            <input name="cm-l" type="text" autocomplete="off" autocapitalize="words"
                   autocorrect="off" spellcheck="false" enterkeyhint="next" maxlength="60">
            <i class="cm-gate-fe"></i>
          </label>
          <label class="cm-gate-f cm-gate-wide" data-for="email">
            <span>Email</span>
            <input name="cm-e" type="email" inputmode="email" autocomplete="off"
                   autocapitalize="off" autocorrect="off" spellcheck="false"
                   enterkeyhint="next" maxlength="120">
            <i class="cm-gate-fe"></i>
          </label>
          <label class="cm-gate-f cm-gate-wide" data-for="phone">
            <span>Phone</span>
            <input name="cm-p" type="tel" inputmode="tel" autocomplete="off"
                   autocorrect="off" spellcheck="false" enterkeyhint="go" maxlength="32">
            <i class="cm-gate-fe"></i>
          </label>
        </div>

        <p class="cm-gate-alert" role="alert" hidden></p>
        <button class="cm-gate-go" type="submit"></button>
        <p class="cm-gate-fine"></p>
      </form>`;
    document.body.appendChild(root);

    this.root = root;
    this.form = root.querySelector('.cm-gate-card');
    this.alert = root.querySelector('.cm-gate-alert');
    this.fields = {};
    root.querySelectorAll('.cm-gate-f').forEach(l => {
      this.fields[l.dataset.for] = {
        wrap: l,
        input: l.querySelector('input'),
        err: l.querySelector('.cm-gate-fe')
      };
    });

    root.querySelector('.cm-gate-kicker').textContent = this.copy.kicker;
    root.querySelector('.cm-gate-title').textContent = this.copy.title;
    root.querySelector('.cm-gate-sub').textContent = this.copy.sub;
    root.querySelector('.cm-gate-go').textContent = this.copy.button;
    root.querySelector('.cm-gate-fine').textContent = this.copy.consent;

    this.form.addEventListener('submit', e => { e.preventDefault(); this._submit(); });

    /* Enter moves down the form rather than submitting from the first field —
       the hardware-keyboard equivalent of the Next key on the iPad. */
    const order = ['first', 'last', 'email', 'phone'];
    order.forEach((k, i) => {
      const f = this.fields[k];
      f.input.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (i < order.length - 1) this.fields[order[i + 1]].input.focus();
        else this._submit();
      });
      // Clear a field's own error the moment it is being fixed. Leaving it
      // sitting there while someone types the correction reads as if the
      // correction is also wrong.
      f.input.addEventListener('input', () => this._clearFieldError(k));
    });

    /* Taps inside the card must not reach the machine behind it. */
    this.form.addEventListener('pointerdown', e => e.stopPropagation());
  }

  /* ---- the on-screen keyboard -------------------------------------------
     visualViewport is the only reliable measure of how much screen the
     keyboard is actually eating. Everything else (window.innerHeight, focus
     events, guessing 300px) is wrong on at least one iPad. */
  _bindKeyboard() {
    const vv = window.visualViewport;
    if (!vv) return;
    const apply = () => {
      const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      // Lifting by the full keyboard height would push the top of the card off
      // the screen on a short form; a bit over half clears the button and keeps
      // the heading visible.
      this.root.style.setProperty('--cm-kb', Math.round(covered * 0.55) + 'px');
      this.root.classList.toggle('cm-kb-up', covered > 80);

      /* And cap the card to the space actually left.

         `max-height:100%` measures the LAYOUT viewport, which does not shrink
         when the keyboard appears — so on an iPad in landscape, where the
         keyboard eats nearly half the screen, the card stayed its full height
         and its bottom (the Play button) sat behind the keys with no way to
         scroll to it. Feeding the real visible height in makes the card scroll
         inside itself instead. */
      this.root.style.setProperty('--cm-vh', Math.round(vv.height) + 'px');
    };
    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
  }

  /* ---- open / close ------------------------------------------------------ */

  open(opts = {}) {
    if (this.open_) return;
    this.open_ = true;
    this._reset();
    this.root.classList.add('open');
    this.root.setAttribute('aria-hidden', 'false');
    document.body.classList.add('gated');
    /* Only grab focus when a person just tapped something. Focusing on boot
       would throw the keyboard up over an idle kiosk nobody is standing at. */
    if (opts.userGesture) {
      setTimeout(() => { try { this.fields.first.input.focus(); } catch (e) {} }, 260);
    }
  }

  close() {
    if (!this.open_) return;
    this.open_ = false;
    this.root.classList.remove('open');
    this.root.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('gated');
    // Blur before hiding, or iOS keeps the keyboard up over the machine.
    try { document.activeElement && document.activeElement.blur(); } catch (e) {}
  }

  _reset() {
    Object.keys(this.fields).forEach(k => {
      this.fields[k].input.value = '';
      this._clearFieldError(k);
    });
    this.alert.hidden = true;
    this.alert.textContent = '';
    this.root.classList.remove('cm-kb-up');
  }

  /* ---- errors ------------------------------------------------------------ */

  _clearFieldError(k) {
    const f = this.fields[k];
    if (!f) return;
    f.wrap.classList.remove('bad');
    f.err.textContent = '';
  }

  _showErrors(errs) {
    Object.keys(this.fields).forEach(k => this._clearFieldError(k));
    let firstBad = null;
    Object.keys(errs).forEach(k => {
      const f = this.fields[k];
      if (!f) return;
      f.wrap.classList.add('bad');
      f.err.textContent = errs[k];
      if (!firstBad) firstBad = f.input;
    });
    if (firstBad) { try { firstBad.focus(); } catch (e) {} }
  }

  _showAlert(msg) {
    this.alert.textContent = msg;
    this.alert.hidden = false;
    this.form.classList.remove('shake');
    void this.form.offsetWidth;      // restart the animation
    this.form.classList.add('shake');
  }

  /* ---- submit ------------------------------------------------------------ */

  async _submit() {
    if (this._busy) return;
    const fields = {
      first: this.fields.first.input.value,
      last: this.fields.last.input.value,
      email: this.fields.email.input.value,
      phone: this.fields.phone.input.value
    };

    /* ---- ask the sheet first ---------------------------------------------
       The store below only knows this iPad. The rule is that no email and no
       phone plays twice anywhere, so before anything is written the sheet gets
       asked — it is the one place that has seen every guest from every
       machine.

       This is the only moment in the whole machine that waits on the network,
       so the button says what is happening rather than appearing to have been
       ignored. If the sheet cannot answer, askSheet returns null and the
       decision falls back to the iPad's own record. */
    const btn = this.form.querySelector('.cm-gate-go');
    if (!this.store.dedupeOff) {
      this._busy = true;
      const label = btn.textContent;
      btn.textContent = 'Checking…';
      btn.disabled = true;
      let seen = null;
      try {
        seen = await this.store.askSheet(fields);
      } finally {
        btn.textContent = label;
        btn.disabled = false;
        this._busy = false;
      }

      if (seen) {
        Object.keys(this.fields).forEach(k => this._clearFieldError(k));
        const w = seen === 'email' ? 'email address' : 'phone number';
        this._showAlert(`That ${w} has already had its pull. One per guest — ` +
                        `speak to our team if that doesn't sound right.`);
        if (this.fields[seen]) this.fields[seen].wrap.classList.add('bad');
        this.audio && this.audio.tick();
        return;
      }

      /* The sheet answered "never seen them". THE SHEET WINS.

         The iPad's own record is asked second, and only when the sheet could
         not answer at all. It used to be asked first, which quietly broke the
         one thing the sheet is for: deleting a row, or clearing the sheet for a
         fresh start, left every iPad that had met that guest refusing them
         forever, with the sheet plainly empty. Clearing the sheet is now a real
         reset everywhere. */
      if (seen === false) this.store.forgetSynced(fields);
    }

    const res = this.store.add(fields, { consent: this.copy.consent });

    if (!res.ok && res.reason === 'invalid') {
      this.alert.hidden = true;
      this._showErrors(res.errs);
      this.audio && this.audio.tick();
      return;
    }

    if (!res.ok && res.reason === 'duplicate') {
      Object.keys(this.fields).forEach(k => this._clearFieldError(k));
      const which = res.field === 'email' ? 'email address' : 'phone number';
      this._showAlert(`That ${which} has already had its pull. One per guest — ` +
                      `speak to our team if that doesn't sound right.`);
      this.fields[res.field].wrap.classList.add('bad');
      this.audio && this.audio.tick();
      return;
    }

    if (!res.ok) { this._showAlert('Something went wrong. Please try again.'); return; }

    /* Locked for a beat so a double-tap on the button cannot register the same
       guest twice — the second tap would be caught by the duplicate check and
       show an error to someone who has done nothing wrong. */
    this._busy = true;
    setTimeout(() => { this._busy = false; }, 700);

    this.audio && this.audio.unlock();
    this.audio && this.audio.tick();
    this.close();
    this.onGuest(res.record);
  }

  /* ---- styles ------------------------------------------------------------ */

  _injectStyles() {
    if (document.getElementById('cm-gate-css')) return;
    const css = `
    .cm-gate{
      --gate-ink:var(--cream,#F6F1EA);
      --gate-dim:var(--blush,#F3DBEA);
      --gate-edge:rgba(209,139,141,.5);
      --gate-panel:radial-gradient(120% 100% at 50% -10%, #6E1740, #2A0714 76%);
      --gate-field:rgba(0,0,0,.28);
      --cm-kb:0px;
      position:fixed; inset:0; z-index:60;
      display:grid; place-items:center;
      /* Keep the card clear of the home indicator and any notch when this is
         running full screen from the iPad's home screen. */
      padding:
        calc(4vmin + env(safe-area-inset-top, 0px))
        calc(4vmin + env(safe-area-inset-right, 0px))
        calc(4vmin + env(safe-area-inset-bottom, 0px))
        calc(4vmin + env(safe-area-inset-left, 0px));
      visibility:hidden; transition:visibility 0s linear .34s;
    }
    .cm-gate.open{ visibility:visible; transition-delay:0s; }

    .cm-gate-scrim{
      position:absolute; inset:0; opacity:0;
      background:radial-gradient(70% 54% at 50% 44%, rgba(94,18,49,.6), rgba(12,2,6,.94));
      transition:opacity .45s ease;
    }
    .cm-gate.open .cm-gate-scrim{ opacity:1; }

    .cm-gate-card{
      position:relative; width:min(560px,100%);
      /* --cm-vh is the height the keyboard has actually left us; it falls back
         to the full box before visualViewport has reported anything. */
      max-height:min(100%, calc(var(--cm-vh, 100vh) - 6vmin));
      overflow:auto; -webkit-overflow-scrolling:touch;
      overscroll-behavior:contain;
      padding:clamp(22px,3.6vmin,38px) clamp(20px,3.4vmin,40px) clamp(20px,3vmin,32px);
      border-radius:clamp(18px,2.6vmin,28px);
      background:var(--gate-panel);
      box-shadow:0 0 0 1.5px var(--gate-edge), 0 0 0 3px rgba(0,0,0,.5),
                 inset 0 1px 0 rgba(233,203,203,.26), inset 0 0 60px rgba(0,0,0,.45),
                 0 44px 80px -30px rgba(0,0,0,.85);
      opacity:0; translate:0 40px; scale:.96;
      transition:opacity .4s cubic-bezier(.4,0,.2,1),
                 translate .6s cubic-bezier(.16,1,.3,1),
                 scale .6s cubic-bezier(.16,1,.3,1);
    }
    .cm-gate.open .cm-gate-card{ opacity:1; translate:0 0; scale:1; }
    .cm-gate.cm-kb-up .cm-gate-card{ translate:0 calc(var(--cm-kb) * -1); }

    @keyframes cmGateShake{
      0%,100%{ margin-left:0 } 20%{ margin-left:-9px } 40%{ margin-left:8px }
      60%{ margin-left:-5px } 80%{ margin-left:3px }
    }
    .cm-gate-card.shake{ animation:cmGateShake .42s ease; }

    .cm-gate-kicker{
      font-family:var(--font-display); text-transform:uppercase;
      font-size:clamp(10px,1.5vmin,13px); letter-spacing:.4em; padding-left:.4em;
      color:var(--rose,#D18B8D); opacity:.9; text-align:center;
    }
    .cm-gate-title{
      font-family:var(--font-display); text-transform:uppercase;
      font-size:clamp(28px,5vmin,46px); line-height:1; letter-spacing:.02em;
      color:var(--gate-ink); text-align:center; margin-top:.35em;
      text-shadow:0 0 50px rgba(246,241,234,.35);
    }
    .cm-gate-sub{
      font-family:var(--font-body); text-align:center;
      font-size:clamp(12px,1.75vmin,15px); color:var(--gate-dim); opacity:.72;
      margin-top:.9em;
    }

    .cm-gate-grid{
      display:grid; grid-template-columns:1fr 1fr; gap:clamp(10px,1.6vmin,16px);
      margin-top:clamp(18px,2.8vmin,28px);
    }
    .cm-gate-wide{ grid-column:1 / -1; }
    @media (max-width:420px){ .cm-gate-grid{ grid-template-columns:1fr; } }

    .cm-gate-f{ display:block; position:relative; }
    .cm-gate-f > span{
      display:block; font-family:var(--font-body);
      font-size:clamp(10px,1.35vmin,12px); letter-spacing:.14em;
      text-transform:uppercase; color:var(--gate-dim); opacity:.6;
      margin-bottom:.5em;
    }
    .cm-gate-f input{
      display:block; width:100%; border:0; border-radius:12px;
      background:var(--gate-field);
      box-shadow:inset 0 0 0 1.5px rgba(209,139,141,.34),
                 inset 0 2px 8px rgba(0,0,0,.4);
      color:var(--gate-ink); font-family:var(--font-body);
      /* 16px is the floor at which iOS stops zooming the page on focus. */
      font-size:16px; padding:14px 14px; min-height:52px;
      -webkit-user-select:text; user-select:text;
      -webkit-appearance:none; appearance:none;
      transition:box-shadow .2s ease, background .2s ease;
    }
    .cm-gate-f input:focus{
      outline:none; background:rgba(0,0,0,.4);
      box-shadow:inset 0 0 0 2px var(--rose,#D18B8D),
                 inset 0 2px 8px rgba(0,0,0,.4), 0 0 22px rgba(209,139,141,.3);
    }
    .cm-gate-f.bad input{
      box-shadow:inset 0 0 0 2px rgba(246,241,234,.85), inset 0 2px 8px rgba(0,0,0,.4);
    }
    .cm-gate-fe{
      display:block; font-family:var(--font-body); font-style:normal;
      font-size:clamp(10px,1.3vmin,12px); color:var(--gate-ink);
      opacity:.9; margin-top:.45em; min-height:1.2em;
    }
    .cm-gate-fe:empty{ min-height:0; }

    .cm-gate-alert{
      font-family:var(--font-body); font-size:clamp(12px,1.7vmin,14px);
      color:var(--gate-ink); text-align:center; line-height:1.5;
      margin-top:clamp(12px,1.8vmin,18px);
      padding:12px 14px; border-radius:12px;
      background:rgba(0,0,0,.34); box-shadow:inset 0 0 0 1.5px rgba(246,241,234,.4);
    }

    .cm-gate-go{
      display:block; width:100%; margin-top:clamp(16px,2.4vmin,24px);
      /* min-height, not just padding: at the small end of the clamp this button
         fell under the 44pt Apple asks for, and it is the single control the
         whole machine depends on someone hitting first time. */
      min-height:56px;
      padding:clamp(14px,2vmin,18px); border:0; border-radius:999px; cursor:pointer;
      background:linear-gradient(180deg, rgba(209,139,141,.9), rgba(172,30,85,.92));
      box-shadow:0 0 0 1.5px rgba(233,203,203,.5), inset 0 1px 0 rgba(246,241,234,.5),
                 0 10px 26px rgba(0,0,0,.5), 0 0 40px rgba(172,30,85,.4);
      font-family:var(--font-display); text-transform:uppercase;
      font-size:clamp(16px,2.6vmin,22px); letter-spacing:.24em; padding-left:.24em;
      color:var(--cream,#F6F1EA); text-shadow:0 1px 10px rgba(0,0,0,.4);
      transition:transform .12s ease, filter .2s ease;
    }
    .cm-gate-go:active{ transform:scale(.978); filter:brightness(1.1); }

    .cm-gate-fine{
      font-family:var(--font-body); text-align:center; line-height:1.55;
      font-size:clamp(9.5px,1.25vmin,11.5px); color:var(--gate-dim);
      opacity:.5; margin-top:clamp(12px,1.8vmin,18px);
    }

    /* The machine keeps playing behind the form, just out of focus — it is the
       reason anyone is filling this in. */
    body.gated .fit{ filter:blur(7px) brightness(.5); }
    .fit{ transition:filter .5s ease; }

    @media (prefers-reduced-motion: reduce){
      .cm-gate-card{ transition:opacity .2s linear; translate:none; scale:1; }
      .cm-gate-card.shake{ animation:none; }
    }`;
    const el = document.createElement('style');
    el.id = 'cm-gate-css';
    el.textContent = css;
    document.head.appendChild(el);
  }
}
