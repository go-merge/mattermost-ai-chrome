import sharp from 'sharp';
import {readFileSync} from 'fs';
import {resolve, dirname} from 'path';
import {fileURLToPath} from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = resolve(__dirname, '..', 'icons');
const svg = readFileSync(resolve(iconsDir, 'icon.svg'));

for (const size of [16, 32, 48, 128]) {
    await sharp(svg)
        .resize(size, size)
        .png()
        .toFile(resolve(iconsDir, `icon${size}.png`));
    console.log(`Generated icon${size}.png`);
}

console.log('Done!');
