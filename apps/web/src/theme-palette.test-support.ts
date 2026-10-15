import { expect } from "vite-plus/test";
import "culori/css";
import { converter, formatHex, parse } from "culori/fn";

const toOklch = converter("oklch");

export function toCanonicalThemeColor(value: string): string | null {
  const parsed = parse(value);

  if (!parsed) return null;
  const color = toOklch(parsed);

  const format = (number: number, precision: number) =>
    number.toFixed(precision).replace(/(?:\.0+|(?:(\.[0-9]*?)0+))$/, "$1");

  return `oklch(${format(color.l, 6)} ${format(color.c ?? 0, 6)} ${format(color.h ?? 0, 3)})`;
}

export function asHex(value: string): string {
  const parsed = parse(value);
  const hex = parsed ? formatHex(parsed) : null;

  if (!hex) throw new Error(`Expected a theme color, received ${value}`);

  return hex.slice(0, 7);
}

export function canonical(value: string): string {
  const color = toCanonicalThemeColor(value);

  if (!color) throw new Error(`Expected a theme color, received ${value}`);

  return color;
}

export function expectThemeColors(
  colors: Readonly<Record<string, string>>,
  expected: Readonly<Record<string, string>>,
): void {
  for (const [role, value] of Object.entries(expected)) {
    expect(asHex(colors[role]!)).toBe(value);
  }
}

export function contrastRatio(first: string, second: string): number {
  const toRgb = (value: string) => {
    const hex = asHex(value).slice(1);

    return [0, 1, 2].map(
      (channel) => Number.parseInt(hex.slice(channel * 2, channel * 2 + 2), 16) / 255,
    );
  };

  const luminance = (value: string) =>
    toRgb(value)
      .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
      .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index]!, 0);

  const lighter = Math.max(luminance(first), luminance(second));
  const darker = Math.min(luminance(first), luminance(second));

  return (lighter + 0.05) / (darker + 0.05);
}
