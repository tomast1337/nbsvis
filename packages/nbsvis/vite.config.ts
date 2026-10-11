import libAssetsPlugin from '@laynezh/vite-plugin-lib-assets';
import { resolve } from 'pathe';
import { defineConfig, UserConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig(({ mode }: UserConfig) => {
  return {
    plugins: [
      dts({
        insertTypesEntry: true,
      }),
      // inline assets in dev mode, use lib-assets in production mode
      // libAssetsPlugin currently does not regenerate assets in --watch mode:
      // https://github.com/laynezh/vite-plugin-lib-assets/issues/62
      mode == 'production' && libAssetsPlugin(),
    ],
    build: {
      target: 'ESNext',
      sourcemap: mode === 'development',
      minify: mode === 'production' ? 'esbuild' : false,
      lib: {
        // `index` is the core; `pixi` is the optional Pixi.js viewer (`@opennbs/nbsvis/pixi`)
        entry: {
          index: resolve(__dirname, 'src/index.ts'),
          pixi: resolve(__dirname, 'src/pixi/index.ts'),
        },
        formats: ['es'], // TODO: umd, cjs (remove top-level await)
        fileName: (_format: string, entryName: string) => `${entryName}.js`,
      },
      rollupOptions: {
        // optional peer dependency: provided by the app that imports `@opennbs/nbsvis/pixi`
        external: ['pixi.js'],
      },
    },
  } satisfies UserConfig;
});
