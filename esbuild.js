const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const isWatch = process.argv.includes('--watch');

const destWebview = path.join(__dirname, 'dist', 'webview');
fs.mkdirSync(destWebview, { recursive: true });

function copyWebviewFiles() {
  const srcWebview = path.join(__dirname, 'src', 'webview');
  for (const file of ['bridge.html', 'bridge.js']) {
    fs.copyFileSync(path.join(srcWebview, file), path.join(destWebview, file));
  }
  console.log('[esbuild] Webview files copied to dist/webview/');
}

/** @type {import('esbuild').BuildOptions} */
const buildOptions = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  platform: 'node',
  external: ['vscode'],
  format: 'cjs',
  sourcemap: true,
  logLevel: 'info',
  plugins: [
    {
      name: 'copy-webview',
      setup(build) {
        build.onEnd(() => copyWebviewFiles());
      },
    },
  ],
};

if (isWatch) {
  esbuild.context(buildOptions).then((ctx) => {
    ctx.watch();
    console.log('[esbuild] Watching for changes...');
  });
} else {
  esbuild.build(buildOptions).catch(() => process.exit(1));
}
