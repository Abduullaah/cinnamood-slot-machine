/* ============================================================================
   CINNAMOOD — CELEBRATION
   ----------------------------------------------------------------------------
   Confetti is where cheap slot machines give themselves away: too much, too
   fast, too many colours. This one throws soft rounded petals in brand tints
   only, with real air drag and flutter, and it scales with the prize tier — a
   20% off gets a polite scatter, the jackpot gets the room.

   Three things here are not obvious and all three matter:

   1. EVERYTHING is per-second, never per-frame. The iPad Pro this runs on is a
      120Hz device. Rotation and drag used to be applied once per frame while
      position was already time-based, so on ProMotion the pieces spun twice as
      fast and decelerated twice as hard as designed — and the tumble drifted
      out of step with the foreshortening, which is exactly what stops a piece
      of paper reading as one solid object.

   2. Pieces are EMITTED OVER TIME, not all in one frame. 190 shapes appearing
      simultaneously out of an 80x40 box is a pop, not a burst.

   3. Some pieces fly IN FRONT of the prize card and some behind it. A single
      canvas under the card puts the whole celebration on one flat plane; the
      depth is what makes it feel like it's happening in the room.
   ============================================================================ */

class Celebration {
  constructor(canvas, frontCanvas = null) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    // Optional second canvas stacked ABOVE the prize card. Without it
    // everything still works, it just all runs behind.
    this.fc = frontCanvas;
    this.fctx = frontCanvas ? frontCanvas.getContext('2d') : null;

    this.parts = [];
    this.queue = [];          // pieces waiting to be emitted
    this.running = false;
    this._rafId = null;

    this._onResize = () => this._resize();
    this._resize();
    window.addEventListener('resize', this._onResize);
    this._raf = this._raf.bind(this);

    this.reduced = window.matchMedia &&
                   window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  _resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const prevW = this.w, prevH = this.h;
    this.w = this.c.clientWidth;
    this.h = this.c.clientHeight;

    [[this.c, this.ctx], [this.fc, this.fctx]].forEach(([el, cx]) => {
      if (!el) return;
      el.width = this.w * dpr;
      el.height = this.h * dpr;
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    });

    /* Rescale anything already in flight. Rotating the iPad mid-celebration
       used to leave the burst hanging off the old centre. */
    if (prevW && prevH && (prevW !== this.w || prevH !== this.h)) {
      const sx = this.w / prevW, sy = this.h / prevH;
      this.parts.forEach(p => { p.x *= sx; p.y *= sy; });
    }
  }

  destroy() {
    window.removeEventListener('resize', this._onResize);
    if (this._rafId !== null) cancelAnimationFrame(this._rafId);
    this._rafId = null;
    this.running = false;
    this.parts.length = 0;
    this.queue.length = 0;
  }

  /* tier: small | mid | big | jackpot */
  burst(tier = 'mid', origin = null) {
    if (this.reduced) return;   // a 370-piece jackpot is not a reduced motion

    const counts = { small: 26, mid: 48, big: 90, jackpot: 190 };
    /* Scale to the actual screen. The same count that fills a phone is a thin
       sprinkle on a 13" iPad in landscape. 900x1200 is the reference size the
       numbers above were tuned against. */
    const areaK = Math.sqrt((this.w * this.h) / (900 * 1200));
    let n = Math.round((counts[tier] || 48) * clamp(areaK, 0.7, 1.6));

    // Hard ceiling. Staff demoing repeatedly must not be able to stack these.
    const room = Celebration.MAX - (this.parts.length + this.queue.length);
    n = Math.min(n, Math.max(0, room));
    if (!n) return;

    const ox = origin?.x ?? this.w / 2;
    const oy = origin?.y ?? this.h * 0.42;

    /* Cream is nearly the colour of the veil behind the card, so an even split
       across four inks throws away a quarter of the confetti. Weighted toward
       the two that actually read. */
    const inks = ['#AC1E55', '#AC1E55', '#D18B8D', '#D18B8D', '#F3DBEA', '#F6F1EA'];
    const jack = tier === 'jackpot';

    for (let i = 0; i < n; i++) {
      const a  = (-Math.PI / 2) + (Math.random() - 0.5) * (jack ? 2.6 : 1.9);
      const sp = rand(jack ? 7 : 5, jack ? 19 : 13);
      const w  = rand(7, 15);

      this.parts.push({
        x: ox + rand(-40, 40),
        y: oy + rand(-20, 20),
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        rot: rand(0, Math.PI * 2),
        /* Radians per SECOND, not per frame. Big pieces tumble slower — a
           uniform spin rate across every size is a dead giveaway. */
        vr: rand(-13, 13) * (11 / w),
        w,
        h: rand(9, 19),
        /* Small light pieces are held up by the air; heavy ones punch through
           it. One shared drag constant makes every piece the same weight. */
        drag: 1.9 - (w - 7) / 8 * 0.85,
        col: inks[Math.floor(Math.random() * inks.length)],
        life: 0,
        max: rand(2.4, 4.6),
        flut: rand(0.6, 2.4),
        phase: rand(0, 6.28),
        round: Math.random() < 0.45,
        // Roughly a third of the burst passes in front of the prize card.
        front: !!this.fc && Math.random() < 0.34,
        // Staggered so the burst has a leading edge instead of popping whole.
        wait: Math.random() * (jack ? 0.22 : 0.14)
      });
    }

    if (!this.running) {
      this.running = true;
      this._last = performance.now();
      this._rafId = requestAnimationFrame(this._raf);
    }
  }

  clear() {
    this.parts.length = 0;
    this.queue.length = 0;
    if (this._rafId !== null) { cancelAnimationFrame(this._rafId); this._rafId = null; }
    this.running = false;
    this.ctx.clearRect(0, 0, this.w, this.h);
    if (this.fctx) this.fctx.clearRect(0, 0, this.w, this.h);
  }

  _raf(now) {
    const dt = Math.min((now - this._last) / 1000, 0.05);
    this._last = now;

    const back = this.ctx, front = this.fctx;
    back.clearRect(0, 0, this.w, this.h);
    if (front) front.clearRect(0, 0, this.w, this.h);

    const G = 22;   // gravity, deliberately gentle — petals, not gravel

    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];

      // Still queued: hasn't left the machine yet.
      if (p.wait > 0) { p.wait -= dt; continue; }

      p.life += dt;
      if (p.life > p.max || p.y > this.h + 60 ||
          p.x < -120 || p.x > this.w + 120) { this.parts.splice(i, 1); continue; }

      p.vy += G * dt;
      /* Exponential drag integrated over the elapsed time. `v *= k` once per
         frame is a different curve at every refresh rate; this one isn't. */
      const k = Math.exp(-p.drag * dt);
      p.vx *= k; p.vy *= k;

      // Flutter: sideways drift like something light falling through air.
      p.x += (p.vx + Math.sin(p.life * p.flut + p.phase) * 1.4) * dt * 60;
      p.y += p.vy * dt * 60;
      p.rot += p.vr * dt;

      const fade = p.life > p.max - 0.9
        ? Math.max(0, (p.max - p.life) / 0.9) : 1;

      /* Foreshortening as it tumbles. Signed, NOT absolute: letting it pass
         through zero means the piece turns edge-on and shows its back, which
         is the whole reason a real piece of paper reads as an object. The old
         `abs()*0.75 + 0.25` floored it at a quarter height and put a hard cusp
         at the minimum — it squashed and snapped back, and never turned over. */
      const turn = Math.cos(p.life * 3.1 + p.phase);
      const sy = turn;
      // Edge-on pieces catch less light, so they darken slightly.
      const shade = 0.55 + 0.45 * Math.abs(turn);

      const ctx = (p.front && front) ? front : back;
      ctx.save();
      ctx.globalAlpha = fade * shade;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.scale(1, sy);
      ctx.fillStyle = p.col;
      if (p.round) {
        ctx.beginPath();
        ctx.ellipse(0, 0, p.w / 2, p.h / 2, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.roundRect(-p.w / 2, -p.h / 2, p.w, p.h, 3);
        ctx.fill();
      }
      ctx.restore();
    }

    if (this.parts.length) {
      this._rafId = requestAnimationFrame(this._raf);
    } else {
      this.running = false;
      this._rafId = null;
      back.clearRect(0, 0, this.w, this.h);
      if (front) front.clearRect(0, 0, this.w, this.h);
    }
  }
}

/* Backstop against repeated staff demo pulls stacking bursts forever. */
Celebration.MAX = 460;

/* Fallback for Safari versions without roundRect. */
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    this.beginPath();
    this.moveTo(x + r, y);
    this.arcTo(x + w, y, x + w, y + h, r);
    this.arcTo(x + w, y + h, x, y + h, r);
    this.arcTo(x, y + h, x, y, r);
    this.arcTo(x, y, x + w, y, r);
    this.closePath();
    return this;
  };
}
