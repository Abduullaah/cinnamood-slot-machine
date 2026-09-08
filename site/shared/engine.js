/* ============================================================================
   CINNAMOOD — SLOT ENGINE
   ----------------------------------------------------------------------------
   Shared by all three visual approaches. The skins own how it LOOKS; this file
   owns how it BEHAVES, so the feel is identical across all three and you're
   comparing art direction rather than comparing two different machines.

   THE ONE IDEA WORTH KNOWING
   --------------------------
   The outcome is decided before the reels move. We roll the prize table once,
   then work backwards and tell each reel exactly where to land. Real slot
   machines work this way, and it's why the odds in config.js are exact — a
   1% jackpot is genuinely 1%, not "1% if the reel maths works out".

   It also buys the good part: because we know the result up front, we can
   choose to stage a near miss. Two reels agree, the third slows to a crawl,
   and the room leans in. That tension is the entire product.
   ============================================================================ */

/* ---------- small helpers ------------------------------------------------ */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp  = (a, b, t) => a + (b - a) * t;
const rand  = (a, b) => a + Math.random() * (b - a);
const pick  = arr => arr[Math.floor(Math.random() * arr.length)];

const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = t => t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2;

/* Overshoot-and-settle. This is the reel "snap" — it flies a touch past the
   payline then rocks back, the way a weighted mechanism actually would.
   Kept deliberately restrained: a big bounce reads as a cartoon, a small one
   reads as a heavy drum being caught by a detent. */
function easeOutBack(t, amount = 1.24) {
  const c3 = amount + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + amount * Math.pow(t - 1, 2);
}

/* Weighted draw from the prize table. */
function drawPrize(prizes) {
  const live = prizes.filter(p => (p.weight || 0) > 0);
  const total = live.reduce((s, p) => s + p.weight, 0);
  if (total <= 0) return prizes[prizes.length - 1];
  let r = Math.random() * total;
  for (const p of live) {
    r -= p.weight;
    if (r <= 0) return p;
  }
  return live[live.length - 1];
}

/* ============================================================================
   REEL
   ----------------------------------------------------------------------------
   Position is measured in symbol-heights, not pixels, so the same physics runs
   identically on a phone and on a 13" iPad. Rendering converts to pixels last.
   ============================================================================ */
class Reel {
  constructor(el, symbols, opts = {}) {
    this.el = el;
    this.rows = opts.rows || 3;
    this.index = opts.index || 0;

    this.strip = this._buildStrip(symbols);
    this.L = this.strip.length;

    /* Start on a whole symbol, not just anywhere. A fractional start puts every
       drum half a cell off its detent, so the machine's FIRST impression —
       before anyone has touched it — is three columns of cropped symbols with
       nothing sitting on the payline. Real drums rest in a detent; so do these. */
    this.pos = Math.floor(Math.random() * this.L);
    this.vel = 0;
    this.state = 'idle';

    this.maxVel = opts.maxVel || 26;     // symbols per second at full tilt
    this.slowVel = opts.slowVel || 3.4;  // the anticipation crawl

    this._t0 = 0;
    this._from = 0;
    this._to = 0;
    this._dur = 0;
    this._onLand = null;

    this._render();
  }

  /* Two of every symbol, shuffled so no two neighbours match. A reel that can
     show the same symbol twice in a row looks broken when it's blurred. */
  _buildStrip(symbols) {
    let strip = [];
    for (let i = 0; i < 2; i++) strip = strip.concat(symbols);
    for (let attempt = 0; attempt < 60; attempt++) {
      for (let i = strip.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [strip[i], strip[j]] = [strip[j], strip[i]];
      }
      let ok = true;
      for (let i = 0; i < strip.length; i++) {
        if (strip[i] === strip[(i + 1) % strip.length]) { ok = false; break; }
      }
      if (ok) break;
    }
    return strip;
  }

  /* Builds the DOM once: the strip is laid out twice end-to-end so it can wrap
     without ever rebuilding nodes mid-spin. */
  mount() {
    if (!this.el) { this._measure(); return; }
    const cells = [];
    for (let rep = 0; rep < 2; rep++) {
      for (let i = 0; i < this.L; i++) {
        cells.push(
          `<div class="cell" data-sym="${this.strip[i]}">${symbolSVG(this.strip[i])}</div>`
        );
      }
    }
    this.el.innerHTML = `<div class="strip">${cells.join('')}</div>`;
    this.stripEl = this.el.querySelector('.strip');
    this.cells = Array.from(this.el.querySelectorAll('.cell'));
    this._measure();
    this._render();
  }

  /* Cell height depends on the window height, which CSS can't derive on its
     own, so it's written as a custom property whenever the layout changes. */
  _measure() {
    if (!this.el) { this._cellH = 1; return; }
    this._cellH = this.el.clientHeight / this.rows;
    this.el.style.setProperty('--cell-h', this._cellH.toFixed(2) + 'px');
  }

  get cellH() {
    return this._cellH || (this.el.clientHeight / this.rows);
  }

  /* Which strip index is sitting on the payline right now. */
  get paylineIndex() {
    return ((Math.round(this.pos) % this.L) + this.L) % this.L;
  }

  get paylineSymbol() {
    return this.strip[this.paylineIndex];
  }

  /* Find somewhere on the strip showing `sym`. */
  findIndex(sym) {
    const cands = [];
    for (let i = 0; i < this.L; i++) if (this.strip[i] === sym) cands.push(i);
    return cands.length ? pick(cands) : 0;
  }

  /* STAGING A NEAR MISS.
     The payoff of a near miss is seeing the symbol you needed sitting one row
     above the line — close enough to touch. The obvious way to build that is to
     pick the tease symbol first and then hunt the strip for a spot where it sits
     directly above something else. That mostly fails: with 18 positions and 9
     symbols, any given ordered pair is adjacent somewhere only about a quarter
     of the time, so three out of four near misses quietly lost their tease and
     became ordinary losses with a slow third reel.

     So the constraint runs the other way. Pick a place on the strip where two
     different symbols already sit one above the other, and let THAT decide which
     symbol the near miss is about. Same drama, guaranteed every time, and the
     variety is better because it draws from all 18 adjacent pairs. */
  pickTeasePair() {
    const opts = [];
    for (let i = 0; i < this.L; i++) {
      const cur = this.strip[i];
      const above = this.strip[(i - 1 + this.L) % this.L];
      if (cur !== above) opts.push({ index: i, symbol: cur, above });
    }
    return opts.length ? pick(opts) : null;
  }

  spinUp(delay = 0) {
    this.state = 'accel';
    this._t0 = performance.now() + delay * 1000;
    this._accelDur = 0.42;
    this._armed = null;
  }

  /* ARMING vs STOPPING — the important bit.
     -------------------------------------------------------------------------
     A reel can only stop where its target symbol is, and that symbol might be
     anywhere from 1 to 18 positions away depending on where the reel happens to
     be at that instant. Stopping *immediately* on command therefore means the
     stop takes anywhere from 0.6s to 3.9s — which broke the choreography
     outright: the third reel's tease finished before the second reel had even
     landed, so the whole "two match, hold your breath" moment played backwards.

     So a stop is ARMED, not commanded. The reel keeps cruising at full speed —
     blurred, so nobody can tell — until the target comes round to exactly the
     right distance ahead, and only then does it begin the stop. The stop itself
     is now always the same length and always feels identical. The only thing
     that varies is a sub-second wait that is literally invisible.

     Worst-case wait is one strip revolution, L/maxVel ≈ 0.7s, which is what
     guarantees the reels can never land out of order. */
  armLand(targetIndex, opts = {}) {
    this._armed = { mode: 'land', idx: targetIndex,
                    dur: opts.dur ?? 0.9, onLand: opts.onLand || null,
                    onBegin: opts.onBegin || null, at: performance.now() };
  }

  armTease(targetIndex, opts = {}) {
    this._armed = { mode: 'tease', idx: targetIndex,
                    dur: opts.dur ?? 2.6, onLand: opts.onLand || null,
                    onBegin: opts.onBegin || null, at: performance.now() };
  }

  /* Called every frame while cruising: has the target come round yet? */
  _checkArmed() {
    const a = this._armed;
    if (!a) return;

    // How far this stop needs to travel, given the curve it will use and the
    // speed it's entering at. easeOutBack opens at ~4.24x average speed;
    // the quintic tease opens at 5x.
    const ideal = this.vel * a.dur / (a.mode === 'tease' ? 5 : 4.24);

    let to = Math.floor(this.pos) - (Math.floor(this.pos) % this.L) + a.idx;
    while (to <= this.pos) to += this.L;
    const dist = to - this.pos;

    /* At a healthy frame rate the target comes round within one strip
       revolution (~0.7s) and we always stop on the ideal distance. But this
       check only runs when a frame runs, so on a device that's dropping frames
       badly the reel could sail past the window repeatedly and wait forever —
       which is how reel three ends up finishing before reel two.

       So the wait is bounded. After ARM_WAIT we take the target wherever it is
       and stretch the stop to suit the distance instead. It's a slightly less
       perfect stop on a struggling device, in exchange for the choreography
       never coming apart. */
    const waited = (performance.now() - a.at) / 1000;
    const expired = waited > Reel.ARM_WAIT;
    if (dist > ideal && !expired) return;

    this._armed = null;
    // If we ran out of patience, scale the stop to the real distance so it
    // still decelerates naturally rather than snapping.
    const dur = expired
      ? clamp(dist / ideal * a.dur, a.dur * 0.6, a.dur * 2.4)
      : a.dur;

    if (a.mode === 'tease') {
      this.teaseTo(a.idx, { dur, minTease: 0, onLand: a.onLand });
      if (a.onBegin) a.onBegin(dur);
    } else {
      this.land(a.idx, { dur, minTravel: 0, onLand: a.onLand });
      if (a.onBegin) a.onBegin(dur);
    }
  }

  /* THE ANTICIPATION STOP.
     One continuous motion from full speed to dead stop on the target, using a
     quintic ease-out: it sheds most of its speed in the first half-second and
     then creeps the last symbol or two into place. That long tail is the tease.

     This is deliberately ONE move rather than "slow down, then stop later on a
     timer". The distance to the target varies by up to a full strip depending
     on where the reel happens to be, so any fixed stop time would produce a
     sprint on a long trip and a dawdle on a short one. Deriving the duration
     from the distance and the current speed keeps the FEEL constant even though
     the timing isn't — and the machine tells the caller how long it will take,
     so the tension sound can be cut to length.

     Returns the duration in seconds. */
  teaseTo(targetIndex, opts = {}) {
    const minTease = opts.minTease ?? 5;
    let to = Math.floor(this.pos) - (Math.floor(this.pos) % this.L) + targetIndex;
    while (to < this.pos + minTease) to += this.L;

    const dist = to - this.pos;
    const v0 = Math.max(this.vel, 1);
    const dur = clamp(5 * dist / v0, 1.7, 3.6);

    this.state = 'teasing';
    this._t0 = performance.now();
    this._from = this.pos;
    this._to = to;
    this._dur = dur;
    this._onLand = opts.onLand || null;
    return dur;
  }

  /* Commit to a landing. targetIndex is a strip index; the reel picks the
     nearest future wrap that gets there so it never visibly rewinds.

     The duration is derived from the distance rather than fixed. easeOutBack
     leaves the start of the curve at ~4.24x the average speed, so solving
     dur = 4.24 * distance / currentVelocity makes the landing begin at exactly
     the speed the reel is already doing. Without this you can see the reel
     lurch as it hands over from spinning to landing — and it's badly wrong on
     the anticipation stop, where a fixed duration would make a long crawl
     sprint and a short one dawdle. */
  land(targetIndex, opts = {}) {
    const minTravel = opts.minTravel ?? 6;

    let to = Math.floor(this.pos) - (Math.floor(this.pos) % this.L) + targetIndex;
    while (to < this.pos + minTravel) to += this.L;

    const dist = to - this.pos;
    const entrySpeed = Math.max(this.vel, this.maxVel * 0.5);
    const dur = opts.dur ?? clamp(4.24 * dist / entrySpeed, 0.62, 1.9);

    this.state = 'landing';
    this._t0 = performance.now();
    this._from = this.pos;
    this._to = to;
    this._dur = dur;
    this._onLand = opts.onLand || null;
    this._backAmount = opts.back ?? 0.95;
  }

  update(now, dt) {
    const t = (now - this._t0) / 1000;

    switch (this.state) {
      case 'accel': {
        if (t < 0) break;
        const k = clamp(t / this._accelDur, 0, 1);
        this.vel = this.maxVel * easeOutCubic(k);
        this.pos += this.vel * dt;
        if (k >= 1) { this.state = 'cruise'; }
        break;
      }
      case 'cruise': {
        // A whisper of wobble so it doesn't read as a CSS loop.
        this.vel = this.maxVel * (1 + Math.sin(now / 220) * 0.012);
        this.pos += this.vel * dt;
        this._checkArmed();
        break;
      }
      case 'teasing': {
        const k = clamp(t / this._dur, 0, 1);
        const prev = this.pos;
        this.pos = lerp(this._from, this._to, 1 - Math.pow(1 - k, 5));
        // Velocity is measured from the actual movement rather than assumed,
        // so the whirr pitch and the motion blur track the creep exactly.
        this.vel = dt > 0 ? (this.pos - prev) / dt : 0;
        if (k >= 1) {
          this.pos = this._to;
          this.vel = 0;
          this.state = 'settled';
          if (this._onLand) { const f = this._onLand; this._onLand = null; f(this); }
        }
        break;
      }
      case 'landing': {
        const k = clamp(t / this._dur, 0, 1);
        const e = easeOutBack(k, this._backAmount);
        this.pos = lerp(this._from, this._to, e);
        this.vel = (1 - k) * this.maxVel * 0.5;
        if (k >= 1) {
          this.pos = this._to;
          this.vel = 0;
          this.state = 'settled';
          if (this._onLand) { const f = this._onLand; this._onLand = null; f(this); }
        }
        break;
      }
    }
    this._render();
  }

  _render() {
    if (!this.stripEl) return;      // headless — nothing to paint
    const h = this.cellH;
    const wrapped = ((this.pos % this.L) + this.L) % this.L;

    /* Place the symbol at `wrapped` on the payline row. The strip is laid out
       twice end to end, and the offset is wrapped into [-L, 0) so the DOM
       always covers the window from top to bottom.

       Doing this naively — translateY = (offset - wrapped) * h — goes positive
       whenever `wrapped` is under 1, which pushes the strip DOWN and leaves a
       blank band across the top of the reel. It's only a 1-in-18 slice, easy to
       miss at rest, but a spinning reel crosses it every revolution: a white
       bar strobing through the symbols. */
    const offset = (this.rows - 1) / 2;
    const t = (((offset - wrapped) % this.L) + this.L) % this.L;
    const y = (t - this.L) * h;
    this.stripEl.style.transform = `translate3d(0, ${y.toFixed(2)}px, 0)`;

    // Velocity-driven motion blur. Capped hard, and the cap drops further if
    // the device is struggling — a dropped frame is far more noticeable than a
    // slightly crisper blur.
    const blur = clamp(this.vel * 0.34, 0, Reel.blurCap);
    const q = blur.toFixed(1) + 'px';
    if (q !== this._lastBlur) {
      this.el.style.setProperty('--reel-blur', q);
      this._lastBlur = q;
    }
    this.el.style.setProperty('--reel-speed', clamp(this.vel / this.maxVel, 0, 1).toFixed(2));
  }

  /* Called on resize — cell height changed, so re-measure and redraw. */
  relayout() { this._measure(); this._render(); }

  /* Jump straight to a strip index with no animation. Used only by the
     machine's watchdog — see the note on _raf(). */
  snapTo(targetIndex) {
    this._armed = null;
    this._onLand = null;
    let to = Math.floor(this.pos) - (Math.floor(this.pos) % this.L) + targetIndex;
    while (to <= this.pos) to += this.L;
    this.pos = to;
    this.vel = 0;
    this.state = 'settled';
    this._render();
  }
}
/* Shared blur ceiling, lowered automatically on devices that can't keep up. */
Reel.blurCap = 8;
/* Longest a reel will wait for its target to come round before settling for a
   less-than-ideal stop. One strip revolution is ~0.7s, so this is generous at a
   healthy frame rate and only ever bites on a struggling device. */
Reel.ARM_WAIT = 0.95;

/* ============================================================================
   SLOT MACHINE
   ============================================================================ */
class SlotMachine {
  constructor(opts) {
    this.cfg = opts.config;
    this.audio = opts.audio;
    this.reelEls = opts.reelEls;
    this.rows = opts.rows || 3;

    this.hooks = Object.assign({
      onSpinStart: () => {},
      onReelLand:  () => {},
      onAnticipate:() => {},
      onResult:    () => {},
      onReset:     () => {},
      onIdle:      () => {},
      onArmed:     () => {},
      onFinalReel: () => {}
    }, opts.hooks || {});

    this.reels = this.reelEls.map((el, i) =>
      new Reel(el, this.cfg.symbols, { rows: this.rows, index: i,
                                       maxVel: 26 + i * 1.6 })
    );
    this.reels.forEach(r => r.mount());

    this.state = 'idle';        // idle | spinning | revealing | cooldown
    this.lastResult = null;
    this._lastInteraction = performance.now();

    this._raf = this._raf.bind(this);
    requestAnimationFrame(this._raf);

    window.addEventListener('resize', () => this.reels.forEach(r => r.relayout()));
  }

  get canSpin() { return this.state === 'idle'; }

  /* ---- the spin -------------------------------------------------------- */
  spin() {
    if (!this.canSpin) return false;
    this.state = 'spinning';
    this._lastInteraction = performance.now();

    /* 1. Decide the result. Everything after this is choreography. */
    const prize = drawPrize(this.cfg.prizes);
    const isWin = prize.tier !== 'none';
    const nearMiss = !isWin && Math.random() < this.cfg.feel.nearMissRate;

    /* 2. Work out what each reel must show. */
    let targets;
    if (isWin) {
      targets = [prize.symbol, prize.symbol, prize.symbol];
    } else if (nearMiss) {
      // Two agree; the third lands with the matching symbol one row above the
      // payline — close enough to see, not close enough to count. The reel
      // itself chooses which pair, so the adjacency is guaranteed.
      const pair = this.reels[2].pickTeasePair();
      targets = [pair.above, pair.above, pair.symbol];
      this._teaseIndex = pair.index;
    } else {
      // A clean loss: three different symbols, no accidental pair.
      const pool = [...this.cfg.symbols];
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      targets = pool.slice(0, 3);
      this._teaseIndex = null;
    }

    this.pending = { prize, isWin, nearMiss, targets };
    this._spinStartedAt = performance.now();
    this.hooks.onSpinStart(this.pending);

    /* 3. Spin them up, staggered so it sounds like a mechanism, not a switch. */
    this.reels.forEach((r, i) => r.spinUp(i * 0.075));
    this.audio.startWhirr();

    /* 4. Start the chain. Only the FIRST stop is on a timer — see _stopReel. */
    clearTimeout(this._chainTimer);
    this._chainTimer = setTimeout(() => this._stopReel(0), SlotMachine.FIRST_STOP);

    return true;
  }

  /* THE CHAIN.
     Each reel is armed by the PREVIOUS reel actually landing, not by a
     stopwatch. Stopwatch scheduling looks fine until the device drops frames:
     a reel can only stop where its symbol is, so a stop takes a variable amount
     of time, and on a struggling device those variations stack up until reel
     three finishes before reel two — the tease resolving before the thing it's
     teasing. Chaining makes the order causal, so it simply cannot happen,
     whatever the frame rate does.

     It also reads better. Each reel now lands a beat after the one before it
     rather than on a fixed grid, which is how a real mechanism sounds. */
  _stopReel(i) {
    const r = this.reels[i];
    const sym = this.pending.targets[i];
    const last = i === 2;

    // The near-miss reel lands on the exact strip position picked when the spin
    // was planned, so the teased symbol is guaranteed to sit one row above.
    const idx = (last && this.pending.nearMiss && this._teaseIndex !== null)
      ? this._teaseIndex
      : r.findIndex(sym);

    /* Reel three gets the long treatment whenever the first two agree — which
       is true of every win AND every near miss. The player can't yet know which
       of the two they're watching, and that ambiguity is the tension. */
    const tease = last && this.pending.targets[0] === this.pending.targets[1];

    const done = () => {
      this.audio.reelStop(i);
      this.hooks.onReelLand(i, sym, this.pending);
      if (last) this._finish();
      else {
        clearTimeout(this._chainTimer);
        this._chainTimer = setTimeout(() => this._stopReel(i + 1),
                                      SlotMachine.CHAIN_GAP);
      }
    };

    if (tease) {
      r.armTease(idx, {
        dur: 2.9,
        onLand: done,
        onBegin: dur => {
          this.audio.tension(dur);      // sound cut to the exact creep length
          this.hooks.onAnticipate(this.pending);
          this.hooks.onFinalReel();
        }
      });
    } else {
      r.armLand(idx, { dur: 0.8, onLand: done });
    }
  }

  /* Abandon the animation and jump to the planned result. */
  _recover() {
    clearTimeout(this._chainTimer);
    this.reels.forEach((r, i) => {
      const sym = this.pending.targets[i];
      const idx = (i === 2 && this.pending.nearMiss && this._teaseIndex !== null)
        ? this._teaseIndex
        : r.findIndex(sym);
      r.snapTo(idx);
      this.hooks.onReelLand(i, sym, this.pending);
    });
    this._finish();
  }

  _finish() {
    clearTimeout(this._chainTimer);
    this.audio.stopWhirr();
    this.state = 'revealing';
    const result = this.pending;
    this.lastResult = result;

    // A beat of silence before the verdict lands. Rushing this is the single
    // fastest way to make the whole thing feel cheap.
    setTimeout(() => {
      if (result.isWin) this.audio.win(result.prize.tier);
      else this.audio.lose();
      this.hooks.onResult(result);

      // Hold the result, then quietly return to rest.
      this._holdTimer = setTimeout(() => this.reset(), this.cfg.feel.holdMs);
    }, 520);
  }

  /* Dismiss the result early — staff or customer can tap through. */
  dismiss() {
    if (this.state !== 'revealing') return false;
    clearTimeout(this._holdTimer);
    this.reset();
    return true;
  }

  reset() {
    clearTimeout(this._holdTimer);
    if (this.state === 'idle' || this.state === 'cooldown') return;
    this.state = 'cooldown';
    this.audio.reset();
    this.hooks.onReset();
    this._lastInteraction = performance.now();

    setTimeout(() => {
      this.state = 'idle';
      this.hooks.onArmed();
    }, this.cfg.feel.cooldownMs);
  }

  _raf(now) {
    const dt = Math.min((now - (this._prev || now)) / 1000, 0.05);
    this._prev = now;

    /* Adaptive blur. If frames start costing more than ~20ms we back the blur
       radius off rather than let the machine stutter — nobody has ever noticed
       a softer smear, everybody notices a hitch. */
    if (dt > 0.02) this._slowFrames = (this._slowFrames || 0) + 1;
    else this._slowFrames = Math.max(0, (this._slowFrames || 0) - 1);
    if (this._slowFrames > 12 && Reel.blurCap > 2) Reel.blurCap = 2;

    this.reels.forEach(r => r.update(now, dt));

    /* WATCHDOG.
       Reels decide when to stop from inside this animation loop, so if the
       browser stops painting mid-spin the loop pauses and an armed reel simply
       never lands — leaving the machine stuck 'spinning' forever with a dead
       lever. On a desk that's a curiosity; on an unattended iPad on a stand it's
       the whole thing bricked until someone thinks to reload the page.

       It happens for ordinary reasons: the screen locks, staff switch apps to
       take a call, the tab goes to the background. So if a spin has been going
       far longer than the ~7s any real spin takes, put the reels where they were
       always going to end up and finish properly. The player sees the correct
       result; they only miss an animation that wasn't being drawn anyway. */
    if (this.state === 'spinning' && now - this._spinStartedAt > 15000) {
      this._recover();
    }

    // Feed the whirr the speed of the fastest reel still turning.
    if (this.state === 'spinning') {
      const v = Math.max(...this.reels.map(r => r.vel));
      this.audio.updateWhirr(v / 26);
    }

    // Nobody has touched it in a while — start inviting people over.
    if (this.state === 'idle' &&
        now - this._lastInteraction > this.cfg.feel.idleAttractMs) {
      this._lastInteraction = now;
      this.hooks.onIdle();
    }

    requestAnimationFrame(this._raf);
  }

  noteInteraction() { this._lastInteraction = performance.now(); }
}

/* Choreography constants. FIRST_STOP is the only wall-clock timing in the whole
   spin — everything after it is chained off the previous reel landing. */
SlotMachine.FIRST_STOP = 1200;   // ms of free spinning before reel one arms
SlotMachine.CHAIN_GAP  = 120;    // beat between one reel landing and the next arming

/* ============================================================================
   LEVER
   ----------------------------------------------------------------------------
   Ball UP at rest; drag DOWN to spin, the way a real slot lever works. The
   resistance builds as you pull, it ratchets under the finger, and it springs
   back past rest before settling — so it feels sprung rather than animated.
   Releasing before ~55% travel aborts, which is what lets people play with it
   without accidentally burning a spin.

   FORESHORTENING (--fore)
   -----------------------
   A rigid arm swinging from straight-up to straight-down has to pass through
   horizontal, and at that moment it sticks out sideways by its entire length —
   which looks like a windscreen wiper, not a slot machine, and shoves the ball
   off the side of the screen.

   A real lever doesn't do that, because it swings toward you rather than across
   you. So the arm is SHORTENED as it passes horizontal and returned to full
   length at both ends of the travel. The eye reads that as rotation in depth,
   the ball stays on the machine, and the pull feels three dimensional without
   any actual 3D. Skins consume it as `--fore` on the arm's height.
   ============================================================================ */
class Lever {
  constructor(el, opts = {}) {
    this.el = el;
    this.audio = opts.audio;
    this.onPull = opts.onPull || (() => {});
    this.canPull = opts.canPull || (() => true);
    this.onProgress = opts.onProgress || (() => {});

    this.travel = opts.travel || 190;   // px of pull at AUTHORED size
    this.threshold = 0.55;

    /* The cabinet is authored at a fixed size and then scaled to fit the
       screen, so `travel` is in authored pixels while a finger moves in SCREEN
       pixels. Dividing one by the other made the lever a different length
       depending on the device: on a small window the ball crawled while the
       finger travelled the full 230px, and the pull could not be completed
       inside the height the lever visually occupies. The skin feeds the fit
       scale in here so a finger and the ball always move together. */
    this.scale = opts.scale || 1;

    this.value = 0;      // 0 rest → 1 fully pulled
    this.vel = 0;
    this.dragging = false;
    this._lastTick = 0;
    this._spring = null;

    this._bind();
    this._raf = this._raf.bind(this);
    requestAnimationFrame(this._raf);
  }

  _bind() {
    const down = e => {
      if (!this.canPull()) return;
      this.dragging = true;
      this._spring = null;
      this._startY = this._pointY(e);
      this._startVal = this.value;
      this.el.classList.add('grabbed');
      e.preventDefault();
    };
    const move = e => {
      if (!this.dragging) return;
      const dy = this._pointY(e) - this._startY;

      // Resistance curve: the last third of the pull fights back, which is
      // what makes the release feel earned.
      const raw = this._startVal + dy / (this.travel * this.scale);
      const v = raw <= 0 ? raw * 0.28 : (raw > 1 ? 1 + (raw - 1) * 0.12 : raw);
      this.value = clamp(v, -0.06, 1.06);

      // Ratchet teeth every 9% of travel.
      const tick = Math.floor(this.value / 0.09);
      if (tick !== this._lastTick && this.value > 0.02) {
        this._lastTick = tick;
        this.audio?.leverTick(clamp(this.value, 0, 1));
        if (navigator.vibrate) navigator.vibrate(6);
      }
      this.onProgress(clamp(this.value, 0, 1));
      e.preventDefault();
    };
    const up = () => {
      if (!this.dragging) return;
      this.dragging = false;
      this.el.classList.remove('grabbed');

      const fired = this.value >= this.threshold;
      if (fired) {
        this.audio?.leverRelease();
        if (navigator.vibrate) navigator.vibrate([18, 26, 40]);
        this.onPull();
      }
      // Spring home, overshooting past rest the way a real return spring does.
      this._spring = { t: performance.now(), from: this.value,
                       amp: fired ? 1 : 0.55 };
      this.value = this.value;
    };

    this.el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  /* Called on every layout, including orientation changes. A pull in progress
     keeps its current value: rescaling mid-drag would teleport the ball. */
  setScale(s) { this.scale = s > 0 ? s : 1; }

  _pointY(e) { return e.clientY ?? (e.touches && e.touches[0].clientY) ?? 0; }

  /* Nudge the lever a little, unprompted — used by attract mode. */
  tease() {
    if (this.dragging) return;
    this._tease = { t: performance.now() };
  }

  _raf(now) {
    if (!this.dragging) {
      if (this._spring) {
        const t = (now - this._spring.t) / 1000;
        const d = 0.62;
        if (t >= d) {
          this.value = 0; this._spring = null; this._lastTick = 0;
        } else {
          const k = t / d;
          // Damped oscillation home.
          this.value = this._spring.from * Math.cos(k * Math.PI * 2.4) *
                       Math.exp(-k * 5.2) * this._spring.amp;
        }
        this.onProgress(clamp(this.value, 0, 1));
      } else if (this._tease) {
        const t = (now - this._tease.t) / 1000;
        if (t >= 1.1) { this._tease = null; this.value = 0; }
        else {
          this.value = Math.sin(t * Math.PI / 1.1) * 0.17 *
                       Math.exp(-t * 0.7);
        }
        this.onProgress(clamp(this.value, 0, 1));
      }
    }

    const v = clamp(this.value, -0.06, 1.06);
    this.el.style.setProperty('--lever', v.toFixed(4));

    // Deepest at half travel, where the arm is horizontal and would otherwise
    // reach its full length out to the side.
    const fore = 1 - Lever.FORESHORTEN * Math.sin(Math.PI * clamp(v, 0, 1));
    this.el.style.setProperty('--fore', fore.toFixed(4));

    requestAnimationFrame(this._raf);
  }
}
/* How much of the arm's length is eaten at the midpoint of the swing.
   0 = flat 2D wiper, 1 = the arm vanishes. 0.42 reads as a natural arc. */
Lever.FORESHORTEN = 0.42;
