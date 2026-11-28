/**
 * Generates raster favicon & PWA icon variants deterministically from
 * frontend/public/icons/aegis-mark.svg using Playwright Chromium + pure Node ICO packing.
 *
 * Usage (from frontend/):
 *   node scripts/generate-brand-icons.mjs
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(FRONTEND_DIR, 'public');
const ICONS_DIR = path.join(PUBLIC_DIR, 'icons');
const MASTER_SVG_PATH = path.join(ICONS_DIR, 'aegis-mark.svg');

function buildIcoFromPngs(entries) {
	const count = entries.length;
	const header = Buffer.alloc(6);
	header.writeUInt16LE(0, 0); // reserved
	header.writeUInt16LE(1, 2); // type = ICO
	header.writeUInt16LE(count, 4);

	let offset = 6 + count * 16;
	const dirBuffers = [];
	const dataBuffers = [];

	for (const { size, png } of entries) {
		const dir = Buffer.alloc(16);
		dir.writeUInt8(size === 256 ? 0 : size, 0);
		dir.writeUInt8(size === 256 ? 0 : size, 1);
		dir.writeUInt8(0, 2); // palette
		dir.writeUInt8(0, 3); // reserved
		dir.writeUInt16LE(1, 4); // planes
		dir.writeUInt16LE(32, 6); // bpp
		dir.writeUInt32LE(png.length, 8);
		dir.writeUInt32LE(offset, 12);
		dirBuffers.push(dir);
		dataBuffers.push(png);
		offset += png.length;
	}

	return Buffer.concat([header, ...dirBuffers, ...dataBuffers]);
}

async function renderIconPng(page, svgMarkup, size, { background = null, innerScale = 1.0 } = {}) {
	await page.setViewportSize({ width: size, height: size });
	const innerSize = Math.round(size * innerScale);
	const html = `<!doctype html>
<html>
<head>
<style>
  html, body {
    margin: 0;
    padding: 0;
    width: ${size}px;
    height: ${size}px;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    background: ${background || 'transparent'};
  }
  svg {
    width: ${innerSize}px;
    height: ${innerSize}px;
    display: block;
  }
</style>
</head>
<body>${svgMarkup}</body>
</html>`;
	await page.setContent(html, { waitUntil: 'load' });
	return page.screenshot({
		type: 'png',
		omitBackground: background === null,
		clip: { x: 0, y: 0, width: size, height: size },
	});
}

async function main() {
	fs.mkdirSync(ICONS_DIR, { recursive: true });
	const svgMarkup = fs.readFileSync(MASTER_SVG_PATH, 'utf-8');
	const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });

	try {
		const ctx = await browser.newContext({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
		const page = await ctx.newPage();

		const png16 = await renderIconPng(page, svgMarkup, 16, { innerScale: 1.0 });
		const png32 = await renderIconPng(page, svgMarkup, 32, { innerScale: 1.0 });
		const png180 = await renderIconPng(page, svgMarkup, 180, { background: '#0a0f1c', innerScale: 0.84 });
		const png192 = await renderIconPng(page, svgMarkup, 192, { innerScale: 0.96 });
		const png512 = await renderIconPng(page, svgMarkup, 512, { innerScale: 0.96 });
		// Maskable safe zone is centered 80% circle (radius = 40% = ~204.8px); 68% scale guarantees ample outer safe margin
		const png512Maskable = await renderIconPng(page, svgMarkup, 512, { background: '#0a0f1c', innerScale: 0.68 });

		fs.writeFileSync(path.join(PUBLIC_DIR, 'favicon.ico'), buildIcoFromPngs([
			{ size: 16, png: png16 },
			{ size: 32, png: png32 },
		]));
		fs.writeFileSync(path.join(ICONS_DIR, 'favicon-32x32.png'), png32);
		fs.writeFileSync(path.join(ICONS_DIR, 'apple-touch-icon.png'), png180);
		fs.writeFileSync(path.join(ICONS_DIR, 'icon-192.png'), png192);
		fs.writeFileSync(path.join(ICONS_DIR, 'icon-512.png'), png512);
		fs.writeFileSync(path.join(ICONS_DIR, 'icon-512-maskable.png'), png512Maskable);

		console.log('Generated AegisMap icons in public/ and public/icons/.');
	} finally {
		await browser.close();
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
