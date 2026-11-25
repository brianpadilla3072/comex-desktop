#!/usr/bin/env node
/**
 * Analiza un WAV y devuelve una boca por cuadro, para lipsync.
 *
 *   node hf_lipsync.mjs --wav <archivo.wav> [--fps 30] [--out <archivo.json>]
 *
 * Salida: { fps, duration, frames: [0|1|2|3, ...] }
 *   0 = cerrada, 1 = media, 2 = abierta, 3 = ancha
 *
 * No usa IA ni servicios: mide el volumen (RMS) por cuadro, lo normaliza
 * contra el percentil 95 y lo mapea a cuatro formas. Un filtro de mediana
 * evita que el ruido haga parpadear la boca.
 */
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};

const wavPath = arg("wav");
const fps = Number(arg("fps", "30"));
if (!wavPath) {
  console.log("uso: node hf_lipsync.mjs --wav <archivo.wav> [--fps 30] [--out salida.json]");
  process.exit(2);
}
if (!(fps > 0)) {
  console.error("fps inválido");
  process.exit(2);
}

const file = path.resolve(wavPath);
if (!fs.existsSync(file)) {
  console.error(`no existe ${file}`);
  process.exit(2);
}

// ------------------------------------------------------------------ WAV ---
const buf = fs.readFileSync(file);
if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
  console.error("no es un WAV RIFF");
  process.exit(2);
}

let format = null;
let data = null;
let offset = 12;
while (offset + 8 <= buf.length) {
  const id = buf.toString("ascii", offset, offset + 4);
  const size = buf.readUInt32LE(offset + 4);
  const body = offset + 8;
  if (id === "fmt ") {
    format = {
      audioFormat: buf.readUInt16LE(body),
      channels: buf.readUInt16LE(body + 2),
      sampleRate: buf.readUInt32LE(body + 4),
      bitsPerSample: buf.readUInt16LE(body + 14),
    };
  } else if (id === "data") {
    data = { start: body, size: Math.min(size, buf.length - body) };
  }
  offset = body + size + (size % 2);
}

if (!format || !data) {
  console.error("WAV sin bloque fmt o data");
  process.exit(2);
}

const { audioFormat, channels, sampleRate, bitsPerSample } = format;
const bytesPerSample = bitsPerSample / 8;
const frameBytes = bytesPerSample * channels;
const totalFrames = Math.floor(data.size / frameBytes);
const duration = totalFrames / sampleRate;

const readSample = (index) => {
  const pos = data.start + index * frameBytes;
  let sum = 0;
  for (let c = 0; c < channels; c++) {
    const p = pos + c * bytesPerSample;
    if (audioFormat === 3 && bitsPerSample === 32) sum += buf.readFloatLE(p);
    else if (bitsPerSample === 16) sum += buf.readInt16LE(p) / 32768;
    else if (bitsPerSample === 32) sum += buf.readInt32LE(p) / 2147483648;
    else if (bitsPerSample === 8) sum += (buf.readUInt8(p) - 128) / 128;
    else return 0;
  }
  return sum / channels;
};

// ---------------------------------------------------------------- análisis --
const windowSamples = Math.max(1, Math.round(sampleRate / fps));
const frameCount = Math.max(1, Math.ceil(totalFrames / windowSamples));
const rms = new Float64Array(frameCount);

for (let f = 0; f < frameCount; f++) {
  const start = f * windowSamples;
  const end = Math.min(totalFrames, start + windowSamples);
  let acc = 0;
  for (let i = start; i < end; i++) {
    const s = readSample(i);
    acc += s * s;
  }
  rms[f] = Math.sqrt(acc / Math.max(1, end - start));
}

// percentil 95 como referencia de "voz fuerte"
const sorted = Array.from(rms).sort((a, b) => a - b);
const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] || 1;
const floor = p95 * 0.02;

const classify = (value) => {
  const r = Math.max(0, (value - floor) / Math.max(1e-9, p95 - floor));
  if (r < 0.08) return 0;
  if (r < 0.22) return 1;
  if (r < 0.5) return 2;
  return 3;
};

const raw = Array.from(rms, classify);

// mediana móvil de 3 para quitar parpadeos de un cuadro
const frames = raw.map((value, i) => {
  const a = raw[Math.max(0, i - 1)];
  const b = value;
  const c = raw[Math.min(raw.length - 1, i + 1)];
  return [a, b, c].sort((x, y) => x - y)[1];
});

const result = {
  fps,
  duration: Number(duration.toFixed(3)),
  frames,
  stats: {
    sampleRate,
    channels,
    bitsPerSample,
    audioFormat,
    frameCount,
    p95: Number(p95.toFixed(4)),
    silentFrames: frames.filter((f) => f === 0).length,
  },
};

const out = arg("out");
if (out) {
  const target = path.resolve(out);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(result)}\n`, "utf8");
  console.log(
    JSON.stringify(
      {
        ok: true,
        out: target,
        fps,
        duration: result.duration,
        frames: frames.length,
        silent: result.stats.silentFrames,
      },
      null,
      2
    )
  );
} else {
  console.log(JSON.stringify(result));
}
