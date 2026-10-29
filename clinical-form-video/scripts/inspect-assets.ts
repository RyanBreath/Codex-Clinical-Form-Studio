import {existsSync, readdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {extname, relative, resolve} from 'node:path';
import {imageSize} from 'image-size';
import {ensureDir, ffprobe, outDir, parseFrameRate, projectRoot, publicDir, readJson, writeJson} from './lib';

const expected = [
  ...Array.from({length: 8}, (_, index) => `images/${String(index + 1).padStart(2, '0')}-${[
    'clinical-data-problem',
    'orchestrator-workflow',
    'gpt56-protocol-analysis',
    'clinical-cdash-mapping',
    'ecrf-generation',
    'codex-qa',
    'version-comparison',
    'github-deployment',
  ][index]}.png`),
  ...[
    'upload-protocol',
    'protocol-analysis',
    'yaml-editor',
    'form-builder',
    'cdash-search',
    'cdash-approval',
    'json-preview',
    'ecrf-preview',
    'validation-error',
    'playwright-test',
    'protocol-diff',
    'github-pr',
    'deployment-success',
  ].map((name) => `screenshots/${name}.png`),
  ...['protocol-upload', 'form-editing', 'cdash-mapping', 'ecrf-preview', 'automated-qa', 'github-deployment'].map(
    (name) => `recordings/${name}.mp4`,
  ),
];

const placeholderRegistry = new Set(
  readJson<string[]>(resolve(projectRoot, 'src/data/placeholder-assets.json')).map((path) => path.replaceAll('\\', '/')),
);

const createPlaceholder = (target: string, title: string, detail: string) => {
  ensureDir(resolve(target, '..'));
  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080">
    <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#eff8ff"/><stop offset="1" stop-color="#e3f5f1"/></linearGradient></defs>
    <rect width="1920" height="1080" fill="url(#bg)"/>
    <rect x="250" y="250" width="1420" height="580" rx="42" fill="#ffffff" stroke="#8bb9d6" stroke-width="4"/>
    <circle cx="960" cy="410" r="68" fill="#087f8c"/><path d="M925 410h70M960 375v70" stroke="#fff" stroke-width="16" stroke-linecap="round"/>
    <text x="960" y="560" text-anchor="middle" font-family="Arial" font-size="58" font-weight="700" fill="#0a3152">${title}</text>
    <text x="960" y="635" text-anchor="middle" font-family="Arial" font-size="31" fill="#486b82">${detail}</text>
    <text x="960" y="735" text-anchor="middle" font-family="Arial" font-size="24" fill="#07878b">Replace this local asset without changing scene code.</text>
  </svg>`;
  writeFileSync(target, svg, 'utf8');
};

createPlaceholder(resolve(publicDir, 'placeholders/missing-visual.svg'), 'Missing visual asset', 'A documented fallback is being shown.');
createPlaceholder(resolve(publicDir, 'placeholders/missing-recording.svg'), 'Recording not supplied', 'The scene falls back to a still image.');

const walk = (dir: string): string[] =>
  readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
    const absolute = resolve(dir, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });

const extensions = new Set(['.png', '.jpg', '.jpeg', '.svg', '.mp4', '.mov', '.webm', '.mp3', '.wav', '.m4a']);
const files = walk(publicDir).filter((file) => extensions.has(extname(file).toLowerCase()));
const assets = files.map((file) => {
  const extension = extname(file).toLowerCase();
  const relativePath = relative(publicDir, file).replaceAll('\\', '/');
  const fileSize = statSync(file).size;
  const placeholder = relativePath.startsWith('placeholders/') || placeholderRegistry.has(relativePath);
  if (['.png', '.jpg', '.jpeg', '.svg'].includes(extension)) {
    const dimensions = imageSize(readFileSync(file));
    const width = dimensions.width ?? null;
    const height = dimensions.height ?? null;
    return {
      relativePath,
      kind: 'image' as const,
      width,
      height,
      aspectRatio: width && height ? Number((width / height).toFixed(4)) : null,
      durationSeconds: null,
      codec: extension.slice(1),
      frameRate: null,
      fileSize,
      placeholder,
    };
  }
  const metadata = ffprobe(file);
  const video = metadata.streams.find((stream) => stream.codec_type === 'video');
  return {
    relativePath,
    kind: video ? ('video' as const) : ('audio' as const),
    width: video?.width ?? null,
    height: video?.height ?? null,
    aspectRatio: video?.width && video?.height ? Number((video.width / video.height).toFixed(4)) : null,
    durationSeconds: Number(metadata.format.duration ?? video?.duration ?? 0),
    codec: (video ?? metadata.streams[0])?.codec_name ?? null,
    frameRate: video ? parseFrameRate(video.avg_frame_rate ?? video.r_frame_rate) : null,
    fileSize,
    placeholder,
  };
});

const missing = expected.filter((asset) => !existsSync(resolve(publicDir, asset)) || placeholderRegistry.has(asset));
const report = {generatedAt: new Date().toISOString(), expectedCount: expected.length, foundCount: assets.length, missing, assets};
writeJson(resolve(projectRoot, 'src/data/assets-manifest.json'), report);
writeJson(resolve(outDir, 'assets-report.json'), report);

console.log(`Found ${assets.length} local media assets.`);
console.log(`Missing or placeholder assets: ${missing.length}`);
for (const item of missing) console.log(`  - ${item}`);
