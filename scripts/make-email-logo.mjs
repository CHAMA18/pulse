/* Generates the Pulse mark used by the transactional email masthead.
 * The mark mirrors src/components/login/pulse-logo.tsx, set on a white
 * rounded tile so it stays crisp and legible on the purple gradient. */
import { mkdir } from "node:fs/promises";
import sharp from "sharp";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="224" height="224" viewBox="0 0 224 224">
  <defs>
    <linearGradient id="pulse-g" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#d946ef"/>
      <stop offset="0.5" stop-color="#b026ff"/>
      <stop offset="1" stop-color="#8b2fe8"/>
    </linearGradient>
    <linearGradient id="tile" x1="0" y1="0" x2="224" y2="224" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#fbf7ff"/>
    </linearGradient>
    <filter id="shadow" x="-40%" y="-40%" width="180%" height="190%">
      <feDropShadow dx="0" dy="10" stdDeviation="10" flood-color="#2e1065" flood-opacity="0.30"/>
    </filter>
  </defs>
  <rect x="20" y="16" width="184" height="184" rx="48" fill="url(#tile)" filter="url(#shadow)"/>
  <g transform="translate(56 56) scale(1.75)">
    <g stroke="url(#pulse-g)" stroke-width="2" opacity="0.5" fill="none">
      <line x1="32" y1="7" x2="50" y2="16"/>
      <line x1="50" y1="16" x2="57" y2="32"/>
      <line x1="57" y1="32" x2="50" y2="48"/>
      <line x1="50" y1="48" x2="32" y2="57"/>
      <line x1="32" y1="57" x2="14" y2="48"/>
      <line x1="14" y1="48" x2="7" y2="32"/>
      <line x1="7" y1="32" x2="14" y2="16"/>
      <line x1="14" y1="16" x2="32" y2="7"/>
    </g>
    <g fill="url(#pulse-g)">
      <circle cx="32" cy="7" r="4.4"/>
      <circle cx="50" cy="16" r="4.4"/>
      <circle cx="57" cy="32" r="4.4"/>
      <circle cx="50" cy="48" r="4.4"/>
      <circle cx="32" cy="57" r="4.4"/>
      <circle cx="14" cy="48" r="4.4"/>
      <circle cx="7" cy="32" r="4.4"/>
      <circle cx="14" cy="16" r="4.4"/>
    </g>
    <polyline points="6,32 22,32 27,23 32,41 36,16 41,34 44,32 58,32"
      fill="none" stroke="url(#pulse-g)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`;

await mkdir("public/brand", { recursive: true });
await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile("public/brand/pulse-mark.png");
console.log("wrote public/brand/pulse-mark.png");
