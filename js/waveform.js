/**
 * waveform.js
 *
 * Рисует упрощённую форму волны (min/max по блокам сэмплов) на canvas.
 * Используется для визуализации исходного трека и отдельных стемов.
 */

/**
 * Вычисляет массив пар [min, max] по блокам сэмплов — для быстрого рисования
 * waveform без отрисовки каждого отдельного сэмпла.
 */
function computePeaks(samples, numBuckets) {
  const bucketSize = Math.max(1, Math.floor(samples.length / numBuckets));
  const peaks = new Float32Array(numBuckets * 2);

  for (let i = 0; i < numBuckets; i++) {
    const start = i * bucketSize;
    const end = Math.min(samples.length, start + bucketSize);
    let min = 0;
    let max = 0;
    for (let j = start; j < end; j++) {
      const v = samples[j];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    peaks[i * 2] = min;
    peaks[i * 2 + 1] = max;
  }
  return peaks;
}

/**
 * Рисует waveform на canvas-элементе.
 * @param {HTMLCanvasElement} canvas
 * @param {Float32Array} samples моно-сигнал
 * @param {object} opts { color, backgroundColor }
 */
function drawWaveform(canvas, samples, opts = {}) {
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;

  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.scale(dpr, dpr);

  const color = opts.color || "#d98b3f";
  const backgroundColor = opts.backgroundColor || "transparent";

  ctx.clearRect(0, 0, width, height);
  if (backgroundColor !== "transparent") {
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, width, height);
  }

  const peaks = computePeaks(samples, width);
  const midY = height / 2;

  ctx.fillStyle = color;
  for (let i = 0; i < width; i++) {
    const min = peaks[i * 2];
    const max = peaks[i * 2 + 1];
    const yMin = midY - max * midY;
    const yMax = midY - min * midY;
    ctx.fillRect(i, yMin, 1, Math.max(1, yMax - yMin));
  }
}

window.Waveform = {
  computePeaks,
  drawWaveform,
};
