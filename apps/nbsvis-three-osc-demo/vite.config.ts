import path from 'path';

import { defineConfig, normalizePath, UserConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

// In dev, resolve the library from its sources so edits hot-reload without a rebuild.
// Production builds keep using the package's built output (`dist`).
const libSrc = path.resolve(__dirname, '../../packages/nbsvis/src');

export default defineConfig(
  ({ command }) =>
    ({
      base: process.env.VITE_BASE_URL || '/',
      resolve: {
        alias:
          command === 'serve'
            ? [
                {
                  find: /^@opennbs\/nbsvis\/pixi$/,
                  replacement: path.join(libSrc, 'pixi/index.ts'),
                },
                { find: /^@opennbs\/nbsvis$/, replacement: path.join(libSrc, 'index.ts') },
              ]
            : [],
      },
      // reuse the default song shipped with the Pixi demo instead of duplicating it
      publicDir: path.resolve(__dirname, '../nbsvis-demo/public'),
      plugins: [
        viteStaticCopy({
          targets: [
            {
              src: normalizePath(
                path.resolve(__dirname, 'node_modules/coi-serviceworker/coi-serviceworker.js'),
              ),
              dest: '',
            },
          ],
        }),
      ],
      server: {
        headers: {
          'Cross-Origin-Embedder-Policy': 'require-corp',
          'Cross-Origin-Opener-Policy': 'same-origin',
        },
        fs: {
          allow: ['../..'], // monorepo root: serves the library sources and the other demo's public dir
        },
      },
      build: {
        target: 'esnext',
      },
      preview: {
        headers: {
          'Cross-Origin-Embedder-Policy': 'require-corp',
          'Cross-Origin-Opener-Policy': 'same-origin',
        },
      },
    }) satisfies UserConfig,
);
