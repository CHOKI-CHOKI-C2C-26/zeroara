/* Polyfills for the ES2025 Uint8Array hex/base64 helpers that pdf.js 6 calls
   (Uint8Array.prototype.toHex etc.). Browsers released before late 2025 lack
   them, and without this every PDF fails to open with "n.toHex is not a function". */
(function (U8) {
  if (!U8.prototype.toHex) {
    Object.defineProperty(U8.prototype, 'toHex', {
      value: function () { let s = ''; for (let i = 0; i < this.length; i++) s += (this[i] < 16 ? '0' : '') + this[i].toString(16); return s; },
      writable: true, configurable: true,
    });
  }
  if (!U8.fromHex) {
    U8.fromHex = function (hex) {
      if (typeof hex !== 'string' || hex.length % 2) throw new SyntaxError('Uint8Array.fromHex: invalid hex string');
      const out = new U8(hex.length / 2);
      for (let i = 0; i < out.length; i++) { const b = parseInt(hex.substr(i * 2, 2), 16); if (Number.isNaN(b)) throw new SyntaxError('Uint8Array.fromHex: invalid hex string'); out[i] = b; }
      return out;
    };
  }
  if (!U8.prototype.toBase64) {
    Object.defineProperty(U8.prototype, 'toBase64', {
      value: function (opts) { let bin = ''; for (let i = 0; i < this.length; i++) bin += String.fromCharCode(this[i]); let s = btoa(bin); if (opts && opts.alphabet === 'base64url') s = s.replace(/\+/g, '-').replace(/\//g, '_'); if (opts && opts.omitPadding) s = s.replace(/=+$/, ''); return s; },
      writable: true, configurable: true,
    });
  }
  if (!U8.fromBase64) {
    U8.fromBase64 = function (str, opts) {
      let s = String(str);
      if (opts && opts.alphabet === 'base64url') s = s.replace(/-/g, '+').replace(/_/g, '/');
      s += '='.repeat((4 - (s.length % 4)) % 4);
      const bin = atob(s); const out = new U8(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    };
  }
})(Uint8Array);

/* Map / WeakMap upsert (ES2026 "getOrInsert") — pdf.js 6 caches method promises with it. */
(function () {
  for (const C of [Map, WeakMap]) {
    if (!C.prototype.getOrInsert) {
      Object.defineProperty(C.prototype, 'getOrInsert', {
        value: function (key, value) { if (this.has(key)) return this.get(key); this.set(key, value); return value; },
        writable: true, configurable: true,
      });
    }
    if (!C.prototype.getOrInsertComputed) {
      Object.defineProperty(C.prototype, 'getOrInsertComputed', {
        value: function (key, callback) { if (this.has(key)) return this.get(key); const value = callback(key); this.set(key, value); return value; },
        writable: true, configurable: true,
      });
    }
  }
  /* Math.sumPrecise (ES2026): Neumaier summation is accurate enough for pdf.js's uses. */
  if (!Math.sumPrecise) {
    Math.sumPrecise = function (iterable) {
      let sum = 0, c = 0;
      for (const v of iterable) {
        const x = Number(v);
        const t = sum + x;
        if (Math.abs(sum) >= Math.abs(x)) c += sum - t + x; else c += x - t + sum;
        sum = t;
      }
      return sum + c;
    };
  }
})();
