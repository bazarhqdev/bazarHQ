'use client';

import {
  Apple,
  Backpack,
  Banana,
  BatteryCharging,
  Bean,
  Cable,
  Carrot,
  Cherry,
  CupSoda,
  Droplets,
  Egg,
  Flower2,
  Footprints,
  Glasses,
  Headphones,
  Keyboard,
  Lamp,
  Leaf,
  Milk,
  Mouse,
  Package,
  PlugZap,
  Popcorn,
  Salad,
  Shirt,
  Speaker,
  ToyBrick,
  Watch,
  Wheat,
  type LucideIcon,
} from 'lucide-react';
import { createElement, type CSSProperties } from 'react';
import { cn } from '../../cn';

/**
 * Seeded demo products have no uploaded photos, so the storefront draws a
 * consistent illustrated tile from the product name. Real uploads (signed
 * Storage URLs) always win.
 */
const RULES: [RegExp, LucideIcon][] = [
  [/tomato|cherry/i, Cherry],
  [/potato|onion|vegetable/i, Salad],
  [/carrot/i, Carrot],
  [/broccoli|spinach|leaf/i, Leaf],
  [/banana/i, Banana],
  [/apple|mango|fruit/i, Apple],
  [/rice|atta|flour/i, Wheat],
  [/dal|lentil|bean/i, Bean],
  [/oil|water/i, Droplets],
  [/milk|dairy/i, Milk],
  [/egg/i, Egg],
  [/tea|coffee|juice|soda/i, CupSoda],
  [/chanachur|chips|snack/i, Popcorn],
  [/kurti|shirt|jacket|dress|scarf|t-shirt/i, Shirt],
  [/shoe|sneaker|sandal/i, Footprints],
  [/backpack|bag/i, Backpack],
  [/sunglass|glasses/i, Glasses],
  [/earbud|headphone|headset/i, Headphones],
  [/speaker/i, Speaker],
  [/charger/i, PlugZap],
  [/cable|usb/i, Cable],
  [/power bank|battery/i, BatteryCharging],
  [/watch/i, Watch],
  [/mouse/i, Mouse],
  [/keyboard/i, Keyboard],
  [/block|toy|lego/i, ToyBrick],
  [/vase|flower/i, Flower2],
  [/lamp|light/i, Lamp],
];

const PALETTES = [
  ['#ecfdf5', '#047857'],
  ['#fef3c7', '#b45309'],
  ['#ffe4e6', '#be123c'],
  ['#e0f2fe', '#0369a1'],
  ['#ede9fe', '#6d28d9'],
  ['#ecfccb', '#4d7c0f'],
  ['#fae8ff', '#a21caf'],
  ['#f1f5f9', '#334155'],
] as const;

function hash(s: string) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

export function productIcon(name: string): LucideIcon {
  return RULES.find(([re]) => re.test(name))?.[1] ?? Package;
}

export function ProductArt({
  name,
  url,
  className,
  rounded = 'rounded-xl',
  iconScale = 0.38,
  style,
}: {
  name: string;
  url?: string | null;
  className?: string;
  rounded?: string;
  iconScale?: number;
  style?: CSSProperties;
}) {
  if (url) return <img src={url} alt="" className={cn('h-full w-full object-cover', rounded, className)} style={style} />;
  const [bg, fg] = PALETTES[hash(name) % PALETTES.length]!;
  return (
    <div
      aria-hidden
      className={cn('relative flex items-center justify-center overflow-hidden', rounded, className)}
      style={{ background: bg, color: fg, containerType: 'size', ...style }}
    >
      <span className="absolute -right-[12%] -top-[12%] size-[55%] rounded-full opacity-40" style={{ background: '#fff' }} />
      <span className="absolute -bottom-[18%] -left-[10%] size-[45%] rounded-full opacity-25" style={{ background: fg }} />
      {createElement(productIcon(name), {
        className: 'relative',
        strokeWidth: 1.6,
        style: { width: `${iconScale * 100}cqmin`, height: `${iconScale * 100}cqmin` },
      })}
    </div>
  );
}

export function StoreLogo({
  name,
  url,
  colour,
  size = 48,
  className,
}: {
  name: string;
  url?: string | null;
  colour: string;
  size?: number;
  className?: string;
}) {
  if (url) return <img src={url} alt="" className={cn('shrink-0 rounded-xl object-cover ring-1 ring-line', className)} style={{ width: size, height: size }} />;
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <span
      aria-hidden
      className={cn('inline-flex shrink-0 items-center justify-center rounded-xl font-bold text-white', className)}
      style={{ width: size, height: size, background: colour, fontSize: size * 0.36 }}
    >
      {initials}
    </span>
  );
}
