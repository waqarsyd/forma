/**
 * .NET's `decimal`, as far as a report's arithmetic needs it.
 *
 * DevExpress evaluates a report's expressions in .NET, where money is a
 * `decimal`: a 96-bit integer and a scale of 0 to 28. That is not a floating
 * point number, and the difference prints. Measured by printing through
 * DevExpress 20.1 with `RepxProbe render` on 2026-10-30 (row 12 of
 * `docs/proposals/devexpress-parity.md`):
 *
 * - **the scale is kept**: 8 x 0.5 printed `4.0`, and 1 x 12.5 printed `12.5`;
 * - **sums are exact**: six prices summed to `163.323` and averaged to `27.2205`;
 * - **division that does not end runs to 28 decimal places**, or fewer when
 *   the digits would not fit in 96 bits: 12.5 / 3 printed
 *   `4.1666666666666666666666666667`, 100 / 3 printed
 *   `33.333333333333333333333333333` (27 places), 9.99 / 3 printed `3.33`.
 *
 * A JavaScript number would print `4`, `163.32299999999998` and sixteen 6s,
 * so the Preview carries decimals as this: a `bigint` mantissa and a scale.
 * Where precision has to be dropped it rounds half to even, as .NET's decimal
 * arithmetic does.
 */

const MAX_SCALE = 28;
const MAX_MANTISSA = (1n << 96n) - 1n;
const TEN = 10n;
const pow10 = (n: number): bigint => TEN ** BigInt(n);
const abs = (n: bigint) => (n < 0n ? -n : n);

/** Divide, rounding half to even, as .NET does when a decimal loses digits. */
function divRound(numerator: bigint, divisor: bigint): bigint {
  const q = numerator / divisor;
  const r = numerator % divisor;
  if (r === 0n) return q;
  const twice = abs(r) * 2n;
  const d = abs(divisor);
  const away = (numerator < 0n) !== (divisor < 0n) ? -1n : 1n;
  if (twice > d || (twice === d && (q % 2n !== 0n))) return q + away;
  return q;
}

export class NetDecimal {
  constructor(readonly mantissa: bigint, readonly scale: number) {}

  /** `-12.50` keeps its two places, as .NET's parse does. Null for anything else. */
  static parse(text: string): NetDecimal | null {
    const m = /^\s*([+-]?)(\d*)(?:\.(\d*))?\s*$/.exec(text);
    if (!m || (!m[2] && !m[3])) return null;
    const fraction = (m[3] ?? '').slice(0, MAX_SCALE);
    const digits = BigInt((m[2] || '0') + fraction);
    return new NetDecimal(m[1] === '-' ? -digits : digits, fraction.length);
  }

  static fromInt(n: bigint): NetDecimal {
    return new NetDecimal(n, 0);
  }

  /** From a double, through its 15 significant digits, as .NET converts one. */
  static fromNumber(x: number): NetDecimal {
    if (!Number.isFinite(x)) return new NetDecimal(0n, 0);
    // The 15 significant digits as text, never through binary: 1e-7 is 0.0000001.
    const m = /^(-?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/.exec(x.toPrecision(15));
    if (!m) return new NetDecimal(0n, 0);
    const fraction = m[3] ?? '';
    let mantissa = BigInt(m[2] + fraction);
    let scale = fraction.length - Number(m[4] ?? 0);
    if (scale < 0) {
      mantissa *= pow10(-scale);
      scale = 0;
    }
    while (scale > 0 && mantissa % TEN === 0n) {
      mantissa /= TEN;
      scale -= 1;
    }
    return NetDecimal.fit(m[1] === '-' ? -mantissa : mantissa, scale);
  }

  isZero(): boolean {
    return this.mantissa === 0n;
  }

  sign(): number {
    return this.mantissa < 0n ? -1 : this.mantissa > 0n ? 1 : 0;
  }

  neg(): NetDecimal {
    return new NetDecimal(-this.mantissa, this.scale);
  }

  abs(): NetDecimal {
    return new NetDecimal(abs(this.mantissa), this.scale);
  }

  private static fit(mantissa: bigint, scale: number): NetDecimal {
    let m = mantissa;
    let s = scale;
    while (s > MAX_SCALE || (s > 0 && abs(m) > MAX_MANTISSA)) {
      m = divRound(m, TEN);
      s -= 1;
    }
    return new NetDecimal(m, s);
  }

  private static align(a: NetDecimal, b: NetDecimal): [bigint, bigint, number] {
    const s = Math.max(a.scale, b.scale);
    return [a.mantissa * pow10(s - a.scale), b.mantissa * pow10(s - b.scale), s];
  }

  add(o: NetDecimal): NetDecimal {
    const [x, y, s] = NetDecimal.align(this, o);
    return NetDecimal.fit(x + y, s);
  }

  sub(o: NetDecimal): NetDecimal {
    return this.add(o.neg());
  }

  mul(o: NetDecimal): NetDecimal {
    return NetDecimal.fit(this.mantissa * o.mantissa, this.scale + o.scale);
  }

  /**
   * Division. Exact when the quotient ends -- at the smallest scale that holds
   * it, and no smaller than the dividend's scale less the divisor's -- and
   * otherwise to 28 places, fewer if 96 bits cannot hold them. Null for a zero
   * divisor, which the caller prints as nothing.
   */
  div(o: NetDecimal): NetDecimal | null {
    if (o.mantissa === 0n) return null;
    const numerator = this.mantissa * pow10(MAX_SCALE + o.scale - this.scale);
    if (numerator % o.mantissa === 0n) {
      let m = numerator / o.mantissa;
      let s = MAX_SCALE;
      const floor = Math.max(0, this.scale - o.scale);
      while (s > floor && m % TEN === 0n) {
        m /= TEN;
        s -= 1;
      }
      return NetDecimal.fit(m, s);
    }
    return NetDecimal.fit(divRound(numerator, o.mantissa), MAX_SCALE);
  }

  /** -1, 0 or 1, comparing values regardless of scale. */
  compare(o: NetDecimal): number {
    const [x, y] = NetDecimal.align(this, o);
    return x < y ? -1 : x > y ? 1 : 0;
  }

  /** Rounded to `places` decimals, half away from zero, as .NET's format strings round. */
  roundAway(places: number): NetDecimal {
    if (places >= this.scale) return this;
    const factor = pow10(this.scale - places);
    const q = this.mantissa / factor;
    const r = abs(this.mantissa % factor);
    const up = r * 2n >= factor ? (this.mantissa < 0n ? -1n : 1n) : 0n;
    return new NetDecimal(q + up, places);
  }

  /** Rounded to `places` decimals, half to even, as the criteria Round() does. */
  roundEven(places: number): NetDecimal {
    if (places >= this.scale) return this;
    return new NetDecimal(divRound(this.mantissa, pow10(this.scale - places)), places);
  }

  toNumber(): number {
    return Number(this.toString());
  }

  /** The digits as .NET prints a decimal: scale kept, so 4.0 stays `4.0`. */
  toString(): string {
    const negative = this.mantissa < 0n;
    const digits = abs(this.mantissa).toString().padStart(this.scale + 1, '0');
    const whole = digits.slice(0, digits.length - this.scale);
    const fraction = this.scale ? `.${digits.slice(digits.length - this.scale)}` : '';
    return `${negative ? '-' : ''}${whole}${fraction}`;
  }
}
