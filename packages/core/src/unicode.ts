/** Offset helpers: public offsets are Unicode code points (SPEC §7); JS
 * strings are UTF-16, so conversions happen at every string boundary. */

export function cpLength(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

export function cpToUtf16(s: string, cp: number): number {
  if (cp < 0) throw new RangeError(`negative code point offset: ${cp}`);
  let n = 0;
  let i = 0;
  for (const ch of s) {
    if (n === cp) return i;
    i += ch.length;
    n++;
  }
  if (n === cp) return i;
  throw new RangeError(`code point offset ${cp} out of range (length ${n})`);
}

export function utf16ToCp(s: string, idx: number): number {
  let n = 0;
  let i = 0;
  for (const ch of s) {
    if (i >= idx) return n;
    i += ch.length;
    n++;
  }
  return n;
}

export function cpSlice(s: string, start: number, end?: number): string {
  const a = cpToUtf16(s, start);
  const b = end === undefined ? s.length : cpToUtf16(s, end);
  return s.slice(a, b);
}

/** Precomputed UTF-16 → code point index map for one string. */
export function buildCpIndex(s: string): (utf16: number) => number {
  const map = new Uint32Array(s.length + 1);
  let cp = 0;
  let i = 0;
  for (const ch of s) {
    for (let k = 0; k < ch.length; k++) map[i + k] = cp;
    i += ch.length;
    cp++;
  }
  map[s.length] = cp;
  return (idx: number) => {
    if (idx < 0 || idx > s.length) {
      throw new RangeError(`utf16 index ${idx} out of range`);
    }
    return map[idx] as number;
  };
}
