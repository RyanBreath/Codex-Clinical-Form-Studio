# Codex Clinical Form Studio — Hackathon Demo Video

This directory contains a complete, reproducible Remotion production pipeline for the **Codex Clinical Form Studio** hackathon video. It builds an English-narrated, 1920×1080, 30 FPS H.264/AAC MP4 in less than three minutes, plus synchronized English and Taiwan Traditional Chinese subtitles.

The checked build is **174.500 seconds** long. It includes eight scenes, 369 words of English narration, local system screenshots, medical-technology motion graphics, a no-caption YouTube master, a burned-English-caption version, verification frames, and machine-readable reports.

## Architecture

```text
local images and screenshots
        ↓
assets-manifest.json
        ↓
scenes.json + narration JSON
        ↓
local TTS → scene MP3 files → synchronized EN / zh-TW SRT
        ↓
Remotion (React + TypeScript) → H.264 raw master
        ↓
FFmpeg → yuv420p + AAC 48 kHz + burned-caption variant
        ↓
FFprobe / decode / subtitle / frame verification reports
```

Timing, narration, assets, highlights, crops, zooms, transitions, caption placement, and audio levels live in `src/data` instead of being embedded across React components. The eight scene components use a shared rendering layer while remaining independently selectable in source control.

## Project layout

```text
public/                 Local images, screenshots, recordings, audio, and SRT files
scripts/                Asset, voice, subtitle, duration, render, and verification automation
src/components/         Reusable Remotion visual components
src/scenes/             Eight independent scene components
src/data/               Scene, narration, caption, placeholder, and asset manifests
out/                    Final videos, reports, contact sheet, and QA frames
```

## Prerequisites

- Node.js 20 or newer. The verified environment used Node.js 24.
- npm 10 or newer.
- FFmpeg and FFprobe on `PATH`.
- Windows: `System.Speech` with an installed English voice. The verified build used **Microsoft David Desktop**.
- WSL/Linux: `espeak-ng` is recommended for credential-free local narration.

Verify the tools:

```bash
node --version
npm --version
ffmpeg -version
ffprobe -version
```

### Installing FFmpeg

- Windows: install a current FFmpeg build and add its `bin` directory to `PATH`.
- Ubuntu/WSL: `sudo apt-get update && sudo apt-get install -y ffmpeg espeak-ng`
- Fedora: `sudo dnf install ffmpeg espeak-ng`

## Installation

The dependency versions are pinned in `package-lock.json`.

```bash
npm ci --ignore-scripts
npm run prepare
```

`npm run prepare` performs asset inspection, narration generation or reuse, subtitle generation, duration enforcement, and TypeScript checking.

## Environment variables

Copy `.env.example` to `.env.local` only when overriding defaults. Secret-bearing env files are ignored by Git.

| Variable | Default | Purpose |
|---|---:|---|
| `TTS_PROVIDER` | `local` | Selects the credential-free local voice path used by this build. |
| `LOCAL_TTS_VOICE` | `Microsoft David Desktop` | Windows SAPI voice name. |
| `LOCAL_TTS_RATE` | `2` | SAPI speaking rate used for the verified narration. |
| `VIDEO_FPS` | `30` | Composition and output frame rate. |
| `VIDEO_WIDTH` | `1920` | Output width. |
| `VIDEO_HEIGHT` | `1080` | Output height. |
| `VIDEO_TARGET_SECONDS` | `165` | Minimum target used to allocate visual holds. |
| `VIDEO_MAX_SECONDS` | `179` | Hard build limit before final render. |
| `OPENAI_API_KEY` | blank | Reserved for a future OpenAI TTS provider; not read by the selected local provider. |
| `OPENAI_TTS_MODEL` | `gpt-4o-mini-tts` | Reserved compatibility setting. |
| `OPENAI_TTS_VOICE` | blank | Reserved compatibility setting. |

The current implementation intentionally uses local TTS because a credential-free alternative was selected for this production. No API key is written to source, reports, logs, or rendered artifacts.

## Asset naming and replacement

Concept images belong in `public/images` using the fixed `01-...png` through `08-...png` scene names. Product captures belong in `public/screenshots`; screen recordings belong in `public/recordings`.

Replace a still or recording with the same filename, then run:

```bash
npm run inspect:assets
npm run render
npm run verify
```

The current build uses real YAML editor, BMI calculation, CDASH search/write-back, eCRF renderer, and Playwright review screenshots. These requested source assets remain unavailable and are reported in `out/assets-report.json`:

- `screenshots/github-pr.png`
- `screenshots/deployment-success.png`
- `recordings/protocol-upload.mp4`
- `recordings/form-editing.mp4`
- `recordings/cdash-mapping.mp4`
- `recordings/ecrf-preview.mp4`
- `recordings/automated-qa.mp4`
- `recordings/github-deployment.mp4`

Missing recordings do not block preview or render. Scenes fall back to available real screenshots, the scene infographic, or a clearly labeled local SVG placeholder. Scene 1 and Scene 8 keep their primary infographics when no operation capture is available.

## Voice generation

Generate or reuse all eight scene MP3 files and the combined narration:

```bash
npm run generate:voice
```

Outputs:

- `public/audio/generated/scene-01.mp3` through `scene-08.mp3`
- `public/audio/narration-en.mp3`
- `out/voice-manifest.json`

The script hashes narration, voice, rate, and provider settings. Unchanged narration reuses existing audio. Windows uses `scripts/windows-tts.ps1`; Linux and WSL use `espeak-ng` when installed. If neither engine exists, the pipeline creates audible preview placeholders and reports the missing speech engine.

Pronunciation transforms are applied only to the spoken input. Captions retain the official spellings for Codex, GPT-5.6, eCRF, CDISC, CDASH, YAML, JSON, pytest, Playwright, GitHub, CI/CD, Orchestrator Skill, and Protocol.

## Subtitle generation

```bash
npm run generate:subtitles
```

The generator reads actual scene MP3 durations, aligns English and Taiwan Traditional Chinese cues to identical time codes, keeps at least 50 milliseconds between cues, wraps English at approximately 42 characters per line, wraps Chinese at approximately 20 characters per line, and writes UTF-8 files to both `public/subtitles` and `out`.

Outputs:

- `public/subtitles/subtitles-en.srt`
- `public/subtitles/subtitles-zh-TW.srt`
- `src/data/captions.json`
- `out/subtitles-en.srt`
- `out/subtitles-zh-TW.srt`

## Remotion preview

```bash
npm run dev
```

The Studio exposes:

- `ClinicalFormStudioWithCaptions`
- `ClinicalFormStudioNoCaptions`

The final burned-caption video is produced from the generated English SRT with FFmpeg. The Remotion caption composition remains useful for layout previews.

## Three-minute duration enforcement

```bash
npm run check:duration
npm run check:duration -- --final
```

The first command probes every scene MP3, updates `actualDurationSeconds` and `durationInFrames`, regenerates synchronized subtitles, and writes `out/duration-report.json`. The `--final` form also probes the rendered MP4.

The build fails when:

```text
duration > 179.000 seconds
or duration >= 180.000 seconds
```

The verified result is 174.500 seconds, leaving 4.500 seconds before the enforced 179-second limit.

## Final render

Run the complete production pipeline:

```bash
npm run build:video
```

Individual stages:

```bash
npm run prepare
npm run render
npm run verify
```

If a valid Remotion raw master already exists and only FFmpeg color range, audio, captions, or contact-sheet outputs need rebuilding:

```bash
npx tsx scripts/render-video.ts --finalize-only
```

The finalization pass forces limited-range `yuv420p`, 48 kHz AAC, H.264, 30 FPS, and `+faststart`. If `public/audio/background.mp3` exists, it is looped below narration with fade-in/out; otherwise the video renders without music.

## Outputs

- `out/clinical-form-studio-demo.mp4` — English subtitles burned in.
- `out/clinical-form-studio-demo-no-captions.mp4` — YouTube master without burned subtitles.
- `out/subtitles-en.srt`
- `out/subtitles-zh-TW.srt`
- `out/assets-report.json`
- `out/duration-report.json`
- `out/render-report.json`
- `out/verification-report.json`
- `out/contact-sheet.png`
- `out/frames/frame-01.png` through `frame-24.png`

The raw Remotion master is retained as `out/clinical-form-studio-demo.raw.mp4` so FFmpeg-only refinements do not require another full Remotion render.

## Verification

```bash
npm run verify
```

Verification checks both MP4 variants for existence, non-zero size, 1920×1080 resolution, 30 FPS, H.264, `yuv420p`, AAC, 48 kHz audio, audible mean volume, duration below 180 seconds, and full decode success. It also checks all eight scenes, both subtitle files, cue gaps, the final subtitle end time, 24 scene verification frames, and the contact sheet.

Open `out/contact-sheet.png` to visually review each Scene's first, middle, and final frame for broken assets, blank frames, text clipping, subtitle obstruction, excessive zoom, blur, and transition problems.

## YouTube subtitles

Upload `out/clinical-form-studio-demo-no-captions.mp4`, then add:

- `out/subtitles-en.srt` as English.
- `out/subtitles-zh-TW.srt` as Chinese (Traditional), Taiwan.

Use `out/clinical-form-studio-demo.mp4` when a single self-contained judging file with English captions is preferred.

## Platform notes

### Windows

- Use PowerShell or the Codex terminal.
- Confirm the configured SAPI voice exists before changing `LOCAL_TTS_VOICE`.
- OneDrive may temporarily lock generated files. The pipeline retains the raw master and does not require deleting it.
- The Remotion CLI is launched through Node directly, avoiding `spawnSync npx.cmd EINVAL` on newer Node versions.

### WSL

- Keep the repository on the Linux filesystem for faster Remotion rendering when possible.
- Install `ffmpeg` and `espeak-ng` inside WSL; Windows SAPI is not available directly.
- Run `npm ci --ignore-scripts`, then `npm run prepare`.

### Linux

- Install Chromium dependencies required by Remotion if the browser download cannot launch.
- Install `espeak-ng` for local narration.
- Ensure FFmpeg includes the `subtitles`/libass filter for the burned-caption build.

## Troubleshooting

- **`spawnSync npx.cmd EINVAL`**: the provided render script already bypasses `.cmd` and invokes the local Remotion CLI with Node.
- **`yuvj420p` instead of `yuv420p`**: run `npx tsx scripts/render-video.ts --finalize-only`; it converts full-range frames to limited-range `yuv420p`.
- **No spoken narration on Linux**: install `espeak-ng`, then rerun `npm run generate:voice` after changing a narration or local voice setting.
- **Missing asset warning**: inspect `out/assets-report.json`; add the exact requested filename and rerun `npm run inspect:assets`.
- **Duration exceeds 179 seconds**: shorten repeated narration while retaining the required GPT-5.6, Codex, Plugin, Orchestrator Skill, and human approval messages, then regenerate voice and subtitles.
- **Subtitle filter unavailable**: use an FFmpeg build compiled with libass.
- **Slow render**: use `--finalize-only` for FFmpeg-only corrections. A full Remotion render is required after React, timing, or scene asset changes.
