// Reads tile properties AND tileset metadata from public/assets/poc_tiles.tsx
// and ensures every .tmj file in public/assets/ has a fully embedded tileset
// with up-to-date properties. Run with: npm run sync-tiles

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT     = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS   = join(ROOT, 'public', 'assets');
const TSX_NAME = 'poc_tiles.tsx';
const TSX_PATH = join(ASSETS, TSX_NAME);

function parseAttrs(str) {
    const attrs = {};
    const re = /(\w+)="([^"]+)"/g;
    let m;
    while ((m = re.exec(str)) !== null) {
        attrs[m[1]] = m[2];
    }
    return attrs;
}

function parseTsx(xml) {
    // Tileset metadata from the <tileset> opening tag and <image> element
    const tsMatch  = xml.match(/<tileset\s+([^>]+)>/);
    const imgMatch = xml.match(/<image\s+([^/]+)\/>/);
    if (!tsMatch || !imgMatch) {
        throw new Error('Could not parse <tileset> or <image> from .tsx');
    }
    const tsA  = parseAttrs(tsMatch[1]);
    const imgA = parseAttrs(imgMatch[1]);

    const metadata = {
        columns:     parseInt(tsA.columns, 10),
        image:       imgA.source,
        imageheight: parseInt(imgA.height, 10),
        imagewidth:  parseInt(imgA.width, 10),
        margin:      parseInt(tsA.margin || '0', 10),
        name:        tsA.name,
        spacing:     parseInt(tsA.spacing || '0', 10),
        tilecount:   parseInt(tsA.tilecount, 10),
        tileheight:  parseInt(tsA.tileheight, 10),
        tilewidth:   parseInt(tsA.tilewidth, 10),
    };

    // Per-tile properties from each <tile id="..."> block
    const tiles = [];
    const tileRegex = /<tile\s+id="(\d+)">([\s\S]*?)<\/tile>/g;
    let tm;
    while ((tm = tileRegex.exec(xml)) !== null) {
        const id = parseInt(tm[1], 10);
        const properties = [];
        const propRegex = /<property\s+name="([^"]+)"(?:\s+type="([^"]+)")?\s+value="([^"]+)"\s*\/>/g;
        let p;
        while ((p = propRegex.exec(tm[2])) !== null) {
            const name   = p[1];
            const type   = p[2] || 'string';
            const rawVal = p[3];
            let value    = rawVal;
            if (type === 'bool')       value = rawVal === 'true';
            else if (type === 'int')   value = parseInt(rawVal, 10);
            else if (type === 'float') value = parseFloat(rawVal);
            properties.push({ name, type, value });
        }
        if (properties.length) tiles.push({ id, properties });
    }

    return { metadata, tiles };
}

function patchTmj(path, metadata, tilesData) {
    const json = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(json.tilesets)) {
        return { ok: false, reason: 'no tilesets array' };
    }

    // Find every tileset entry pointing at our image or .tsx.
    const matchIndices = [];
    for (let i = 0; i < json.tilesets.length; i++) {
        const ts = json.tilesets[i];
        if (ts.source === TSX_NAME || ts.image === metadata.image) {
            matchIndices.push(i);
        }
    }
    if (matchIndices.length === 0) {
        return { ok: false, reason: 'no matching tileset' };
    }

    // Pick the canonical entry: prefer an embedded one (has image, no source).
    let canonicalIdx = matchIndices.find(i =>
    json.tilesets[i].image && !json.tilesets[i].source
    );
    if (canonicalIdx === undefined) { canonicalIdx = matchIndices[0]; }
    const canonicalEntry    = json.tilesets[canonicalIdx];
    const canonicalFirstgid = canonicalEntry.firstgid;

    // Everything else matching is a duplicate. For each, remap any GIDs in
    // layer/object data that fall in its range, then drop the entry.
    const FLIP_FLAGS = 0xE0000000;  // Tiled's flip/rotate flag bits
    const GID_MASK   = 0x1FFFFFFF;
    let remappedTiles = 0;

    const duplicates = matchIndices.filter(i => i !== canonicalIdx);

    for (const dupIdx of duplicates) {
        const dup   = json.tilesets[dupIdx];
        const shift = canonicalFirstgid - dup.firstgid;
        const lo    = dup.firstgid;
        const hi    = dup.firstgid + metadata.tilecount - 1;

        const remap = (gid) => {
            const flags = gid & FLIP_FLAGS;
            const clean = gid & GID_MASK;
            if (clean >= lo && clean <= hi) {
                remappedTiles++;
                return (clean + shift) | flags;
            }
            return gid;
        };

        if (Array.isArray(json.layers)) {
            for (const layer of json.layers) {
                if (layer.type === 'tilelayer' && Array.isArray(layer.data)) {
                    for (let k = 0; k < layer.data.length; k++) {
                        layer.data[k] = remap(layer.data[k]);
                    }
                } else if (layer.type === 'objectgroup' && Array.isArray(layer.objects)) {
                    for (const obj of layer.objects) {
                        if (typeof obj.gid === 'number') { obj.gid = remap(obj.gid); }
                    }
                }
            }
        }
    }

    // Drop duplicates (highest index first so lower indices stay valid).
    duplicates.sort((a, b) => b - a).forEach(i => json.tilesets.splice(i, 1));

    // Canonical's index may have shifted after the splices.
    const newIdx = json.tilesets.indexOf(canonicalEntry);

    // Rebuild as a fully embedded entry, alphabetical key order.
    json.tilesets[newIdx] = {
        columns:     metadata.columns,
        firstgid:    canonicalFirstgid,
        image:       metadata.image,
        imageheight: metadata.imageheight,
        imagewidth:  metadata.imagewidth,
        margin:      metadata.margin,
        name:        metadata.name,
        spacing:     metadata.spacing,
        tilecount:   metadata.tilecount,
        tileheight:  metadata.tileheight,

const { metadata, tiles } = parseTsx(readFileSync(TSX_PATH, 'utf8'));
console.log(`Read tileset "${metadata.name}" (${metadata.tilecount} tiles, image: ${metadata.image})`);
console.log(`Read ${tiles.length} tile property entries from ${TSX_NAME}:`);
for (const t of tiles) {
    const summary = t.properties.map(p => `${p.name}=${p.value}`).join(', ');
    console.log(`  tile ${t.id}: ${summary}`);
}

const files = readdirSync(ASSETS).filter(f => f.endsWith('.tmj'));
console.log(`\nPatching ${files.length} .tmj files:`);
for (const file of files) {
    const result = patchTmj(join(ASSETS, file), metadata, tiles);
    if (result.ok) {
        let note = 'updated';
        if (result.removedDuplicates > 0) {
            note = `cleaned up ${result.removedDuplicates} duplicate tileset(s), remapped ${result.remappedTiles} tile(s)`;
        }
        console.log(`  ✓ ${file}  (${note})`);
    } else {
        console.log(`  ✗ ${file}  (${result.reason})`);
    }
}
