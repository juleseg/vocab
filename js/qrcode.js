"use strict";

// === QR CODE (ÉTAPE 39) ===
// Générateur de QR code sans bibliothèque externe : mode octets (UTF-8), correction d'erreur M (~15 %),
// versions 1 à 10 (jusqu'à 213 octets), masque choisi par pénalité. Sert à l'écran À propos (adresse de l'appli).
// QR.matrix(texte) → { size, dark(x, y) } ; QR.svg(texte, px) → élément <svg> (fond blanc, marge de 4 modules).
const QR = (() => {
  // Table par version (index 1 à 10), niveau M : codes de correction par bloc et nombre de blocs.
  const ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
  const NUM_BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
  const FORMAT_M = 0;   // bits du niveau M dans les informations de format

  // --- Reed-Solomon sur GF(256) ---
  function gfMul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; }
    return z & 0xFF;
  }
  function rsDivisor(degree) {
    const r = new Array(degree).fill(0);
    r[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < r.length; j++) { r[j] = gfMul(r[j], root); if (j + 1 < r.length) r[j] ^= r[j + 1]; }
      root = gfMul(root, 0x02);
    }
    return r;
  }
  function rsRemainder(data, div) {
    const r = new Array(div.length).fill(0);
    data.forEach(b => {
      const f = b ^ r.shift();
      r.push(0);
      div.forEach((c, i) => { r[i] ^= gfMul(c, f); });
    });
    return r;
  }

  // --- Tailles ---
  function rawModules(v) {
    let r = (16 * v + 128) * v + 64;
    if (v >= 2) { const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; }
    return r;
  }
  function dataCodewords(v) { return Math.floor(rawModules(v) / 8) - ECC_PER_BLOCK[v] * NUM_BLOCKS[v]; }
  function alignPositions(v) {
    if (v === 1) return [];
    const n = Math.floor(v / 7) + 2, size = v * 4 + 17;
    const step = Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2;
    const r = [6];
    for (let pos = size - 7; r.length < n; pos -= step) r.splice(1, 0, pos);
    return r;
  }

  // --- Données : mode octets, terminaison, remplissage, blocs entrelacés avec leur correction ---
  function utf8(text) {
    try { return Array.from(new TextEncoder().encode(String(text))); }
    catch (e) { return Array.from(unescape(encodeURIComponent(String(text)))).map(c => c.charCodeAt(0)); }
  }
  function codewords(bytes, v) {
    const bits = [];
    const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    put(4, 4);                                   // mode octets
    put(bytes.length, v <= 9 ? 8 : 16);          // nombre d'octets
    bytes.forEach(b => put(b, 8));
    const cap = dataCodewords(v) * 8;
    put(0, Math.min(4, cap - bits.length));      // terminaison
    while (bits.length % 8) bits.push(0);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
    for (let p = 0xEC; data.length < cap / 8; p ^= 0xEC ^ 0x11) data.push(p);
    // Découpage en blocs (blocs courts puis longs), correction de chaque bloc, entrelacement.
    const nb = NUM_BLOCKS[v], ecl = ECC_PER_BLOCK[v], raw = Math.floor(rawModules(v) / 8);
    const nShort = nb - raw % nb, shortLen = Math.floor(raw / nb);
    const div = rsDivisor(ecl), blocks = [];
    for (let i = 0, k = 0; i < nb; i++) {
      const len = shortLen - ecl + (i < nShort ? 0 : 1);
      const dat = data.slice(k, k + len);
      k += len;
      const ecc = rsRemainder(dat, div);
      if (i < nShort) dat.push(0);               // case vide, sautée à l'entrelacement
      blocks.push(dat.concat(ecc));
    }
    const out = [];
    for (let i = 0; i < blocks[0].length; i++) {
      blocks.forEach((b, j) => { if (i !== shortLen - ecl || j >= nShort) out.push(b[i]); });
    }
    return out;
  }

  // --- Matrice ---
  function build(text) {
    const bytes = utf8(text);
    let v = 1;
    while (v <= 10 && dataCodewords(v) * 8 < 4 + (v <= 9 ? 8 : 16) + bytes.length * 8) v++;
    if (v > 10) return null;                     // texte trop long
    const size = v * 4 + 17;
    const mod = [], fn = [];
    for (let y = 0; y < size; y++) { mod.push(new Array(size).fill(false)); fn.push(new Array(size).fill(false)); }
    const setF = (x, y, d) => { mod[y][x] = d; fn[y][x] = true; };
    // Lignes de synchronisation, motifs de position (avec séparateurs), motifs d'alignement.
    for (let i = 0; i < size; i++) { setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }
    [[3, 3], [size - 4, 3], [3, size - 4]].forEach(([cx, cy]) => {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) setF(x, y, d !== 2 && d !== 4);
      }
    });
    const al = alignPositions(v), last = al.length - 1;
    al.forEach((ay, i) => al.forEach((ax, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setF(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }));
    // Informations de format (réservées ici, écrites avec le masque choisi) et de version (7 et plus).
    const drawFormat = mask => {
      const data = (FORMAT_M << 3) | mask;
      let rem = data;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const b = ((data << 10) | rem) ^ 0x5412, bit = i => ((b >>> i) & 1) === 1;
      for (let i = 0; i <= 5; i++) setF(8, i, bit(i));
      setF(8, 7, bit(6)); setF(8, 8, bit(7)); setF(7, 8, bit(8));
      for (let i = 9; i < 15; i++) setF(14 - i, 8, bit(i));
      for (let i = 0; i < 8; i++) setF(size - 1 - i, 8, bit(i));
      for (let i = 8; i < 15; i++) setF(8, size - 15 + i, bit(i));
      setF(8, size - 8, true);
    };
    drawFormat(0);
    if (v >= 7) {
      let rem = v;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      const b = (v << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const d = ((b >>> i) & 1) === 1, a = size - 11 + i % 3, c = Math.floor(i / 3);
        setF(a, c, d); setF(c, a, d);
      }
    }
    // Données en zigzag (colonnes de 2, de droite à gauche).
    const cw = codewords(bytes, v);
    let k = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
        const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
        if (!fn[y][x] && k < cw.length * 8) { mod[y][x] = ((cw[k >>> 3] >>> (7 - (k & 7))) & 1) === 1; k++; }
      }
    }
    // Masque : le plus lisible des 8 (pénalités simplifiées : suites, blocs 2×2, équilibre clair / foncé).
    const MASKS = [
      (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, x => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
      (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => x * y % 2 + x * y % 3 === 0,
      (x, y) => (x * y % 2 + x * y % 3) % 2 === 0, (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0
    ];
    const apply = m => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[m](x, y)) mod[y][x] = !mod[y][x]; };
    const penalty = () => {
      let p = 0, dark = 0;
      for (let a = 0; a < size; a++) {
        let rr = 1, rc = 1;
        for (let b = 1; b < size; b++) {
          if (mod[a][b] === mod[a][b - 1]) { rr++; if (rr === 5) p += 3; else if (rr > 5) p++; } else rr = 1;
          if (mod[b][a] === mod[b - 1][a]) { rc++; if (rc === 5) p += 3; else if (rc > 5) p++; } else rc = 1;
        }
      }
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        if (mod[y][x]) dark++;
        if (x < size - 1 && y < size - 1) { const c = mod[y][x]; if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) p += 3; }
      }
      return p + Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
    };
    let best = 0, bestP = Infinity;
    for (let m = 0; m < 8; m++) {
      apply(m); drawFormat(m);
      const p = penalty();
      if (p < bestP) { bestP = p; best = m; }
      apply(m);                                  // annule (le masque est une inversion)
    }
    apply(best); drawFormat(best);
    return { size, version: v, mask: best, dark: (x, y) => x >= 0 && y >= 0 && x < size && y < size && mod[y][x] };
  }

  // Dessin SVG : un seul chemin, fond blanc et modules noirs (même en thème sombre, pour l'appareil photo).
  function svg(text, px) {
    const q = build(text);
    if (!q) return null;
    const NS = "http://www.w3.org/2000/svg", n = q.size + 8;
    const s = document.createElementNS(NS, "svg");
    s.setAttribute("viewBox", "0 0 " + n + " " + n);
    s.setAttribute("width", String(px || 220)); s.setAttribute("height", String(px || 220));
    s.setAttribute("shape-rendering", "crispEdges");
    s.setAttribute("role", "img");
    const bg = document.createElementNS(NS, "rect");
    bg.setAttribute("width", String(n)); bg.setAttribute("height", String(n)); bg.setAttribute("fill", "#fff");
    s.appendChild(bg);
    let d = "";
    for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) if (q.dark(x, y)) d += "M" + (x + 4) + " " + (y + 4) + "h1v1h-1z";
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", d); path.setAttribute("fill", "#000");
    s.appendChild(path);
    return s;
  }
  return { matrix: build, svg };
})();
App.QR = QR;
