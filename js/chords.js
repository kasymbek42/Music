/**
 * chords.js
 *
 * Распознавание аккордов из аудио на чистом JS, без серверных библиотек.
 * Подход аналогичен классическому librosa-пайплайну:
 *   1. Считаем chroma-признаки (энергия каждого из 12 полутонов) по кадрам через FFT.
 *   2. Сравниваем каждый кадр с шаблонами аккордов (мажор/минор/септ и т.д.).
 *   3. Сглаживаем во времени (скользящая мода) и склеиваем короткие сегменты.
 *
 * Ограничения (см. README): это не нейросеть, поэтому результат не идеален на
 * сложной гармонии/джазе/сильно искажённых тембрах, но разумен на поп/рок материале.
 */

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** Интервалы аккордов относительно тоники (в полутонах). */
const CHORD_TEMPLATES = {
  "":     [0, 4, 7],
  "m":    [0, 3, 7],
  "7":    [0, 4, 7, 10],
  "maj7": [0, 4, 7, 11],
  "m7":   [0, 3, 7, 10],
  "dim":  [0, 3, 6],
  "aug":  [0, 4, 8],
  "sus2": [0, 2, 7],
  "sus4": [0, 5, 7],
};

const NO_CHORD_LABEL = "N";

/** Строит матрицу шаблонов (массив из {name, vector}) один раз при загрузке модуля. */
function buildChordTemplates() {
  const templates = [];
  for (let rootIdx = 0; rootIdx < 12; rootIdx++) {
    for (const [suffix, intervals] of Object.entries(CHORD_TEMPLATES)) {
      const vec = new Float32Array(12);
      for (const interval of intervals) {
        vec[(rootIdx + interval) % 12] = 1.0;
      }
      templates.push({ name: `${NOTE_NAMES[rootIdx]}${suffix}`, vector: vec });
    }
  }
  return templates;
}

const CHORD_TEMPLATE_LIST = buildChordTemplates();

/**
 * Простое прямое FFT (radix-2). Длина входа должна быть степенью двойки.
 * Возвращает { re, im } той же длины.
 */
function fft(re, im) {
  const n = re.length;
  if (n <= 1) return;
  if (n & (n - 1)) throw new Error("FFT size must be a power of 2");

  // bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let j = 0; j < len / 2; j++) {
        const uRe = re[i + j];
        const uIm = im[i + j];
        const vRe = re[i + j + len / 2] * curRe - im[i + j + len / 2] * curIm;
        const vIm = re[i + j + len / 2] * curIm + im[i + j + len / 2] * curRe;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + len / 2] = uRe - vRe;
        im[i + j + len / 2] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        const nextIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
        curIm = nextIm;
      }
    }
  }
}

/** Частота (Гц) центральной ноты MIDI-номера. */
function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Считает chroma-вектор (12 значений) для одного кадра через бины FFT,
 * сгруппированные по принадлежности к одному из 12 полутонов в широком
 * диапазоне октав (аналог chroma_cqt, но через обычный FFT — проще и быстрее
 * для браузера, ценой немного меньшей точности на низких частотах).
 */
function frameToChroma(magnitudes, sampleRate, fftSize) {
  const chroma = new Float32Array(12);
  const binHz = sampleRate / fftSize;

  // Перебираем ноты от A0 (MIDI 21) до C8 (MIDI 108) — типичный музыкальный диапазон.
  for (let midi = 21; midi <= 108; midi++) {
    const freq = midiToFreq(midi);
    const bin = Math.round(freq / binHz);
    if (bin <= 0 || bin >= magnitudes.length) continue;
    const pitchClass = ((midi % 12) + 12) % 12;
    chroma[pitchClass] += magnitudes[bin];
  }
  return chroma;
}

/** Косинусное сходство между chroma-вектором и каждым шаблоном аккорда. */
function bestChordForChroma(chroma) {
  let norm = 0;
  for (let i = 0; i < 12; i++) norm += chroma[i] * chroma[i];
  norm = Math.sqrt(norm) + 1e-8;

  let bestScore = -Infinity;
  let bestName = NO_CHORD_LABEL;

  for (const tmpl of CHORD_TEMPLATE_LIST) {
    let dot = 0;
    let tmplNorm = 0;
    for (let i = 0; i < 12; i++) {
      dot += chroma[i] * tmpl.vector[i];
      tmplNorm += tmpl.vector[i] * tmpl.vector[i];
    }
    const score = dot / (norm * Math.sqrt(tmplNorm) + 1e-8);
    if (score > bestScore) {
      bestScore = score;
      bestName = tmpl.name;
    }
  }
  return bestName;
}

/**
 * Применяет окно Ханна к фрейму (уменьшает спектральную "утечку" на краях окна).
 */
function applyHannWindow(samples) {
  const n = samples.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    out[i] = samples[i] * w;
  }
  return out;
}

/**
 * Главная функция: принимает моно Float32Array + sampleRate, возвращает массив
 * сегментов аккордов [{chord, startSec, endSec}].
 *
 * @param {Float32Array} samples моно-сигнал (если стерео — заранее усреднить каналы)
 * @param {number} sampleRate
 * @param {object} opts { fftSize, hopSize, smoothingWindow, minDurationSec }
 */
function analyzeChords(samples, sampleRate, opts = {}) {
  const fftSize = opts.fftSize || 4096;
  const hopSize = opts.hopSize || 2048;
  const smoothingWindow = opts.smoothingWindow || 8;
  const minDurationSec = opts.minDurationSec ?? 0.5;

  const nFrames = Math.max(1, Math.floor((samples.length - fftSize) / hopSize) + 1);
  const labels = new Array(nFrames);
  const frameEnergies = new Float32Array(nFrames);

  const reBuf = new Float32Array(fftSize);
  const imBuf = new Float32Array(fftSize);

  for (let f = 0; f < nFrames; f++) {
    const start = f * hopSize;
    const frame = samples.subarray(start, start + fftSize);
    const windowed = applyHannWindow(frame.length === fftSize ? frame : padToLength(frame, fftSize));

    reBuf.set(windowed);
    imBuf.fill(0);
    fft(reBuf, imBuf);

    const half = fftSize / 2;
    const magnitudes = new Float32Array(half);
    let energy = 0;
    for (let i = 0; i < half; i++) {
      const mag = Math.sqrt(reBuf[i] * reBuf[i] + imBuf[i] * imBuf[i]);
      magnitudes[i] = mag;
      energy += mag;
    }
    frameEnergies[f] = energy;

    const chroma = frameToChroma(magnitudes, sampleRate, fftSize);
    labels[f] = chroma; // временно храним chroma, метку определим после порога тишины
  }

  // Порог тишины: кадры с энергией ниже 50% от 10-го перцентиля считаем тишиной.
  const sortedEnergies = Array.from(frameEnergies).sort((a, b) => a - b);
  const p10 = sortedEnergies[Math.floor(sortedEnergies.length * 0.1)] || 0;
  const silenceThreshold = p10 * 0.5;

  const rawLabels = new Array(nFrames);
  for (let f = 0; f < nFrames; f++) {
    if (frameEnergies[f] < silenceThreshold) {
      rawLabels[f] = NO_CHORD_LABEL;
    } else {
      rawLabels[f] = bestChordForChroma(labels[f]);
    }
  }

  const smoothed = smoothLabels(rawLabels, smoothingWindow);
  const frameDurationSec = hopSize / sampleRate;
  let segments = framesToSegments(smoothed, frameDurationSec);
  segments = mergeShortSegments(segments, minDurationSec);

  return segments;
}

function padToLength(arr, length) {
  const out = new Float32Array(length);
  out.set(arr);
  return out;
}

/** Сглаживание скользящей модой (most common label в окне). */
function smoothLabels(labels, window) {
  const n = labels.length;
  const out = new Array(n);
  const half = Math.floor(window / 2);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(n, i + half + 1);
    const counts = new Map();
    for (let j = lo; j < hi; j++) {
      counts.set(labels[j], (counts.get(labels[j]) || 0) + 1);
    }
    let bestLabel = labels[i];
    let bestCount = -1;
    for (const [label, count] of counts) {
      if (count > bestCount) {
        bestCount = count;
        bestLabel = label;
      }
    }
    out[i] = bestLabel;
  }
  return out;
}

/** Превращает массив меток по кадрам в список сегментов с временными границами. */
function framesToSegments(labels, frameDurationSec) {
  const segments = [];
  if (labels.length === 0) return segments;

  let currentLabel = labels[0];
  let currentStart = 0;

  for (let i = 1; i < labels.length; i++) {
    if (labels[i] !== currentLabel) {
      segments.push({
        chord: currentLabel,
        startSec: currentStart * frameDurationSec,
        endSec: i * frameDurationSec,
      });
      currentLabel = labels[i];
      currentStart = i;
    }
  }
  segments.push({
    chord: currentLabel,
    startSec: currentStart * frameDurationSec,
    endSec: labels.length * frameDurationSec,
  });
  return segments;
}

/** Склеивает слишком короткие сегменты с соседями (убирает "дрожание"). */
function mergeShortSegments(segments, minDurationSec) {
  let current = segments.slice();

  for (let pass = 0; pass < 10; pass++) {
    let changed = false;
    const result = [];
    let i = 0;
    while (i < current.length) {
      const seg = current[i];
      const duration = seg.endSec - seg.startSec;
      if (duration < minDurationSec && current.length > 1) {
        changed = true;
        if (i === 0) {
          const next = current[i + 1];
          result.push({ chord: next.chord, startSec: seg.startSec, endSec: next.endSec });
          i += 2;
        } else {
          const prev = result.pop();
          result.push({ chord: prev.chord, startSec: prev.startSec, endSec: seg.endSec });
          i += 1;
        }
      } else {
        result.push(seg);
        i += 1;
      }
    }
    current = result;
    if (!changed) break;
  }

  // Убираем подряд идущие одинаковые аккорды после склейки
  const deduped = [];
  for (const seg of current) {
    if (deduped.length > 0 && deduped[deduped.length - 1].chord === seg.chord) {
      deduped[deduped.length - 1].endSec = seg.endSec;
    } else {
      deduped.push({ ...seg });
    }
  }
  return deduped;
}

/** Усредняет стерео в моно (простое среднее каналов). */
function stereoToMono(left, right) {
  const out = new Float32Array(left.length);
  for (let i = 0; i < left.length; i++) {
    out[i] = (left[i] + right[i]) / 2;
  }
  return out;
}

window.ChordAnalyzer = {
  analyzeChords,
  stereoToMono,
  NO_CHORD_LABEL,
};
