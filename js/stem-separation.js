/**
 * stem-separation.js
 *
 * Разделение трека на 4 стема (vocals, drums, bass, other) полностью в браузере
 * через onnxruntime-web и однофайловую ONNX-модель HTDemucs
 * (StemSplitio/htdemucs-onnx, MIT license, https://huggingface.co/StemSplitio/htdemucs-onnx).
 *
 * Модель ожидает на входе фиксированный сегмент [1, 2, SEGMENT_LENGTH] (стерео,
 * 44.1кГц), поэтому для треков произвольной длины делаем overlap-add чанкинг:
 * нарезаем на сегменты с перекрытием, прогоняем каждый через модель и
 * сшиваем результат с кросс-фейдом на стыках, чтобы не было щелчков.
 *
 * Модель скачивается с Hugging Face при первом использовании и кэшируется
 * в Cache Storage API браузера — повторные запуски не требуют повторной загрузки.
 */

const MODEL_URL = "https://huggingface.co/StemSplitio/htdemucs-onnx/resolve/main/htdemucs.onnx";
const MODEL_CACHE_NAME = "htdemucs-onnx-model-v1";
const SEGMENT_LENGTH = 343980; // сэмплов на сегмент, согласно карточке модели
const OVERLAP_LENGTH = 8192;   // перекрытие между сегментами для кросс-фейда (борьба со швами)
const STEM_NAMES = ["drums", "bass", "other", "vocals"]; // порядок согласно карточке модели

let _session = null;
let _ort = null;

/**
 * Загружает onnxruntime-web (один раз) и возвращает модуль ort.
 */
async function ensureOrtLoaded() {
  if (_ort) return _ort;
  if (!window.ort) {
    throw new Error(
      "onnxruntime-web не загружен. Убедитесь, что скрипт ort.min.js подключён в index.html."
    );
  }
  _ort = window.ort;
  return _ort;
}

/**
 * Скачивает веса модели с прогрессом, используя Cache Storage API для кэширования
 * между визитами (модель не перекачивается повторно после первого раза).
 * @param {(loaded: number, total: number) => void} onProgress
 */
async function fetchModelWithCache(onProgress) {
  const cache = await caches.open(MODEL_CACHE_NAME);
  const cached = await cache.match(MODEL_URL);
  if (cached) {
    const buf = await cached.arrayBuffer();
    if (onProgress) onProgress(buf.byteLength, buf.byteLength);
    return buf;
  }

  const response = await fetch(MODEL_URL);
  if (!response.ok) {
    throw new Error(`Не удалось скачать модель (HTTP ${response.status}). Проверьте подключение к интернету.`);
  }

  const total = Number(response.headers.get("content-length")) || 0;
  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    if (onProgress) onProgress(loaded, total);
  }

  const fullBuffer = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    fullBuffer.set(chunk, offset);
    offset += chunk.length;
  }

  // Кэшируем для следующего визита
  try {
    await cache.put(MODEL_URL, new Response(fullBuffer.buffer.slice(0), {
      headers: { "Content-Type": "application/octet-stream" },
    }));
  } catch (e) {
    console.warn("Не удалось закэшировать модель (возможно, не хватает места в браузере):", e);
  }

  return fullBuffer.buffer;
}

/**
 * Создаёт (или возвращает закэшированную) ONNX-сессию инференса.
 * @param {(stage: string, info?: object) => void} onProgress
 */
async function getSession(onProgress) {
  if (_session) return _session;

  const ort = await ensureOrtLoaded();

  if (onProgress) onProgress("downloading-model");
  const modelBuffer = await fetchModelWithCache((loaded, total) => {
    if (onProgress) onProgress("downloading-model", { loaded, total });
  });

  if (onProgress) onProgress("initializing-model");
  _session = await ort.InferenceSession.create(modelBuffer, {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  });

  return _session;
}

/**
 * Прогоняет один сегмент фиксированной длины через модель.
 * @param {Float32Array} left
 * @param {Float32Array} right
 * @returns {Promise<{drums: Float32Array[2], bass: Float32Array[2], other: Float32Array[2], vocals: Float32Array[2]}>}
 */
async function runSegment(session, left, right) {
  const ort = await ensureOrtLoaded();

  // Тензор формы [1, 2, SEGMENT_LENGTH]
  const interleaved = new Float32Array(2 * SEGMENT_LENGTH);
  interleaved.set(left, 0);
  interleaved.set(right, SEGMENT_LENGTH);

  const inputTensor = new ort.Tensor("float32", interleaved, [1, 2, SEGMENT_LENGTH]);
  const feeds = {};
  // Имя входного узла согласно карточке модели — "mix"
  feeds["mix"] = inputTensor;

  const results = await session.run(feeds);
  const outputName = Object.keys(results)[0];
  const outputData = results[outputName].data; // ожидается [1, 4, 2, SEGMENT_LENGTH]

  const stemLength = SEGMENT_LENGTH;
  const stems = {};
  STEM_NAMES.forEach((name, stemIdx) => {
    const offset = stemIdx * 2 * stemLength;
    const stemLeft = outputData.slice(offset, offset + stemLength);
    const stemRight = outputData.slice(offset + stemLength, offset + 2 * stemLength);
    stems[name] = [stemLeft, stemRight];
  });

  return stems;
}

/** Создаёт линейную кросс-фейд маску длины n (0 -> 1). */
function linearRamp(n, ascending) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = ascending ? i / (n - 1) : 1 - i / (n - 1);
  }
  return out;
}

/**
 * Полный пайплайн разделения: нарезает трек на сегменты с перекрытием,
 * прогоняет каждый через модель, сшивает результат с кросс-фейдом.
 *
 * @param {Float32Array} left
 * @param {Float32Array} right
 * @param {number} sampleRate ожидается 44100
 * @param {(info: object) => void} onProgress вызывается с {stage, current, total, loaded, totalBytes}
 * @returns {Promise<{[stemName: string]: {left: Float32Array, right: Float32Array}}>}
 */
async function separateStems(left, right, sampleRate, onProgress) {
  if (sampleRate !== 44100) {
    throw new Error("Модель ожидает аудио на 44100 Гц. Передайте ресемплированный сигнал.");
  }

  const session = await getSession((stage, info) => {
    if (onProgress) onProgress({ stage, ...info });
  });

  const totalLength = left.length;
  const step = SEGMENT_LENGTH - OVERLAP_LENGTH;
  const nSegments = Math.max(1, Math.ceil((totalLength - OVERLAP_LENGTH) / step));

  // Аккумуляторы результата для каждого стема
  const accumulators = {};
  const weightSum = new Float32Array(totalLength);
  STEM_NAMES.forEach((name) => {
    accumulators[name] = {
      left: new Float32Array(totalLength),
      right: new Float32Array(totalLength),
    };
  });

  const fadeIn = linearRamp(OVERLAP_LENGTH, true);
  const fadeOut = linearRamp(OVERLAP_LENGTH, false);

  for (let segIdx = 0; segIdx < nSegments; segIdx++) {
    const start = segIdx * step;
    const end = Math.min(start + SEGMENT_LENGTH, totalLength);

    // Готовим входной сегмент (с нулями в конце, если это последний неполный сегмент)
    const segLeft = new Float32Array(SEGMENT_LENGTH);
    const segRight = new Float32Array(SEGMENT_LENGTH);
    segLeft.set(left.subarray(start, end));
    segRight.set(right.subarray(start, end));

    if (onProgress) {
      onProgress({ stage: "separating", current: segIdx + 1, total: nSegments });
    }

    const stemsResult = await runSegment(session, segLeft, segRight);

    // Веса для кросс-фейда в этом сегменте (по умолчанию 1, спад на краях перекрытия)
    const segWeights = new Float32Array(SEGMENT_LENGTH).fill(1);
    if (segIdx > 0) {
      segWeights.set(fadeIn, 0);
    }
    if (segIdx < nSegments - 1) {
      segWeights.set(fadeOut, SEGMENT_LENGTH - OVERLAP_LENGTH);
    }

    const actualLength = end - start;
    for (let i = 0; i < actualLength; i++) {
      const w = segWeights[i];
      weightSum[start + i] += w;
      STEM_NAMES.forEach((name) => {
        accumulators[name].left[start + i] += stemsResult[name][0][i] * w;
        accumulators[name].right[start + i] += stemsResult[name][1][i] * w;
      });
    }
  }

  // Нормализация по сумме весов (на стыках перекрытий сумма весов может быть != 1)
  for (let i = 0; i < totalLength; i++) {
    const w = weightSum[i] || 1;
    STEM_NAMES.forEach((name) => {
      accumulators[name].left[i] /= w;
      accumulators[name].right[i] /= w;
    });
  }

  if (onProgress) onProgress({ stage: "done" });

  return accumulators;
}

/**
 * Кодирует Float32Array стерео в WAV Blob (16-bit PCM), чтобы пользователь
 * мог скачать/прослушать стем как обычный аудиофайл.
 */
function encodeWav(left, right, sampleRate) {
  const numChannels = 2;
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataLength = left.length * blockAlign;

  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  function writeString(offset, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, "data");
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < left.length; i++) {
    const l = Math.max(-1, Math.min(1, left[i]));
    const r = Math.max(-1, Math.min(1, right[i]));
    view.setInt16(offset, l < 0 ? l * 0x8000 : l * 0x7fff, true);
    offset += 2;
    view.setInt16(offset, r < 0 ? r * 0x8000 : r * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

window.StemSeparation = {
  separateStems,
  encodeWav,
  STEM_NAMES,
  MODEL_URL,
  SEGMENT_LENGTH,
};
