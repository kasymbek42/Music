# Контекст проекта — для продолжения разработки

## Кто ты (для Claude)

Ты помогаешь разрабатывать браузерное приложение **Song Analyzer** — инструмент для музыкантов,
который анализирует аудиофайл прямо в браузере: распознаёт аккорды, показывает гитарные
аппликатуры и разделяет трек на инструменты через нейросеть. Никакого backend, никаких серверов —
только статические файлы на GitHub Pages.

---

## Главные принципы, которые нельзя нарушать

1. **Без backend.** Всё работает в браузере. Нет Node.js, нет API-сервера, нет базы данных.
2. **Без сборщика.** Нет webpack/vite/rollup. Деплой = `git push`. Скрипты подключаются через `<script src>`.
3. **Vanilla JS.** Нет React/Vue/Angular. Нет npm-пакетов в коде (только CDN для onnxruntime-web).
4. **Не трогать `coi-serviceworker.js`** — без него многопоточный WASM не работает на GitHub Pages.
5. **Не ломать кэширование модели** — `fetchModelWithCache` в `stem-separation.js` использует Cache Storage API; модель (~80–150 МБ) не должна перекачиваться при каждом визите.

---

## Стек

| Слой | Технология |
|---|---|
| UI | Vanilla HTML/CSS/JS, одна страница (SPA) |
| Аудио | Web Audio API (`AudioContext`, `AudioBuffer`) |
| FFT/Chroma | Самописный radix-2 FFT в `chords.js` |
| ONNX-инференс | `onnxruntime-web@1.19.2` через CDN jsDelivr |
| Модель стемов | HTDemucs ONNX (StemSplitio/htdemucs-onnx, Hugging Face, MIT) |
| Хостинг | GitHub Pages, `master`, корень `/` |
| Репо | https://github.com/kasymbek42/Music |
| Live | https://kasymbek42.github.io/Music/ |

---

## Архитектура состояния (app.js)

```js
const state = {
  audioData: null,   // { left, right, sampleRate, duration, originalBuffer }
  fileName: null,
  chords: [],        // [{ chord: "Am", startSec: 0, endSec: 4.2 }, ...]
  stems: null,       // { drums: {left, right}, bass, other, vocals }
};
```

Три экрана: `upload` → `analyzing` → `results`. Переключение через `showScreen(name)`.

---

## Модули и их ответственность

### `audio-loader.js` → `window.AudioLoader`
- `loadAudioFile(file)` — читает File, возвращает `{ left, right, sampleRate, duration, originalBuffer }`

### `chords.js` → `window.ChordAnalyzer`
- `analyzeChords(monoSamples, sampleRate, opts?)` → `[{chord, startSec, endSec}]`
- `stereoToMono(left, right)` → `Float32Array`
- Параметры по умолчанию: fftSize=4096, hopSize=2048, smoothingWindow=8, minDurationSec=0.5

### `guitar-chords.js` → `window.GuitarChords`
- `getChordDiagram(chordName)` → `{ svg: '<svg>...</svg>' }` или `null`
- Словарь стандартных открытых позиций, SVG-рендер

### `waveform.js` → `window.Waveform`
- `drawWaveform(canvasEl, monoSamples, { color })` — отрисовка на canvas

### `stem-separation.js` → `window.StemSeparation`
- `separateStems(left, right, sampleRate, onProgress)` → `{ drums, bass, other, vocals }` (каждый `{left, right}`)
- `encodeWav(left, right, sampleRate)` → `Blob` (WAV 16-bit PCM стерео)
- `STEM_NAMES` = `["drums", "bass", "other", "vocals"]`
- Требует `sampleRate === 44100` — иначе выбрасывает ошибку
- Модель кэшируется в `Cache Storage` под ключом `htdemucs-onnx-model-v1`

---

## Известные баги / технический долг

- **Треки не на 44 100 Гц** → `separateStems` падает с ошибкой. Нужен ресемплинг через `OfflineAudioContext`.
- **Аккорды на джазе** — классический chroma-алгоритм даёт плохие результаты на сложной гармонии.
- **Нет индикатора кэша модели** — пользователь не знает, что модель уже закэширована и грузиться не будет.

---

## Приоритеты из PRD (что делать в первую очередь)

1. Ресемплинг до 44 100 Гц (P0)
2. Индикатор кэша модели (P0)
3. WebGPU execution provider (P1)
4. Синхронизация аккордов с плеером (P1)
5. 6-стемовая модель как опция (P1)

---

## Как деплоить

```bash
git add -A
git commit -m "описание изменений"
git push
```

GitHub Pages обновляется автоматически через ~1 минуту. Build-шагов нет.
