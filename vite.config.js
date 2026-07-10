import { defineConfig } from 'vite';
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// The build output lives in the parent Hikey-suite repo (../droidmoon/dist),
// where a small Flask blueprint serves it at /droidmoon/ behind the suite's
// login. Relative base so the bundle works under that URL prefix.
export default defineConfig({
    base: './',
    build: {
        outDir: '../droidmoon/dist',
        emptyOutDir: true,
    },
    plugins: [
        {
            // public/ is copied verbatim; strip editor backups (*~) and the
            // Tiled tileset source (.tsx) from what actually gets deployed.
            name: 'prune-non-runtime-assets',
            closeBundle() {
                const dist = join(import.meta.dirname, '..', 'droidmoon', 'dist');
                for (const entry of readdirSync(dist, { recursive: true })) {
                    if (entry.endsWith('~') || entry.endsWith('.tsx')) {
                        rmSync(join(dist, entry));
                    }
                }
            },
        },
    ],
});
