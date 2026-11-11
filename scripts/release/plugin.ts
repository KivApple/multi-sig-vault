import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { RsbuildPlugin } from '@rsbuild/core';
import { computeReleaseId, sha256Hex, sortFiles, type ReleaseFile } from '../../src/lib/update/releaseCore.mjs';

export interface ReleaseManifestPluginOptions {
  version: string;
}

const SKIP = new Set(['release.json', '.DS_Store']);

const walk = async (dir: string): Promise<string[]> => {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.isFile() && !SKIP.has(entry.name)) out.push(full);
  }
  return out;
};

/**
 * Writes `dist/release.json` after a production build: every emitted file with its SHA-256 and
 * a release id that commits to the version and all hashes. The id is reproducible – it does not
 * depend on build time, so anyone can rebuild the sources and compare ids.
 */
export const pluginReleaseManifest = ({ version }: ReleaseManifestPluginOptions): RsbuildPlugin => ({
  name: 'msv:release-manifest',
  setup: (api) => {
    api.onAfterBuild(async () => {
      const dist = api.context.distPath;
      const files: ReleaseFile[] = [];
      for (const full of await walk(dist)) {
        const data = await readFile(full);
        files.push({
          path: relative(dist, full).split(sep).join('/'),
          sha256: await sha256Hex(data),
          size: data.byteLength,
        });
      }
      const sorted = sortFiles(files);
      const id = await computeReleaseId(version, sorted);
      const manifest = { version, id, builtAt: new Date().toISOString(), files: sorted };
      await writeFile(join(dist, 'release.json'), `${JSON.stringify(manifest, null, 1)}\n`);
      api.logger.info(`release ${version} id ${id} (${sorted.length} files)`);
    });
  },
});
