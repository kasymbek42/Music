/**
 * audio-loader.js
 *
 * Чтение аудиофайла (mp3/wav/m4a/flac/ogg), выбранного пользователем,
 * в AudioBuffer через Web Audio API. Всё происходит локально в браузере —
 * файл никуда не отправляется.
 */

/** Глобальный AudioContext, создаём один раз и переиспользуем. */
let _audioContext = null;

function getAudioContext() {
  if (!_audioContext) {
    _audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  return _audioContext;
}

/**
 * Декодирует File/Blob в AudioBuffer.
 * @param {File} file
 * @returns {Promise<AudioBuffer>}
 */
async function decodeAudioFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  const ctx = getAudioContext();
  // decodeAudioData мутирует/потребляет ArrayBuffer в некоторых браузерах,
  // поэтому не переиспользуем arrayBuffer после этого вызова.
  return await ctx.decodeAudioData(arrayBuffer);
}

/**
 * Приводит AudioBuffer к стерео (2 канала) при заданной частоте дискретизации,
 * требуемой моделью (44100 Гц для HTDemucs). Если исходный файл моно — дублируем
 * канал. Если частота дискретизации отличается — делаем resample через OfflineAudioContext.
 * @param {AudioBuffer} buffer
 * @param {number} targetSampleRate
 * @returns {Promise<{left: Float32Array, right: Float32Array, sampleRate: number}>}
 */
async function toStereoAtSampleRate(buffer, targetSampleRate = 44100) {
  let workingBuffer = buffer;

  if (buffer.sampleRate !== targetSampleRate) {
    const offlineCtx = new OfflineAudioContext(
      Math.max(2, buffer.numberOfChannels),
      Math.ceil(buffer.duration * targetSampleRate),
      targetSampleRate
    );
    const source = offlineCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(offlineCtx.destination);
    source.start(0);
    workingBuffer = await offlineCtx.startRendering();
  }

  const left = workingBuffer.getChannelData(0);
  const right = workingBuffer.numberOfChannels > 1
    ? workingBuffer.getChannelData(1)
    : workingBuffer.getChannelData(0);

  return {
    left: Float32Array.from(left),
    right: Float32Array.from(right),
    sampleRate: targetSampleRate,
  };
}

/**
 * Полный пайплайн: File -> {left, right, sampleRate, duration, originalBuffer}
 * originalBuffer сохраняется отдельно (например, для волновой формы и проигрывания
 * исходного файла), даже если для модели понадобится ресемплинг.
 */
async function loadAudioFile(file) {
  const buffer = await decodeAudioFile(file);
  const stereo = await toStereoAtSampleRate(buffer, 44100);
  return {
    originalBuffer: buffer,
    left: stereo.left,
    right: stereo.right,
    sampleRate: stereo.sampleRate,
    duration: buffer.duration,
  };
}

window.AudioLoader = {
  getAudioContext,
  decodeAudioFile,
  toStereoAtSampleRate,
  loadAudioFile,
};
