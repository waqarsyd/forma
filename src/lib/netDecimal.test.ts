/**
 * .NET's decimal. The expectations marked "printed" are what DevExpress 20.1
 * printed for the same arithmetic in case s16 of
 * docs/proposals/devexpress-parity.md (`RepxProbe render`, 2026-10-30).
 */
import { describe, it, expect } from 'vitest';
import { NetDecimal } from './netDecimal';

const d = (s: string) => NetDecimal.parse(s)!;

describe('NetDecimal', () => {
  it('keeps the scale it was written with, through arithmetic', () => {
    expect(d('8').mul(d('0.5')).toString()).toBe('4.0'); // printed
    expect(d('1.10').add(d('2')).toString()).toBe('3.10');
    expect(d('-12.50').toString()).toBe('-12.50');
    expect(d('.5').toString()).toBe('0.5');
  });

  it('sums exactly where a double would not', () => {
    const prices = ['12.5', '9.99', '100', '0.5', '33.333', '7'].map(d);
    expect(prices.reduce((a, b) => a.add(b)).toString()).toBe('163.323'); // printed
  });

  it('divides to 28 places, or fewer when 96 bits cannot hold them', () => {
    expect(d('12.5').div(d('3'))!.toString()).toBe('4.1666666666666666666666666667'); // printed
    expect(d('100').div(d('3'))!.toString()).toBe('33.333333333333333333333333333'); // printed: 27 places
    expect(d('9.99').div(d('3'))!.toString()).toBe('3.33'); // printed
    expect(d('32').div(d('6'))!.toString()).toBe('5.3333333333333333333333333333'); // printed as an average
  });

  it('ends an exact quotient as soon as it ends', () => {
    expect(d('10').div(d('4'))!.toString()).toBe('2.5');
    expect(d('1.00').div(d('2'))!.toString()).toBe('0.50');
    expect(d('6').div(d('3'))!.toString()).toBe('2');
  });

  it('refuses a zero divisor rather than inventing a value', () => {
    expect(d('1').div(d('0'))).toBeNull();
  });

  it('rounds half away from zero for formatting and half to even for Round()', () => {
    expect(d('2.345').roundAway(2).toString()).toBe('2.35');
    expect(d('-2.5').roundAway(0).toString()).toBe('-3');
    expect(d('2.5').roundEven(0).toString()).toBe('2');
    expect(d('3.5').roundEven(0).toString()).toBe('4');
    expect(d('-2.5').roundEven(0).toString()).toBe('-2');
  });

  it('compares values whatever their scale', () => {
    expect(d('1.50').compare(d('1.5'))).toBe(0);
    expect(d('-1').compare(d('0.001'))).toBe(-1);
  });

  it('reads a double through its 15 significant digits, as .NET converts one', () => {
    expect(NetDecimal.fromNumber(0.1 + 0.2).toString()).toBe('0.3');
    expect(NetDecimal.fromNumber(1e-7).toString()).toBe('0.0000001');
    expect(NetDecimal.parse('abc')).toBeNull();
    expect(NetDecimal.parse('')).toBeNull();
  });
});
