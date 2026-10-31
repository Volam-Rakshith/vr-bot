// VR Bot — chat commands: !help !weather !sticker !pdf !yt (+ group tools live in groups.js). © VR DEVELOPMENTS
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const WMO = { 0: 'Clear sky ☀️', 1: 'Mainly clear 🌤️', 2: 'Partly cloudy ⛅', 3: 'Overcast ☁️', 45: 'Fog 🌫️', 48: 'Fog 🌫️', 51: 'Light drizzle 🌦️', 53: 'Drizzle 🌦️', 55: 'Heavy drizzle 🌧️', 61: 'Light rain 🌦️', 63: 'Rain 🌧️', 65: 'Heavy rain 🌧️', 71: 'Light snow 🌨️', 73: 'Snow 🌨️', 75: 'Heavy snow ❄️', 80: 'Rain showers 🌦️', 81: 'Rain showers 🌧️', 82: 'Violent showers ⛈️', 95: 'Thunderstorm ⛈️', 96: 'Thunderstorm + hail ⛈️', 99: 'Thunderstorm + hail ⛈️' };

/** !weather <city> — Open-Meteo, free, no API key. */
export async function weather(city) {
  const q = (city || 'Hyderabad').trim();
  const g = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=en&format=json`, { signal: AbortSignal.timeout(15000) })).json();
  const p = g.results?.[0];
  if (!p) return `Couldn't find "${q}" 🤔 Try: !weather Hyderabad`;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${p.latitude}&longitude=${p.longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=1`;
  const w = await (await fetch(url, { signal: AbortSignal.timeout(15000) })).json();
  const c = w.current, d = w.daily;
  return [
    `🌍 *${p.name}${p.admin1 ? ', ' + p.admin1 : ''}*`,
    `${WMO[c.weather_code] || 'Weather'} · ${Math.round(c.temperature_2m)}°C (feels ${Math.round(c.apparent_temperature)}°C)`,
    `💧 Humidity ${c.relative_humidity_2m}% · 💨 Wind ${Math.round(c.wind_speed_10m)} km/h`,
    `📅 Today ${Math.round(d.temperature_2m_min[0])}°–${Math.round(d.temperature_2m_max[0])}°C · ☔ Rain chance ${d.precipitation_probability_max[0] ?? 0}%`,
  ].join('\n');
}

export function hasBin(bin) { return spawnSync('which', [bin]).status === 0; }

/** Image (or short video, if ffmpeg exists) → 512×512 WebP sticker. */
export async function toSticker(buffer, isVideo = false) {
  if (isVideo) {
    if (!hasBin('ffmpeg')) throw new Error('Video stickers need ffmpeg (not available on this runner)');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stk-'));
    const inp = path.join(dir, 'in.mp4'), out = path.join(dir, 'out.webp');
    fs.writeFileSync(inp, buffer);
    const r = spawnSync('ffmpeg', ['-y', '-i', inp, '-t', '6', '-vf', 'fps=12,scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:-1:-1:color=0x00000000', '-loop', '0', '-an', '-vcodec', 'libwebp', '-q:v', '50', out], { timeout: 60000 });
    if (r.status !== 0) throw new Error('ffmpeg could not convert the video');
    return fs.readFileSync(out);
  }
  const sharp = (await import('sharp')).default;
  return sharp(buffer).resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 80 }).toBuffer();
}

/** Images → one PDF. */
export async function imagesToPdf(buffers) {
  const { PDFDocument } = await import('pdf-lib');
  const sharp = (await import('sharp')).default;
  const pdf = await PDFDocument.create();
  for (const b of buffers) {
    const jpg = await sharp(b).rotate().jpeg({ quality: 85 }).toBuffer();
    const img = await pdf.embedJpg(jpg);
    const page = pdf.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  }
  pdf.setProducer('VR Bot by VR DEVELOPMENTS');
  return Buffer.from(await pdf.save());
}

/**
 * !yt <url> — audio download with yt-dlp. EXPERIMENTAL: YouTube often blocks cloud servers
 * (GitHub runners) with "Sign in to confirm you're not a bot". Off by default.
 */
export async function ytAudio(url, maxMB = 15) {
  if (!/^https?:\/\/(www\.|m\.)?(youtube\.com|youtu\.be|music\.youtube\.com)\//i.test(url || '')) throw new Error('Send a YouTube link: !yt https://youtu.be/…');
  if (!hasBin('yt-dlp')) {
    const r = spawnSync('python3', ['-m', 'pip', 'install', '--user', '-q', 'yt-dlp'], { timeout: 120000 });
    if (r.status !== 0) throw new Error('could not install yt-dlp');
    process.env.PATH = `${os.homedir()}/.local/bin:${process.env.PATH}`;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-'));
  const r = spawnSync('yt-dlp', ['-f', 'bestaudio[ext=m4a]/bestaudio', '--max-filesize', `${maxMB}M`, '--no-playlist', '-o', path.join(dir, 'a.%(ext)s'), '--print', 'after_move:title', url], { timeout: 180000 });
  const files = fs.readdirSync(dir);
  if (r.status !== 0 || !files.length) throw new Error(/confirm you.re not a bot|Sign in/i.test(r.stderr?.toString() || '') ? 'YouTube blocked the GitHub server ("confirm you\'re not a bot"). This is a YouTube limit, not your setup.' : 'download failed or file too big');
  const file = path.join(dir, files[0]);
  return { buffer: fs.readFileSync(file), title: (r.stdout?.toString() || 'audio').trim().split('\n').pop(), mimetype: files[0].endsWith('.m4a') ? 'audio/mp4' : 'audio/webm' };
}

export function helpText(s, isOwner) {
  const p = s.commands?.prefix || '!';
  const en = s.commands?.enabled || {};
  const lines = [`🤖 *${s.botName || 'VR Bot'}* — commands`, '_Replies come on the next check (within ~30 min), not instantly._', ''];
  if (en.weather) lines.push(`${p}weather <city> — today's weather`);
  if (en.sticker) lines.push(`${p}sticker — send/reply to an image with this`);
  if (en.pdf) lines.push(`${p}pdf — send images with caption ${p}pdf → one PDF`);
  if (en.yt) lines.push(`${p}yt <link> — YouTube audio (experimental)`);
  if (en.tagall) lines.push(`${p}tagall <msg> — mention everyone (group admins)`);
  if (en.rules) lines.push(`${p}rules — group rules`);
  lines.push(`${p}help — this list`);
  if (isOwner) lines.push('', '*Owner:*', `${p}away <msg> · ${p}back · ${p}status · ${p}pause · ${p}resume · ${p}text (reply to a voice note)`, `${p}busy 2h · ${p}busy until 5pm · ${p}busy off`, `${p}class 2h · ${p}class till 4 · ${p}class (1h) · ${p}free (ends busy/class)`, `${p}voice save <name> (reply to a voice note) · ${p}voice list · ${p}voice play <name> · ${p}voice delete <name>`, `${p}note <text> (or reply ${p}note to any message) · ${p}notes · ${p}notes <word> · ${p}note delete <n>`);
  lines.push('', '— VR Bot by VR DEVELOPMENTS');
  return lines.join('\n');
}
