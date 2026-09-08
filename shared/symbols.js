/* ============================================================================
   CINNAMOOD — REEL SYMBOLS
   ----------------------------------------------------------------------------
   Hand-drawn SVG, strictly inside the brand palette. Because the palette has
   no green, brown or yellow, the symbols are told apart by SHAPE rather than
   colour — which is also what makes the reference video read as expensive
   instead of like a casino. Every symbol uses the same four inks:

     --ink   berry   #AC1E55   line work, the "drawn" layer
     --mid   rose    #D18B8D   secondary shapes, shading
     --soft  blush   #F3DBEA   fills
     --pale  cream   #F6F1EA   highlights and negative space

   Each skin re-points those variables at itself, so the same symbol set works
   on cream, on glass and on deep berry without redrawing anything.
   ============================================================================ */

const SYMBOLS = {

  /* Top-down cinnamon roll — the spiral is the brand's whole visual hook */
  classic: `
    <circle cx="50" cy="50" r="38" fill="var(--soft)"/>
    <circle cx="50" cy="50" r="38" fill="none" stroke="var(--ink)" stroke-width="3.5"/>
    <path d="M50 15.5
             A34.5 34.5 0 1 1 15.5 50
             A34.5 34.5 0 0 1 50 15.5" fill="none" stroke="none"/>
    <path d="M76 50a26 26 0 1 1-26-26 26 26 0 0 1 26 26"
          fill="none" stroke="var(--mid)" stroke-width="3" opacity=".55"/>
    <path d="M50 22
             c15.5 0 28 12.5 28 28 0 13.5-11 24.5-24.5 24.5
             -11.8 0-21.4-9.6-21.4-21.4 0-10.3 8.4-18.7 18.7-18.7
             9 0 16.3 7.3 16.3 16.3 0 7.9-6.4 14.3-14.3 14.3
             -6.9 0-12.5-5.6-12.5-12.5 0-6 4.9-10.9 10.9-10.9
             5.2 0 9.5 4.3 9.5 9.5 0 4.6-3.7 8.3-8.3 8.3"
          fill="none" stroke="var(--ink)" stroke-width="4"
          stroke-linecap="round"/>
    <circle cx="50" cy="50" r="3.2" fill="var(--ink)"/>`,

  /* Pistachio roll, served on a plate.
     The previous version stood the roll in a fluted paper case, which at reel
     size read unmistakably as a CUPCAKE — wrong product, wrong brand. Sitting
     it on a plate keeps a distinct silhouette (a disc with a wide foot) while
     leaving no doubt that the thing on top is a roll. */
  pistachio: `
    <ellipse cx="50" cy="72" rx="41" ry="10"
             fill="var(--soft)" stroke="var(--ink)" stroke-width="3.4"/>
    <path d="M9 72c0 5.5 18.4 10 41 10s41-4.5 41-10"
          fill="none" stroke="var(--ink)" stroke-width="3.4" stroke-linecap="round"/>
    <ellipse cx="50" cy="65" rx="20" ry="4" fill="var(--ink)" opacity=".16"/>
    <circle cx="50" cy="41" r="23" fill="var(--soft)"
            stroke="var(--ink)" stroke-width="3.4"/>
    <path d="M50 25c8.8 0 16 7.2 16 16 0 7.6-6.2 13.8-13.8 13.8
             -6.6 0-12-5.4-12-12 0-5.8 4.7-10.5 10.5-10.5
             5 0 9 4 9 9 0 4.2-3.4 7.6-7.6 7.6"
          fill="none" stroke="var(--ink)" stroke-width="3.4" stroke-linecap="round"/>
    <g fill="var(--ink)">
      <ellipse cx="37" cy="29" rx="3.8" ry="2.5" transform="rotate(-26 37 29)"/>
      <ellipse cx="63" cy="31" rx="3.8" ry="2.5" transform="rotate(28 63 31)"/>
      <ellipse cx="50" cy="22" rx="3.4" ry="2.3"/>
      <ellipse cx="68" cy="48" rx="3.4" ry="2.3" transform="rotate(-16 68 48)"/>
      <ellipse cx="31" cy="47" rx="3.4" ry="2.3" transform="rotate(20 31 47)"/>
    </g>`,

  /* Cinnamon sticks — the only X in the set, and about as on-brand as a shape
     can get for this business. Replaces a rounded rectangle of dots that read
     as a domino rather than a biscuit. */
  sticks: `
    <g transform="rotate(-28 50 50)">
      <rect x="9" y="41" width="82" height="17" rx="8.5"
            fill="var(--soft)" stroke="var(--ink)" stroke-width="3.4"/>
      <g stroke="var(--ink)" stroke-width="2.2" opacity=".45" stroke-linecap="round">
        <path d="M26 43v13M42 43v13M58 43v13M74 43v13"/>
      </g>
    </g>
    <g transform="rotate(32 50 50)">
      <rect x="13" y="42" width="74" height="16" rx="8"
            fill="var(--soft)" stroke="var(--ink)" stroke-width="3.4"/>
      <g stroke="var(--ink)" stroke-width="2.2" opacity=".45" stroke-linecap="round">
        <path d="M30 44v12M46 44v12M62 44v12"/>
      </g>
      <path d="M20 50a5 5 0 0 1 5-5" fill="none" stroke="var(--ink)"
            stroke-width="2.6" stroke-linecap="round" opacity=".7"/>
    </g>`,

  /* Chocolate — a drip. Nothing else in the set is a teardrop. */
  chocolate: `
    <path d="M50 11c1.5 2.4 26 31.4 26 47.5A26 26 0 0 1 24 58.5C24 42.4 48.5 13.4 50 11Z"
          fill="var(--soft)" stroke="var(--ink)" stroke-width="3.5"
          stroke-linejoin="round"/>
    <circle cx="50" cy="58" r="12.5" fill="none"
            stroke="var(--ink)" stroke-width="2.6" opacity=".4"/>
    <path d="M38 62a12 12 0 0 0 7 10"
          fill="none" stroke="var(--pale)" stroke-width="4.2"
          stroke-linecap="round" opacity=".95"/>
    <circle cx="50" cy="88" r="4" fill="var(--ink)" opacity=".55"/>`,

  /* Iced latte — tall glass, ice, straw */
  latte: `
    <path d="M32 22h36l-4 56a8 8 0 0 1-8 7.2H44A8 8 0 0 1 36 78z"
          fill="var(--soft)" stroke="var(--ink)" stroke-width="3.5"
          stroke-linejoin="round"/>
    <path d="M34.4 44h31.2l-2.6 34a8 8 0 0 1-8 7.2H45A8 8 0 0 1 37 78z"
          fill="var(--mid)" opacity=".45"/>
    <path d="M58 20l9-11" stroke="var(--ink)" stroke-width="5"
          stroke-linecap="round" fill="none"/>
    <g fill="none" stroke="var(--ink)" stroke-width="2.6" stroke-linejoin="round">
      <rect x="39" y="30" width="12" height="12" rx="2.6" transform="rotate(-16 45 36)"/>
      <rect x="53" y="34" width="11" height="11" rx="2.4" transform="rotate(22 58.5 39.5)"/>
      <rect x="43" y="49" width="11" height="11" rx="2.4" transform="rotate(9 48.5 54.5)"/>
    </g>
    <path d="M30 22h40" stroke="var(--ink)" stroke-width="4"
          stroke-linecap="round"/>`,

  /* Hot coffee — takeaway cup, lid, sleeve, steam */
  coffee: `
    <path d="M35 32h30l-3.4 48a8 8 0 0 1-8 7.4H46.4a8 8 0 0 1-8-7.4z"
          fill="var(--soft)" stroke="var(--ink)" stroke-width="3.5"
          stroke-linejoin="round"/>
    <rect x="30" y="22" width="40" height="11" rx="4"
          fill="var(--ink)"/>
    <rect x="36.5" y="50" width="27" height="17" rx="2.6"
          fill="var(--mid)" stroke="var(--ink)" stroke-width="3"/>
    <g stroke="var(--ink)" stroke-width="3.4" stroke-linecap="round" fill="none" opacity=".75">
      <path d="M43 15c-3-3.5 0-6.5-3-10"/>
      <path d="M57 15c-3-3.5 0-6.5-3-10"/>
    </g>`,

  /* Discount tag */
  tag: `
    <path d="M52 16H80a6 6 0 0 1 6 6v28a8 8 0 0 1-2.35 5.66L52.5 87A7 7 0 0 1 42.6 87
             L15 59.4a7 7 0 0 1 0-9.9l31.34-31.15A8 8 0 0 1 52 16Z"
          fill="var(--soft)" stroke="var(--ink)" stroke-width="3.5"
          stroke-linejoin="round"/>
    <circle cx="70" cy="32" r="7.5" fill="var(--pale)"
            stroke="var(--ink)" stroke-width="3.5"/>
    <g stroke="var(--ink)" stroke-width="4" stroke-linecap="round">
      <path d="M39 64 61 42"/>
    </g>
    <circle cx="40" cy="43" r="6.5" fill="none" stroke="var(--ink)" stroke-width="3.6"/>
    <circle cx="60" cy="63" r="6.5" fill="none" stroke="var(--ink)" stroke-width="3.6"/>`,

  /* Bakery box — the jackpot */
  box: `
    <path d="M16 40h68v40a6 6 0 0 1-6 6H22a6 6 0 0 1-6-6z"
          fill="var(--soft)" stroke="var(--ink)" stroke-width="3.5"
          stroke-linejoin="round"/>
    <rect x="11" y="26" width="78" height="16" rx="4"
          fill="var(--pale)" stroke="var(--ink)" stroke-width="3.5"/>
    <rect x="42" y="26" width="16" height="60" fill="var(--mid)"/>
    <rect x="42" y="26" width="16" height="60" fill="none"
          stroke="var(--ink)" stroke-width="3.2"/>
    <path d="M50 26c-6-4-16-10-16-16 0-4.4 3.6-7 7.4-7 4.4 0 8.6 4.6 8.6 10
             0-5.4 4.2-10 8.6-10 3.8 0 7.4 2.6 7.4 7 0 6-10 12-16 16Z"
          fill="var(--ink)"/>`,

  /* Brand heart */
  heart: `
    <path d="M50 84C28 68 14 56 14 41.5 14 29.5 23.2 21 34.2 21c7 0 12.8 3.6 15.8 9
             3-5.4 8.8-9 15.8-9C76.8 21 86 29.5 86 41.5 86 56 72 68 50 84Z"
          fill="var(--soft)" stroke="var(--ink)" stroke-width="4"
          stroke-linejoin="round"/>
    <path d="M32 38c-2.5 2-4 5-4 8.5" stroke="var(--pale)" stroke-width="4"
          stroke-linecap="round" fill="none" opacity=".9"/>`
};

/* ----------------------------------------------------------------------------
   A NOTE ON WHY THESE LOOK THE WAY THEY DO
   ----------------------------------------------------------------------------
   The first version of this set drew every roll variant as a top-down circle
   with a different topping. It was prettier in isolation and useless on a reel:
   six near-identical discs meant you couldn't tell a win from a loss at a
   glance, which is the one thing a slot machine has to do.

   So the set is now built on nine distinct SILHOUETTES — disc, fluted cup,
   rectangle, teardrop, tall glass, tapered cup, tag, box, heart — and you can
   read a match from across the room without focusing on any of the detail.
   If you swap in real products later, keep that rule: the outline has to carry
   the symbol, because the interior never gets a chance.
   ---------------------------------------------------------------------------- */

/* Wraps a symbol's paths in a sized <svg>. Cached because the reels ask for
   the same handful of symbols hundreds of times while spinning. */
const _symCache = {};
function symbolSVG(id) {
  if (_symCache[id]) return _symCache[id];
  const body = SYMBOLS[id] || SYMBOLS.heart;
  const svg = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"
                    aria-hidden="true" focusable="false">${body}</svg>`;
  _symCache[id] = svg;
  return svg;
}

/* Same symbol with the CSS custom properties resolved to literal colours.
   Needed when the SVG is rasterised into a <canvas> for a WebGL texture: an
   image loaded from a data URI has no document to inherit variables from, so
   every var() would silently fall back to black. */
function symbolSVGFlat(id, c) {
  const body = (SYMBOLS[id] || SYMBOLS.heart)
    .replace(/var\(--ink\)/g,  c.ink)
    .replace(/var\(--mid\)/g,  c.mid)
    .replace(/var\(--soft\)/g, c.soft)
    .replace(/var\(--pale\)/g, c.pale);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">${body}</svg>`;
}
