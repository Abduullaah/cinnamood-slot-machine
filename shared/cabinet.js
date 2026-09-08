/* ============================================================================
   CINNAMOOD — CABINET
   ----------------------------------------------------------------------------
   The physical anatomy of the machine, built once and skinned three ways.

   A rounded box with a window in it reads as a web page pretending to be a slot
   machine. Real cabinets are a stack of distinct, separately-lit modules, and
   it's that stack — not the styling — that makes them read as an object:

     TOP BOX     backlit marquee naming the jackpot, bulbs around the frame
     REEL DECK   a deep recess behind a heavy bezel, physical dividers between
                 the drums, glass in front of everything
     METERS      lit displays — wins today, last win
     SHELF       a control shelf that overhangs, casting onto the belly
     BELLY       the paytable, printed on backlit glass
     TRAY        a deep payout mouth that lights when you win
     LEVER       pivoting at shelf height, ball up at rest

   Every one of those sits on its own plane with its own shadow — that's where
   the depth comes from. Skins repaint them; none may be removed, because the
   engine and the choreography address them by name.
   ============================================================================ */

function buildCabinet(cfg, opts = {}) {
  const logo = opts.logo || '../shared/img/logo-berry.png';

  /* The paytable is generated from the prize table, so it can never drift out
     of sync with the real odds — change the prizes and the machine's printed
     glass changes with them. */
  const wins = cfg.prizes.filter(p => p.tier !== 'none' && p.weight > 0);
  const jackpot = wins.find(p => p.tier === 'jackpot') || wins[0];

  const payRows = wins.map(p => `
    <div class="pay-row" data-tier="${p.tier}" data-prize="${p.id}">
      <div class="pay-syms">
        ${[0, 1, 2].map(() => `<span class="pay-sym">${symbolSVG(p.symbol)}</span>`).join('')}
      </div>
      <div class="pay-name">${p.label}</div>
    </div>`).join('');

  return `
  <div class="cab-glow"></div>

  <div class="cabinet">

    <!-- ============ TOP BOX ============ -->
    <div class="topbox">
      <div class="topbox-face">
        <div class="topbox-light"></div>
        <img class="brandmark" src="${logo}" alt="Cinnamood">
        <div class="topbox-rule"></div>
        <div class="jackpot">
          <span class="jp-label">Jackpot</span>
          <span class="jp-prize" id="jackpotPrize">${jackpot ? jackpot.label : ''}</span>
        </div>
      </div>
      <div class="bulbs" id="bulbs"></div>
    </div>

    <!-- ============ REEL DECK ============ -->
    <div class="reeldeck">
      <div class="bezel">
        <div class="bezel-inner">
          <div class="reels">
            <div class="reel" data-reel="0" id="r0"></div>
            <div class="reel" data-reel="1" id="r1"></div>
            <div class="reel" data-reel="2" id="r2"></div>
            <div class="dividers"><i></i><i></i></div>
            <div class="drum-shade"></div>
          </div>
          <div class="glass"></div>
        </div>
        <div class="payline">
          <i class="pl-arrow"></i><span class="pl-line"></span><i class="pl-arrow"></i>
        </div>
      </div>
    </div>

    <!-- ============ METERS ============ -->
    <div class="meters">
      <div class="meter">
        <span class="m-label">Wins today</span>
        <span class="m-value" id="meterWins">0</span>
      </div>
      <div class="meter wide">
        <span class="m-label">Last win</span>
        <span class="m-value" id="meterLast">—</span>
      </div>
    </div>

    <!-- ============ CONTROL SHELF ============ -->
    <div class="shelf">
      <div class="shelf-top"><div class="btns"><i></i><i></i><i></i></div></div>
      <div class="shelf-face"><span class="plate">One pull per guest</span></div>
    </div>

    <!-- ============ BELLY / PAYTABLE ============ -->
    <div class="belly">
      <div class="belly-glass">
        <div class="pay-head">What you can win</div>
        <div class="paytable">${payRows}</div>
      </div>
    </div>

    <!-- ============ PAYOUT TRAY ============ -->
    <div class="tray"><div class="tray-mouth"></div></div>

  </div>

  <div class="plinth"></div>

  <!-- ============ LEVER ============
       Ball up at rest, pulled down through an arc that swings toward the
       viewer. See the note in engine.js on why it rotates about X. -->
  <div class="lever" id="lever">
    <div class="lever-mount"><i></i></div>
    <div class="lever-arm"><div class="knob"><i></i></div></div>
  </div>

  <div class="pull-hint" id="pullHint">PULL<span>↓</span></div>`;
}

/* Marquee bulbs.
   ----------------------------------------------------------------------------
   Laid out SIDE BY SIDE rather than by walking the perimeter at even arc
   length. Arc-length spacing sounds right and isn't: it starts wherever the
   path starts and never lands symmetrically on a shape with corners, so the
   gaps came out between 48 and 65 and the two ends of each row sat at different
   distances from their corners.

   Instead: one bulb at each corner, then each edge filled with a whole number
   of bulbs spaced evenly across it. Every row is symmetric about the centre by
   construction, and because the counts are derived from a target gap, the
   spacing stays near-uniform whatever size or radii a skin uses. */
function buildBulbs(host, opts = {}) {
  if (!host) return;
  const w = host.offsetWidth, h = host.offsetHeight;
  if (!w || !h) return;

  const rt = Math.max(0, Math.min(opts.rt ?? 0, w / 2, h / 2));
  const rb = Math.max(0, Math.min(opts.rb ?? 0, w / 2, h / 2));
  const gap = opts.gap ?? 62;
  const D = Math.PI / 180;

  /* Corner bulbs first, then each edge filled with a whole number of bulbs
     spaced evenly BETWEEN its two corners. Spacing the edges independently and
     then adding corners on top is what produced the uneven ring: a corner bulb
     ended up almost touching the first bulb of the next row wherever the radius
     was small. Deriving the interior count from the corner-to-corner span makes
     corner-to-bulb and bulb-to-bulb the same distance. */
  const D2 = Math.PI / 180;
  const corner = (cx, cy, r, deg) => [cx + r * Math.cos(deg * D2), cy + r * Math.sin(deg * D2)];
  const cTL = corner(rt, rt, rt, 225), cTR = corner(w - rt, rt, rt, -45);
  const cBR = corner(w - rb, h - rb, rb, 45), cBL = corner(rb, h - rb, rb, 135);

  const between = (span) => Math.max(1, Math.round(span / gap) - 1);
  const pts = [];

  pts.push(cTL);
  const kT = between(cTR[0] - cTL[0]);
  for (let i = 1; i <= kT; i++) pts.push([cTL[0] + (cTR[0] - cTL[0]) * i / (kT + 1), 0]);

  pts.push(cTR);
  const kV = between(cBR[1] - cTR[1]);
  for (let i = 1; i <= kV; i++) pts.push([w, cTR[1] + (cBR[1] - cTR[1]) * i / (kV + 1)]);

  pts.push(cBR);
  const kB = between(cBR[0] - cBL[0]);
  for (let i = 1; i <= kB; i++) pts.push([cBR[0] - (cBR[0] - cBL[0]) * i / (kB + 1), h]);

  pts.push(cBL);
  for (let i = 1; i <= kV; i++) pts.push([0, cBL[1] - (cBL[1] - cTL[1]) * i / (kV + 1)]);

  host.innerHTML = pts.map(([x, y], i) =>
    `<i style="left:${x.toFixed(2)}px;top:${y.toFixed(2)}px;` +
    `animation-delay:${(-(i / pts.length) * 0.7).toFixed(3)}s"></i>`
  ).join('');
}
