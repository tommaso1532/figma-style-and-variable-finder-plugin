import { build, context } from 'esbuild';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isWatch = process.argv.includes('--watch');

// ─── Plugin bundle (sandbox code) ──────────────────────────────────────────

const pluginConfig = {
  entryPoints: [resolve(__dirname, 'src/plugin/main.ts')],
  bundle: true,
  outfile: resolve(__dirname, 'dist/plugin.js'),
  format: 'iife',
  target: 'es2017',
  sourcemap: false,
  minify: !isWatch,
  logLevel: 'info',
};

// ─── UI bundle (iframe code) ───────────────────────────────────────────────

const uiBundlePath = resolve(__dirname, 'dist/ui-bundle.js');

const uiConfig = {
  entryPoints: [resolve(__dirname, 'src/ui/ui.ts')],
  bundle: true,
  outfile: uiBundlePath,
  format: 'iife',
  target: 'es2020',
  sourcemap: false,
  minify: !isWatch,
  logLevel: 'info',
};

// ─── HTML inlining ─────────────────────────────────────────────────────────

function inlineUIBundle() {
  const htmlTemplate = readFileSync(resolve(__dirname, 'src/ui/index.html'), 'utf8');
  const jsBundle = readFileSync(uiBundlePath, 'utf8');

  // Replace the placeholder script tag with the inlined bundle
  const finalHtml = htmlTemplate.replace(
    /<script>[\s\S]*?<\/script>/,
    `<script>${jsBundle}</script>`,
  );

  writeFileSync(resolve(__dirname, 'dist/ui.html'), finalHtml);
  console.log('  dist/ui.html inlined');
}

// ─── Build ─────────────────────────────────────────────────────────────────

async function run() {
  if (isWatch) {
    const pluginCtx = await context(pluginConfig);
    const uiCtx = await context({
      ...uiConfig,
      plugins: [
        {
          name: 'inline-html',
          setup(build) {
            build.onEnd(() => {
              try {
                inlineUIBundle();
              } catch (e) {
                console.error('HTML inline failed:', e);
              }
            });
          },
        },
      ],
    });

    await pluginCtx.watch();
    await uiCtx.watch();
    console.log('Watching for changes…');
  } else {
    await build(pluginConfig);
    await build(uiConfig);
    inlineUIBundle();
    console.log('Build complete.');
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
