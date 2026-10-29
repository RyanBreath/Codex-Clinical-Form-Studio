import {execFileSync, spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';

export const projectRoot = resolve(import.meta.dirname, '..');
export const publicDir = resolve(projectRoot, 'public');
export const outDir = resolve(projectRoot, 'out');

export const ensureDir = (path: string) => mkdirSync(path, {recursive: true});

export const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

export const writeJson = (path: string, value: unknown) => {
  ensureDir(dirname(path));
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

export const run = (command: string, args: string[], options?: {cwd?: string; quiet?: boolean}) => {
  const result = spawnSync(command, args, {
    cwd: options?.cwd ?? projectRoot,
    encoding: 'utf8',
    stdio: options?.quiet ? 'pipe' : 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with code ${result.status}${result.stderr ? `: ${result.stderr}` : ''}`);
  }
  return {stdout: result.stdout ?? '', stderr: result.stderr ?? ''};
};

export const commandExists = (command: string) => {
  const probe = spawnSync(command, ['-version'], {stdio: 'ignore', windowsHide: true});
  return !probe.error && probe.status === 0;
};

export const ffprobe = (path: string) => {
  const output = execFileSync(
    'ffprobe',
    ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path],
    {encoding: 'utf8', windowsHide: true},
  );
  return JSON.parse(output) as {
    streams: Array<{
      codec_type: 'audio' | 'video';
      codec_name?: string;
      width?: number;
      height?: number;
      pix_fmt?: string;
      sample_rate?: string;
      r_frame_rate?: string;
      avg_frame_rate?: string;
      duration?: string;
    }>;
    format: {duration?: string; size?: string; format_name?: string};
  };
};

export const durationOf = (path: string) => Number(ffprobe(path).format.duration ?? 0);

export const parseFrameRate = (value?: string) => {
  if (!value) return null;
  const parts = value.split('/');
  const numerator = Number(parts[0] ?? 0);
  const denominator = Number(parts[1] ?? 1);
  return denominator === 0 ? null : numerator / denominator;
};

export const fileExistsAndNonZero = (path: string) => existsSync(path) && readFileSync(path).byteLength > 0;

export const srtTime = (seconds: number) => {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  const millis = ms % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
};
