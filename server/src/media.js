import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
export const MEDIA_DIR = join(process.cwd(), 'data', 'media');
export const MAX_BYTES = 64 * 1024 * 1024;
mkdirSync(MEDIA_DIR, { recursive: true });

export const MEDIA_TYPES = ['image', 'audio', 'video', 'document', 'sticker'];
export const TYPE_LABEL = { image: 'Foto', audio: 'Áudio', video: 'Vídeo', document: 'Documento', sticker: 'Figurinha' };
export const TYPE_RECEIVED = { image: 'recebida', audio: 'recebido', video: 'recebido', document: 'recebido', sticker: 'recebida' };

const EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/amr': 'amr',
  'video/mp4': 'mp4', 'video/3gpp': '3gp', 'application/pdf': 'pdf',
};
// Só estes tipos abrem direto na tela; o resto sempre vira download (evita rodar conteúdo enviado por terceiros).
const INLINE = {
  image: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  sticker: ['image/webp'],
  audio: ['audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/amr', 'audio/webm'],
  video: ['video/mp4', 'video/3gpp', 'video/webm'],
};
export const baseMime = (m) => String(m || '').split(';')[0].trim().toLowerCase();
export const canInline = (type, mime) => (INLINE[type] || []).includes(baseMime(mime));

let ffmpegOk = null;
async function hasFfmpeg() {
  if (ffmpegOk === null) {
    try {
      await run('ffmpeg', ['-version'], { timeout: 5000 });
      ffmpegOk = true;
    } catch {
      ffmpegOk = false;
    }
  }
  return ffmpegOk;
}

// Áudio do WhatsApp vem em OGG/Opus, que alguns navegadores (Safari/iPhone) não tocam.
// Converte para MP3, que toca em qualquer aparelho. Se não der, guarda o original.
async function toMp3(inputPath, outputPath) {
  if (!(await hasFfmpeg())) return false;
  try {
    await run('ffmpeg', ['-y', '-v', 'error', '-i', inputPath, '-vn', '-c:a', 'libmp3lame', '-q:a', '4', outputPath], { timeout: 60000 });
    return true;
  } catch {
    rmSync(outputPath, { force: true });
    return false;
  }
}

// Guarda o arquivo com nome aleatório (nunca o nome enviado pelo remetente).
export async function saveMedia(buffer, mimeIn, type) {
  let mime = baseMime(mimeIn) || 'application/octet-stream';
  const id = randomUUID();
  let file = `${id}.${EXT[mime] || 'bin'}`;
  const path = join(MEDIA_DIR, file);
  writeFileSync(path, buffer);
  if (type === 'audio' && mime !== 'audio/mpeg') {
    const mp3 = `${id}.mp3`;
    if (await toMp3(path, join(MEDIA_DIR, mp3))) {
      rmSync(path, { force: true });
      file = mp3;
      mime = 'audio/mpeg';
    }
  }
  return { file, mime };
}

export const safeName = (n) => String(n || 'arquivo').replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 100) || 'arquivo';

export const discardMedia = (file) => rmSync(join(MEDIA_DIR, file), { force: true });
