import * as esbuild from 'esbuild';
import { statSync } from 'fs';

const isWatch = process.argv.includes('--watch');
const isProd = process.env.NODE_ENV === 'production';

const buildOptions = {
  entryPoints: ['src/tracker.js'],
  bundle: true,
  outfile: 'v1/tracker.js',
  format: 'iife',
  globalName: 'UXTrackerInternal',
  target: ['es2020'],
  minify: isProd,
  sourcemap: isProd ? false : 'linked',
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
  },
};

function reportSize() {
  try {
    const { size } = statSync('v1/tracker.js');
    console.log(`Built v1/tracker.js (${(size / 1024).toFixed(1)}kb)`);
  } catch {
    console.log('Built v1/tracker.js');
  }
}

if (isWatch) {
  const ctx = await esbuild.context({
    ...buildOptions,
    plugins: [
      {
        name: 'watch-reporter',
        setup(build) {
          build.onEnd((result) => {
            if (result.errors.length > 0) {
              result.errors.forEach((e) => {
                const loc = e.location;
                console.error(loc ? `${loc.file}:${loc.line}: ${e.text}` : e.text);
              });
            } else {
              reportSize();
            }
          });
        },
      },
    ],
  });
  await ctx.watch();
  console.log('[UXTracker] Watching for changes…');
} else {
  try {
    await esbuild.build(buildOptions);
    reportSize();
  } catch (err) {
    if (err.errors?.length) {
      err.errors.forEach((e) => {
        const loc = e.location;
        console.error(loc ? `${loc.file}:${loc.line}: ${e.text}` : e.text);
      });
    } else {
      console.error(err);
    }
    process.exit(1);
  }
}
