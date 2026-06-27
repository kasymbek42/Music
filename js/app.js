/**
 * app.js
 *
 * Оркестрация интерфейса: загрузка файла -> анализ аккордов -> (опционально)
 * разделение на стемы. Всё состояние хранится в памяти вкладки, без какого-либо
 * backend или базы данных — это статическое одностраничное приложение.
 */

const state = {
  audioData: null, // { left, right, sampleRate, duration, originalBuffer }
  fileName: null,
  chords: [],
  stems: null, // { drums: {left, right}, bass: ..., other: ..., vocals: ... }
};

const screens = {
  upload: document.getElementById("upload-screen"),
  analyzing: document.getElementById("analyzing-screen"),
  results: document.getElementById("results-screen"),
};

function showScreen(name) {
  Object.entries(screens).forEach(([key, el]) => {
    el.hidden = key !== name;
  });
}

// ===========================================================
// Экран загрузки
// ===========================================================
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("file-input");

dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("is-dragover");
});
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("is-dragover"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("is-dragover");
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});
fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  if (file) handleFile(file);
});

// ===========================================================
// Обработка файла: загрузка + анализ аккордов (быстрый шаг)
// ===========================================================
async function handleFile(file) {
  state.fileName = file.name;
  showScreen("analyzing");
  setAnalyzingStatus("Читаем аудиофайл…");

  try {
    const audioData = await window.AudioLoader.loadAudioFile(file);
    state.audioData = audioData;

    setAnalyzingStatus("Распознаём аккорды…");
    // Небольшая пауза, чтобы UI успел отрисовать статус перед тяжёлым синхронным циклом FFT
    await nextFrame();

    const mono = window.ChordAnalyzer.stereoToMono(audioData.left, audioData.right);
    const segments = window.ChordAnalyzer.analyzeChords(mono, audioData.sampleRate);
    state.chords = segments;

    showScreen("results");
    renderResults();
  } catch (err) {
    console.error(err);
    setAnalyzingStatus(`Ошибка: ${err.message}`);
    setTimeout(() => showScreen("upload"), 3000);
  }
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function setAnalyzingStatus(text) {
  document.getElementById("analyzing-status").textContent = text;
}

// ===========================================================
// Рендер результатов: waveform, аккорды, аппликатуры
// ===========================================================
function renderResults() {
  document.getElementById("result-filename").textContent = state.fileName;

  const mono = window.ChordAnalyzer.stereoToMono(state.audioData.left, state.audioData.right);
  window.Waveform.drawWaveform(document.getElementById("original-waveform"), mono, {
    color: "#d98b3f",
  });

  renderChordsTimeline();
  renderChordDiagrams();
  renderStemsSection();
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function renderChordsTimeline() {
  const timeline = document.getElementById("chords-timeline");
  timeline.innerHTML = "";

  if (!state.chords || state.chords.length === 0) {
    timeline.innerHTML = `<p class="muted-note">Аккорды не распознаны.</p>`;
    return;
  }

  for (const seg of state.chords) {
    const chip = document.createElement("button");
    chip.className = "chord-chip" + (seg.chord === "N" ? " chord-chip--no-chord" : "");
    chip.innerHTML = `
      <span class="chord-chip__name">${seg.chord === "N" ? "—" : seg.chord}</span>
      <span class="chord-chip__time">${formatTime(seg.startSec)}</span>
    `;
    chip.addEventListener("click", () => highlightChordDiagram(seg.chord));
    timeline.appendChild(chip);
  }
}

function renderChordDiagrams() {
  const container = document.getElementById("chord-diagrams");
  container.innerHTML = "";

  const seen = new Set();
  for (const seg of state.chords) {
    if (seg.chord === "N" || seen.has(seg.chord)) continue;
    const diagram = window.GuitarChords.getChordDiagram(seg.chord);
    if (!diagram) continue;
    seen.add(seg.chord);

    const card = document.createElement("div");
    card.className = "chord-diagram-card";
    card.dataset.chord = seg.chord;
    card.innerHTML = diagram.svg;
    container.appendChild(card);
  }
}

function highlightChordDiagram(chordName) {
  document.querySelectorAll(".chord-diagram-card").forEach((card) => {
    card.classList.toggle("is-highlighted", card.dataset.chord === chordName);
  });
  const target = document.querySelector(`.chord-diagram-card[data-chord="${chordName}"]`);
  if (target) target.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
}

// ===========================================================
// Раздел разделения на стемы (тяжёлая опциональная операция)
// ===========================================================
function renderStemsSection() {
  const section = document.getElementById("stems-section");
  section.hidden = false;
  document.getElementById("separate-stems-btn").hidden = false;
  document.getElementById("stems-progress").hidden = true;
  document.getElementById("stems-results").hidden = true;
  document.getElementById("stems-results").innerHTML = "";
}

document.getElementById("separate-stems-btn").addEventListener("click", runStemSeparation);

async function runStemSeparation() {
  document.getElementById("separate-stems-btn").hidden = true;
  const progressEl = document.getElementById("stems-progress");
  progressEl.hidden = false;

  const statusText = document.getElementById("stems-progress-status");
  const progressBar = document.getElementById("stems-progress-bar");

  try {
    const stems = await window.StemSeparation.separateStems(
      state.audioData.left,
      state.audioData.right,
      state.audioData.sampleRate,
      (info) => updateStemsProgress(info, statusText, progressBar)
    );
    state.stems = stems;
    renderStemsResults();
  } catch (err) {
    console.error(err);
    statusText.textContent = `Ошибка: ${err.message}`;
  }
}

function updateStemsProgress(info, statusText, progressBar) {
  if (info.stage === "downloading-model") {
    if (info.total) {
      const pct = Math.round((info.loaded / info.total) * 100);
      statusText.textContent = `Загружаем модель разделения: ${pct}% (${formatBytes(info.loaded)} / ${formatBytes(info.total)})`;
      progressBar.style.width = `${pct}%`;
    } else {
      statusText.textContent = `Загружаем модель разделения… (${formatBytes(info.loaded)})`;
    }
  } else if (info.stage === "initializing-model") {
    statusText.textContent = "Готовим модель к работе…";
  } else if (info.stage === "separating") {
    const pct = Math.round((info.current / info.total) * 100);
    statusText.textContent = `Разделяем партии: сегмент ${info.current} из ${info.total} (${pct}%)`;
    progressBar.style.width = `${pct}%`;
  } else if (info.stage === "done") {
    statusText.textContent = "Готово";
    progressBar.style.width = "100%";
  }
}

function formatBytes(bytes) {
  if (!bytes) return "0 МБ";
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

const STEM_LABELS = {
  vocals: "Вокал",
  drums: "Барабаны",
  bass: "Бас",
  other: "Прочее",
};

function renderStemsResults() {
  document.getElementById("stems-progress").hidden = true;
  const container = document.getElementById("stems-results");
  container.hidden = false;
  container.innerHTML = "";

  for (const stemName of window.StemSeparation.STEM_NAMES) {
    const stem = state.stems[stemName];
    const wavBlob = window.StemSeparation.encodeWav(stem.left, stem.right, state.audioData.sampleRate);
    const url = URL.createObjectURL(wavBlob);

    const row = document.createElement("div");
    row.className = "stem-row";
    row.innerHTML = `
      <span class="stem-row__label">${STEM_LABELS[stemName] || stemName}</span>
      <audio controls src="${url}"></audio>
      <a href="${url}" download="${stemName}.wav">скачать</a>
    `;
    container.appendChild(row);
  }
}

// ===========================================================
// Сброс к началу
// ===========================================================
document.getElementById("new-upload-btn").addEventListener("click", () => {
  fileInput.value = "";
  state.audioData = null;
  state.chords = [];
  state.stems = null;
  showScreen("upload");
});

showScreen("upload");
