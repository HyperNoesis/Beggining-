/**
 * Tiny QR code encoder, no dependency (own implementation of the ISO 18004 steps).
 * Byte mode only, error correction L or M, versions 1 to 10 (up to 271 bytes at L, 213 at M),
 * enough for a web address, handle or short message. Returns null when the text is too long.
 * Checked in tools/e2e/unit_qr.js by decoding the output with OpenCV's QR detector.
 *   VS.QR.encode('https://example.com', 'M') -> { size, get(x, y) -> true when dark }
 */
(function () {
  // ---- tables (versions 1..10), index 0 = version 1
  const ECC_PER_BLOCK = { L: [7, 10, 15, 20, 26, 18, 20, 24, 30, 18], M: [10, 16, 26, 18, 24, 16, 18, 22, 22, 26] };
  const NUM_BLOCKS = { L: [1, 1, 1, 1, 1, 2, 2, 2, 2, 4], M: [1, 1, 1, 2, 2, 4, 4, 4, 5, 5] };
  const RAW_CODEWORDS = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
  const ALIGN = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
  const ECC_FORMAT_BITS = { L: 1, M: 0 };

  // ---- Reed-Solomon over GF(256), polynomial 0x11D
  const EXP = new Array(512), LOG = new Array(256);
  (function () { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; })();
  const gmul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);
  function rsGenerator(deg) {
    let g = [1];
    for (let i = 0; i < deg; i++) {
      const next = new Array(g.length + 1).fill(0);
      for (let j = 0; j < g.length; j++) { next[j] ^= g[j]; next[j + 1] ^= gmul(g[j], EXP[i]); }
      g = next;
    }
    return g;                                    // highest degree first, g[0] === 1
  }
  function rsRemainder(data, gen) {
    const deg = gen.length - 1, rem = new Array(deg).fill(0);
    for (let i = 0; i < data.length; i++) {
      const f = data[i] ^ rem[0];
      rem.shift(); rem.push(0);
      if (f) for (let j = 0; j < deg; j++) rem[j] ^= gmul(gen[j + 1], f);
    }
    return rem;
  }

  function utf8Bytes(text) {
    const s = unescape(encodeURIComponent(String(text)));
    const out = []; for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
    return out;
  }
  const dataCapacity = (ver, ecc) => RAW_CODEWORDS[ver - 1] - ECC_PER_BLOCK[ecc][ver - 1] * NUM_BLOCKS[ecc][ver - 1];

  function buildCodewords(bytes, ver, ecc) {
    const bits = [];
    const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    put(4, 4); put(bytes.length, ver < 10 ? 8 : 16);
    bytes.forEach((b) => put(b, 8));
    const capBits = dataCapacity(ver, ecc) * 8;
    put(0, Math.min(4, capBits - bits.length));
    while (bits.length % 8) bits.push(0);
    for (let pad = 0xec; bits.length < capBits; pad ^= 0xec ^ 0x11) put(pad, 8);
    const data = []; for (let i = 0; i < bits.length; i += 8) { let v = 0; for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j]; data.push(v); }
    // split into blocks, add error correction, interleave
    const nb = NUM_BLOCKS[ecc][ver - 1], eb = ECC_PER_BLOCK[ecc][ver - 1], raw = RAW_CODEWORDS[ver - 1];
    const shortBlocks = nb - (raw % nb), shortLen = Math.floor(raw / nb);
    const gen = rsGenerator(eb), blocks = []; let k = 0;
    for (let i = 0; i < nb; i++) {
      const len = shortLen - eb + (i < shortBlocks ? 0 : 1);
      const d = data.slice(k, k + len); k += len;
      blocks.push({ d, e: rsRemainder(d, gen) });
    }
    const out = [];
    const maxD = shortLen - eb + 1;
    for (let i = 0; i < maxD; i++) blocks.forEach((b) => { if (i < b.d.length) out.push(b.d[i]); });
    for (let i = 0; i < eb; i++) blocks.forEach((b) => out.push(b.e[i]));
    return out;
  }

  function makeMatrix(size) { const m = []; for (let y = 0; y < size; y++) m.push(new Array(size).fill(false)); return m; }

  function drawFunctionPatterns(ver, mod, fn) {
    const size = mod.length;
    const set = (x, y, dark) => { if (x >= 0 && y >= 0 && x < size && y < size) { mod[y][x] = dark; fn[y][x] = true; } };
    for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }      // timing
    const finder = (cx, cy) => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const d = Math.max(Math.abs(dx), Math.abs(dy)); set(cx + dx, cy + dy, d !== 2 && d !== 4); } };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    const pos = ALIGN[ver - 1], n = pos.length;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
    drawFormat(0, 0, mod, fn, true);                                                          // reserve the format area
    if (ver >= 7) {
      let rem = ver; for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      const bits = (ver << 12) | rem;
      for (let i = 0; i < 18; i++) { const b = ((bits >>> i) & 1) === 1, a = size - 11 + (i % 3), c = Math.floor(i / 3); set(a, c, b); set(c, a, b); }
    }
  }
  function drawFormat(eccBits, mask, mod, fn, reserve) {
    const size = mod.length;
    const data = (eccBits << 3) | mask; let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (i) => ((bits >>> i) & 1) === 1;
    const set = (x, y, d) => { mod[y][x] = reserve ? false : d; fn[y][x] = true; };
    for (let i = 0; i < 6; i++) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    mod[size - 8][8] = true; fn[size - 8][8] = true;                                          // the always-dark module
  }
  function placeData(mod, fn, codewords) {
    const size = mod.length; let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
        const x = right - j, upward = ((right + 1) & 2) === 0, y = upward ? size - 1 - vert : vert;
        if (!fn[y][x] && i < codewords.length * 8) { mod[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1; i++; }
      }
    }
  }
  const MASKS = [
    (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x, y) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];
  function applyMask(mod, fn, m) { for (let y = 0; y < mod.length; y++) for (let x = 0; x < mod.length; x++) if (!fn[y][x] && MASKS[m](x, y)) mod[y][x] = !mod[y][x]; }

  function penalty(mod) {
    const n = mod.length; let p = 0;
    const line = (get) => {
      let run = 1;
      for (let i = 1; i < n; i++) { if (get(i) === get(i - 1)) run++; else { if (run >= 5) p += 3 + run - 5; run = 1; } }
      if (run >= 5) p += 3 + run - 5;
      for (let i = 0; i + 11 <= n; i++) {                                                     // finder-like 1:1:3:1:1 with a light margin
        const w = []; for (let j = 0; j < 11; j++) w.push(get(i + j) ? 1 : 0);
        const s = w.join('');
        if (s === '10111010000' || s === '00001011101') p += 40;
      }
    };
    for (let y = 0; y < n; y++) line((i) => mod[y][i]);
    for (let x = 0; x < n; x++) line((i) => mod[i][x]);
    let dark = 0;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { if (mod[y][x]) dark++; if (x && y && mod[y][x] === mod[y][x - 1] && mod[y][x] === mod[y - 1][x] && mod[y][x] === mod[y - 1][x - 1]) p += 3; }
    p += (Math.ceil(Math.abs(dark * 20 - n * n * 10) / (n * n)) - 1) * 10;
    return p;
  }

  function encode(text, ecc) {
    ecc = ecc === 'L' ? 'L' : 'M';
    const bytes = utf8Bytes(text); if (!bytes.length) return null;
    let ver = 0;
    for (let v = 1; v <= 10; v++) { const need = 4 + (v < 10 ? 8 : 16) + bytes.length * 8; if (need <= dataCapacity(v, ecc) * 8) { ver = v; break; } }
    if (!ver) return null;
    const codewords = buildCodewords(bytes, ver, ecc), size = 17 + ver * 4;
    const base = makeMatrix(size), fn = makeMatrix(size);
    drawFunctionPatterns(ver, base, fn); placeData(base, fn, codewords);
    let best = null, bestP = Infinity;
    for (let m = 0; m < 8; m++) {
      const mod = base.map((r) => r.slice());
      applyMask(mod, fn, m); drawFormat(ECC_FORMAT_BITS[ecc], m, mod, fn, false);
      const p = penalty(mod); if (p < bestP) { bestP = p; best = mod; }
    }
    return { size, version: ver, ecc, get: (x, y) => x >= 0 && y >= 0 && x < size && y < size && best[y][x], rows: best };
  }

  window.VS = window.VS || {};
  window.VS.QR = { encode, maxBytes: (ecc) => dataCapacity(10, ecc === 'L' ? 'L' : 'M') - 3 };
})();
