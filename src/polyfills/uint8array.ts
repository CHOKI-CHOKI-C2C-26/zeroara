/* Main-thread twin of public/pdf.polyfills.mjs: ES2025 Uint8Array hex/base64
   helpers for browsers that predate them. */
type U8Ctor = typeof Uint8Array & {
  fromHex?: (hex: string) => Uint8Array;
  fromBase64?: (s: string, opts?: { alphabet?: string }) => Uint8Array;
};
type U8Proto = Uint8Array & { toHex?: () => string; toBase64?: (opts?: { alphabet?: string; omitPadding?: boolean }) => string };

const U8 = Uint8Array as U8Ctor;
const proto = Uint8Array.prototype as U8Proto;

if (!proto.toHex) {
  Object.defineProperty(Uint8Array.prototype, 'toHex', {
    value: function (this: Uint8Array) {
      let s = '';
      for (let i = 0; i < this.length; i++) s += (this[i] < 16 ? '0' : '') + this[i].toString(16);
      return s;
    },
    writable: true,
    configurable: true,
  });
}
if (!U8.fromHex) {
  U8.fromHex = (hex: string) => {
    if (typeof hex !== 'string' || hex.length % 2) throw new SyntaxError('Uint8Array.fromHex: invalid hex string');
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) {
      const b = parseInt(hex.substr(i * 2, 2), 16);
      if (Number.isNaN(b)) throw new SyntaxError('Uint8Array.fromHex: invalid hex string');
      out[i] = b;
    }
    return out;
  };
}
if (!proto.toBase64) {
  Object.defineProperty(Uint8Array.prototype, 'toBase64', {
    value: function (this: Uint8Array, opts?: { alphabet?: string; omitPadding?: boolean }) {
      let bin = '';
      for (let i = 0; i < this.length; i++) bin += String.fromCharCode(this[i]);
      let s = btoa(bin);
      if (opts?.alphabet === 'base64url') s = s.replace(/\+/g, '-').replace(/\//g, '_');
      if (opts?.omitPadding) s = s.replace(/=+$/, '');
      return s;
    },
    writable: true,
    configurable: true,
  });
}
if (!U8.fromBase64) {
  U8.fromBase64 = (str: string, opts?: { alphabet?: string }) => {
    let s = String(str);
    if (opts?.alphabet === 'base64url') s = s.replace(/-/g, '+').replace(/_/g, '/');
    s += '='.repeat((4 - (s.length % 4)) % 4);
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };
}

/* Map / WeakMap upsert (ES2026 "getOrInsert") and Math.sumPrecise, as in the worker. */
type Upsert<K, V> = { getOrInsert?: (key: K, value: V) => V; getOrInsertComputed?: (key: K, cb: (key: K) => V) => V };
for (const C of [Map, WeakMap] as const) {
  const proto = C.prototype as unknown as Upsert<object, unknown>;
  if (!proto.getOrInsert) {
    Object.defineProperty(C.prototype, 'getOrInsert', {
      value: function (this: Map<unknown, unknown>, key: unknown, value: unknown) {
        if (this.has(key)) return this.get(key);
        this.set(key, value);
        return value;
      },
      writable: true,
      configurable: true,
    });
  }
  if (!proto.getOrInsertComputed) {
    Object.defineProperty(C.prototype, 'getOrInsertComputed', {
      value: function (this: Map<unknown, unknown>, key: unknown, callback: (key: unknown) => unknown) {
        if (this.has(key)) return this.get(key);
        const value = callback(key);
        this.set(key, value);
        return value;
      },
      writable: true,
      configurable: true,
    });
  }
}
const M = Math as Math & { sumPrecise?: (values: Iterable<number>) => number };
if (!M.sumPrecise) {
  M.sumPrecise = (values) => {
    let sum = 0;
    let c = 0;
    for (const v of values) {
      const x = Number(v);
      const t = sum + x;
      if (Math.abs(sum) >= Math.abs(x)) c += sum - t + x;
      else c += x - t + sum;
      sum = t;
    }
    return sum + c;
  };
}
export {};
