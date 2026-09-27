/* Пользовательская музыка: папка `music/` рядом с проектом сервера.
 * Все треки отсюда играют у КАЖДОГО подключённого игрока — клиенты получают их
 * с этого же сервера по /custom-music/*. Работает и в `vite dev`, и в preview. */
import fs from 'fs';
import path from 'path';
import type { Plugin } from 'vite';

const MUSIC_DIR = path.resolve(__dirname, 'music');
const AUDIO_EXT: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
};

interface ReqLike {
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
}

function sendJson(res: { statusCode: number; setHeader(k: string, v: string): unknown; end(b: string): unknown }, code: number, body: string) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(body);
}

function handle(req: ReqLike, res: { statusCode: number; setHeader(k: string, v: string): unknown; end(b?: string): unknown }, next: () => void): void {
  const url = (req.url ?? '').split('?')[0];
  if (!url.startsWith('/custom-music')) return next();
  try {
    // манифест: список треков папки
    if (url === '/custom-music' || url === '/custom-music/' || url === '/custom-music/index.json') {
      let files: string[] = [];
      if (fs.existsSync(MUSIC_DIR)) {
        files = fs
          .readdirSync(MUSIC_DIR)
          .filter((f) => AUDIO_EXT[path.extname(f).toLowerCase()])
          .sort((a, b) => a.localeCompare(b, 'ru'));
      }
      sendJson(res, 200, JSON.stringify(files.map((f) => ({ name: f, url: '/custom-music/' + encodeURIComponent(f) }))));
      return;
    }
    // отдача файла (с Range — аудио элемент запрашивает кусками)
    const name = decodeURIComponent(url.slice('/custom-music/'.length));
    const full = path.resolve(MUSIC_DIR, name);
    if (!full.startsWith(MUSIC_DIR + path.sep) || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
      res.statusCode = 404;
      res.end();
      return;
    }
    const ext = path.extname(full).toLowerCase();
    const size = fs.statSync(full).size;
    res.setHeader('Content-Type', AUDIO_EXT[ext] ?? 'application/octet-stream');
    res.setHeader('Accept-Ranges', 'bytes');
    const range = req.headers?.range;
    const m = range ? /bytes=(\d*)-(\d*)/.exec(String(range)) : null;
    if (m && (m[1] !== '' || m[2] !== '')) {
      let start = m[1] !== '' ? parseInt(m[1], 10) : size - parseInt(m[2], 10);
      let end = m[2] !== '' ? parseInt(m[2], 10) : size - 1;
      if (m[1] === '') end = size - 1;
      if (Number.isNaN(start) || Number.isNaN(end) || start >= size || start > end) {
        res.statusCode = 416;
        res.setHeader('Content-Range', `bytes */${size}`);
        res.end();
        return;
      }
      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      res.setHeader('Content-Length', String(end - start + 1));
      fs.createReadStream(full, { start, end }).pipe(res as unknown as NodeJS.WritableStream);
      return;
    }
    res.setHeader('Content-Length', String(size));
    fs.createReadStream(full).pipe(res as unknown as NodeJS.WritableStream);
  } catch {
    try {
      res.statusCode = 500;
      res.end();
    } catch {
      /* соединение уже закрыто */
    }
  }
}

export function customMusicPlugin(): Plugin {
  return {
    name: 'mathart-custom-music',
    configureServer(s) {
      s.middlewares.use(handle);
    },
    configurePreviewServer(s) {
      s.middlewares.use(handle);
    },
  };
}
