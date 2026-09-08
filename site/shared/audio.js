/* ============================================================================
   CINNAMOOD — SOUND
   ----------------------------------------------------------------------------
   Every sound here is generated live by the browser. There are no .mp3 files,
   nothing to download, and nothing to break on a slow café wifi.

   The palette is deliberately warm and wooden rather than metallic-casino:
   soft mallet tones, a filtered airy whirr, and a felt-covered thunk when each
   reel lands. Wins resolve on a pentatonic scale, so nothing can ever sound
   sour no matter which notes fire together.

   iPad note: Safari refuses to make sound until the user has touched the page
   once. `unlock()` is wired to the first touch anywhere.
   ============================================================================ */

class CinnaAudio {
  constructor(opts = {}) {
    this.ctx = null;
    this.muted = !!opts.startMuted;
    this.masterVol = opts.volume ?? 0.7;
    this.ready = false;
    this._whirr = null;
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();

    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.masterVol;

    // A touch of room so it doesn't sound like it's happening inside a phone.
    this.verbSend = this.ctx.createGain();
    this.verbSend.gain.value = 0.22;
    this.verb = this.ctx.createConvolver();
    this.verb.buffer = this._impulse(1.6, 2.4);
    this.verbSend.connect(this.verb);
    this.verb.connect(this.master);

    this.master.connect(this.ctx.destination);
    this.ready = true;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.linearRampToValueAtTime(
        m ? 0 : this.masterVol, this.ctx.currentTime + 0.12
      );
    }
    if (m) this.stopWhirr();
  }

  /* Small synthetic room, built from decaying noise. */
  _impulse(dur, decay) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * dur);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  _now() { return this.ctx.currentTime; }

  /* Core voice: one oscillator, one envelope, optional room. */
  _tone({ freq, type = 'sine', dur = 0.3, gain = 0.3, attack = 0.004,
          decay = null, detune = 0, verb = 0.25, glideTo = null, delay = 0 }) {
    if (!this.ready || this.muted) return;
    const t = this._now() + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.detune.value = detune;
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t + dur);

    const peak = gain;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (decay ?? dur));

    osc.connect(g);
    g.connect(this.master);
    if (verb > 0) {
      const s = this.ctx.createGain();
      s.gain.value = verb;
      g.connect(s); s.connect(this.verbSend);
    }
    osc.start(t);
    osc.stop(t + (decay ?? dur) + 0.05);
  }

  /* Short filtered noise — used for clicks, thunks and air. */
  _noise({ dur = 0.08, gain = 0.3, freq = 900, q = 1.2, type = 'bandpass',
           delay = 0, sweepTo = null, verb = 0.1 }) {
    if (!this.ready || this.muted) return;
    const t = this._now() + delay;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.setValueAtTime(freq, t);
    filt.Q.value = q;
    if (sweepTo) filt.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    src.connect(filt); filt.connect(g); g.connect(this.master);
    if (verb > 0) {
      const s = this.ctx.createGain();
      s.gain.value = verb;
      g.connect(s); s.connect(this.verbSend);
    }
    src.start(t);
  }

  /* ---- The actual cues ------------------------------------------------- */

  /* Ratchet tooth as the lever is pulled. Pitch rises with travel so the
     hand feels the mechanism tightening. */
  leverTick(progress) {
    this._noise({ dur: 0.035, gain: 0.16, freq: 1500 + progress * 1700, q: 5, verb: 0.05 });
    this._tone({ freq: 190 + progress * 120, type: 'square', dur: 0.03,
                 gain: 0.045, verb: 0 });
  }

  /* The release — spring lets go, machine takes over. */
  leverRelease() {
    this._noise({ dur: 0.3, gain: 0.3, freq: 2600, sweepTo: 320, q: 0.9, verb: 0.3 });
    this._tone({ freq: 320, type: 'triangle', dur: 0.32, gain: 0.22, glideTo: 90, verb: 0.3 });
    this._tone({ freq: 82, type: 'sine', dur: 0.4, gain: 0.34, verb: 0.15 });
  }

  /* Continuous reel whirr. Pitch and brightness follow actual reel speed,
     which is what sells the illusion that the reels are physical. */
  startWhirr() {
    if (!this.ready || this.muted || this._whirr) return;
    const t = this._now();
    const len = Math.floor(this.ctx.sampleRate * 2);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.loop = true;

    const filt = this.ctx.createBiquadFilter();
    filt.type = 'bandpass'; filt.frequency.value = 800; filt.Q.value = 1.1;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.075, t + 0.14);

    // A low rotor tone under the noise gives it mass.
    const rotor = this.ctx.createOscillator();
    rotor.type = 'sawtooth'; rotor.frequency.value = 58;
    const rg = this.ctx.createGain(); rg.gain.value = 0.028;
    const rlp = this.ctx.createBiquadFilter();
    rlp.type = 'lowpass'; rlp.frequency.value = 260;

    src.connect(filt); filt.connect(g); g.connect(this.master);
    rotor.connect(rlp); rlp.connect(rg); rg.connect(this.master);
    src.start(t); rotor.start(t);

    this._whirr = { src, filt, g, rotor, rg };
  }

  updateWhirr(speed01) {
    if (!this._whirr) return;
    const w = this._whirr;
    const t = this._now();
    const s = Math.max(0, Math.min(1, speed01));
    w.filt.frequency.setTargetAtTime(340 + s * 1500, t, 0.05);
    w.g.gain.setTargetAtTime(0.012 + s * 0.075, t, 0.05);
    w.rotor.frequency.setTargetAtTime(34 + s * 54, t, 0.05);
    w.rg.gain.setTargetAtTime(s * 0.03, t, 0.05);
  }

  stopWhirr() {
    if (!this._whirr) return;
    const w = this._whirr;
    const t = this._now();
    try {
      w.g.gain.cancelScheduledValues(t);
      w.g.gain.setTargetAtTime(0.0001, t, 0.05);
      w.rg.gain.setTargetAtTime(0.0001, t, 0.05);
      w.src.stop(t + 0.4); w.rotor.stop(t + 0.4);
    } catch (e) { /* already stopped */ }
    this._whirr = null;
  }

  /* Each reel landing. Index deepens the pitch so the three stops read as a
     descending phrase rather than three identical noises. */
  reelStop(index = 0) {
    const base = 132 - index * 16;
    this._tone({ freq: base, type: 'sine', dur: 0.26, gain: 0.42, verb: 0.2 });
    this._tone({ freq: base * 2.02, type: 'sine', dur: 0.12, gain: 0.13, verb: 0.15 });
    this._noise({ dur: 0.07, gain: 0.3, freq: 2100, sweepTo: 500, q: 1.4, verb: 0.12 });
  }

  /* Played when the first two reels match and the third is still turning.
     A slow rising drone — the sound of the room leaning in. */
  tension(durSec = 1.6) {
    if (!this.ready || this.muted) return;
    const t = this._now();
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const lp = this.ctx.createBiquadFilter();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(110, t);
    osc.frequency.exponentialRampToValueAtTime(233, t + durSec);
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(420, t);
    lp.frequency.exponentialRampToValueAtTime(2600, t + durSec);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + durSec * 0.75);
    g.gain.exponentialRampToValueAtTime(0.0001, t + durSec + 0.25);
    osc.connect(lp); lp.connect(g); g.connect(this.master);
    const s = this.ctx.createGain(); s.gain.value = 0.4;
    g.connect(s); s.connect(this.verbSend);
    osc.start(t); osc.stop(t + durSec + 0.3);

    // Heartbeat under it.
    for (let i = 0; i < Math.floor(durSec / 0.42); i++) {
      this._tone({ freq: 62, type: 'sine', dur: 0.16, gain: 0.3,
                   delay: i * 0.42, verb: 0.1 });
    }
  }

  /* Pentatonic so wins can never land on a sour interval. */
  win(tier = 'mid') {
    const P = [523.25, 587.33, 698.46, 783.99, 1046.50, 1174.66, 1396.91, 1567.98];
    const shapes = {
      small:   { notes: [0, 2, 4],             step: 0.085, gain: 0.20, type: 'triangle' },
      mid:     { notes: [0, 2, 4, 5],          step: 0.082, gain: 0.24, type: 'triangle' },
      big:     { notes: [0, 2, 4, 5, 7],       step: 0.078, gain: 0.28, type: 'triangle' },
      jackpot: { notes: [0, 2, 4, 5, 7, 4, 5, 7], step: 0.072, gain: 0.32, type: 'triangle' }
    };
    const s = shapes[tier] || shapes.mid;

    s.notes.forEach((n, i) => {
      this._tone({ freq: P[n], type: s.type, dur: 0.75, gain: s.gain,
                   delay: i * s.step, verb: 0.5 });
      this._tone({ freq: P[n] * 2, type: 'sine', dur: 0.42,
                   gain: s.gain * 0.3, delay: i * s.step, verb: 0.5 });
    });

    // Warm pad underneath so the arpeggio has a floor to sit on.
    const padDelay = s.notes.length * s.step * 0.35;
    [130.81, 196.00, 261.63].forEach((f, i) => {
      this._tone({ freq: f, type: 'sine', dur: 1.9, gain: 0.12,
                   attack: 0.14, delay: padDelay + i * 0.02, verb: 0.6 });
    });

    if (tier === 'jackpot') {
      this._noise({ dur: 1.1, gain: 0.16, freq: 400, sweepTo: 7000,
                    q: 0.6, type: 'highpass', verb: 0.55 });
      [0, 0.09, 0.18].forEach(d =>
        this._tone({ freq: 1567.98, type: 'sine', dur: 1.2, gain: 0.16,
                     delay: 0.55 + d, verb: 0.7 })
      );
    }
  }

  /* The miss. Deliberately soft and warm — a shrug, not a buzzer. */
  lose() {
    this._tone({ freq: 329.63, type: 'sine', dur: 0.5, gain: 0.16, verb: 0.4 });
    this._tone({ freq: 261.63, type: 'sine', dur: 0.7, gain: 0.17,
                 delay: 0.11, verb: 0.45 });
    this._tone({ freq: 130.81, type: 'sine', dur: 0.9, gain: 0.1,
                 delay: 0.11, attack: 0.08, verb: 0.4 });
  }

  /* Quiet interface tick for admin controls and idle nudges. */
  tick(soft = false) {
    this._noise({ dur: 0.03, gain: soft ? 0.07 : 0.14,
                  freq: soft ? 1800 : 2600, q: 4, verb: 0.05 });
  }

  /* Machine returning to rest. */
  reset() {
    this._tone({ freq: 392, type: 'sine', dur: 0.3, gain: 0.12, verb: 0.35 });
    this._tone({ freq: 523.25, type: 'sine', dur: 0.4, gain: 0.1,
                 delay: 0.06, verb: 0.35 });
  }
}
