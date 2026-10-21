import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Rendered Academy videos (scripts/video/render.mts). The metadata file is written by the renderer;
// the media files live in apps/api/media/academy-videos and are served only through the API, behind
// the same sign-in and review-status gate as the lesson they belong to. A video is listed only when
// its file actually exists, so a lesson never points at a missing asset.

const HERE = dirname(fileURLToPath(import.meta.url));
export const VIDEO_MEDIA_DIR = resolve(HERE, '..', '..', '..', 'media', 'academy-videos');
const META_FILE = join(HERE, 'videos.generated.json');

export interface VideoMeta {
  id: string;
  course_id: string;
  lesson_id: string;
  title: string;
  objective: string;
  duration_s: number;
  width: number;
  height: number;
  fps: number;
  codecs: string;
  bytes: number;
  voice: string;
  script_sha: string;
  status: string;
  rendered_at: string;
}

export const VIDEO_FILES = { video: { ext: 'webm', type: 'video/webm' }, poster: { ext: 'png', type: 'image/png' }, captions: { ext: 'vtt', type: 'text/vtt; charset=utf-8' }, transcript: { ext: 'txt', type: 'text/plain; charset=utf-8' } } as const;
export type VideoFile = keyof typeof VIDEO_FILES;

export function loadVideos(metaFile = META_FILE, mediaDir = VIDEO_MEDIA_DIR): VideoMeta[] {
  if (!existsSync(metaFile)) return [];
  const all = JSON.parse(readFileSync(metaFile, 'utf8')) as VideoMeta[];
  return all.filter((v) => {
    const p = join(mediaDir, `${v.id}.webm`);
    return existsSync(p) && statSync(p).size === v.bytes;
  });
}

export function videoPath(v: VideoMeta, file: VideoFile, mediaDir = VIDEO_MEDIA_DIR): string | undefined {
  const p = join(mediaDir, `${v.id}.${VIDEO_FILES[file].ext}`);
  return existsSync(p) ? p : undefined;
}

/** Parses a single-range `bytes=` header against a file size. Returns null for no/unsupported range, 'invalid' when unsatisfiable. */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | null | 'invalid' {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start: number;
  let end: number;
  if (m[1] === '') {
    const suffix = Number(m[2]);
    if (suffix === 0) return 'invalid';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return 'invalid';
  return { start, end };
}
