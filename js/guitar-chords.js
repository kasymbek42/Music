/**
 * guitar-chords.js
 *
 * Словарь типовых гитарных аппликатур (открытые позиции + баррэ-формы)
 * и рендер схемы лада в виде SVG-строки.
 *
 * Важно: аппликатура НЕ распознаётся из звука — это словарь стандартных
 * позиций. Один и тот же аккорд можно сыграть несколькими способами;
 * здесь приводится одна, самая распространённая для начинающих.
 */

const GUITAR_NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/**
 * Формат: frets = [строна6(E) ... струна1(e)], -1 = mute, 0 = open, N = номер лада.
 * barre — номер лада, на котором баррэ (если есть).
 */
const OPEN_CHORD_LIBRARY = {
  "C":     { frets: [-1, 3, 2, 0, 1, 0] },
  "C#":    { frets: [-1, 4, 3, 1, 2, 1], barre: 1 },
  "D":     { frets: [-1, -1, 0, 2, 3, 2] },
  "D#":    { frets: [-1, -1, 1, 3, 4, 3], barre: 1 },
  "E":     { frets: [0, 2, 2, 1, 0, 0] },
  "F":     { frets: [1, 3, 3, 2, 1, 1], barre: 1 },
  "F#":    { frets: [2, 4, 4, 3, 2, 2], barre: 2 },
  "G":     { frets: [3, 2, 0, 0, 0, 3] },
  "G#":    { frets: [4, 6, 6, 5, 4, 4], baseFret: 4, barre: 4 },
  "A":     { frets: [-1, 0, 2, 2, 2, 0] },
  "A#":    { frets: [-1, 1, 3, 3, 3, 1], barre: 1 },
  "B":     { frets: [-1, 2, 4, 4, 4, 2], barre: 2 },

  "Cm":    { frets: [-1, 3, 1, 0, 1, -1] },
  "C#m":   { frets: [-1, 4, 6, 6, 5, 4], baseFret: 4, barre: 4 },
  "Dm":    { frets: [-1, -1, 0, 2, 3, 1] },
  "D#m":   { frets: [-1, -1, 1, 3, 4, 2] },
  "Em":    { frets: [0, 2, 2, 0, 0, 0] },
  "Fm":    { frets: [1, 3, 3, 1, 1, 1], barre: 1 },
  "F#m":   { frets: [2, 4, 4, 2, 2, 2], barre: 2 },
  "Gm":    { frets: [3, 5, 5, 3, 3, 3], barre: 3 },
  "G#m":   { frets: [4, 6, 6, 4, 4, 4], barre: 4 },
  "Am":    { frets: [-1, 0, 2, 2, 1, 0] },
  "A#m":   { frets: [-1, 1, 3, 3, 2, 1], barre: 1 },
  "Bm":    { frets: [-1, 2, 4, 4, 3, 2], barre: 2 },

  "C7":    { frets: [-1, 3, 2, 3, 1, 0] },
  "D7":    { frets: [-1, -1, 0, 2, 1, 2] },
  "E7":    { frets: [0, 2, 0, 1, 0, 0] },
  "G7":    { frets: [3, 2, 0, 0, 0, 1] },
  "A7":    { frets: [-1, 0, 2, 0, 2, 0] },
  "B7":    { frets: [-1, 2, 1, 2, 0, 2] },

  "Am7":   { frets: [-1, 0, 2, 0, 1, 0] },
  "Dm7":   { frets: [-1, -1, 0, 2, 1, 1] },
  "Em7":   { frets: [0, 2, 0, 0, 0, 0] },

  "Cmaj7": { frets: [-1, 3, 2, 0, 0, 0] },
  "Dmaj7": { frets: [-1, -1, 0, 2, 2, 2] },
  "Fmaj7": { frets: [-1, -1, 3, 2, 1, 0] },
  "Gmaj7": { frets: [3, 2, 0, 0, 0, 2] },

  "Dsus2": { frets: [-1, -1, 0, 2, 3, 0] },
  "Dsus4": { frets: [-1, -1, 0, 2, 3, 3] },
  "Asus2": { frets: [-1, 0, 2, 2, 0, 0] },
  "Asus4": { frets: [-1, 0, 2, 2, 3, 0] },
  "Esus4": { frets: [0, 2, 2, 2, 0, 0] },
};

/** E-формы баррэ для аккордов вне словаря (мажор/минор/7/m7). */
const BARRE_SHAPES = {
  "":   [0, 2, 2, 1, 0, 0],
  "m":  [0, 2, 2, 0, 0, 0],
  "7":  [0, 2, 0, 1, 0, 0],
  "m7": [0, 2, 0, 0, 0, 0],
};

function generateBarreFallback(rootName, suffix) {
  const rootIdx = GUITAR_NOTE_NAMES.indexOf(rootName);
  const eOffset = rootIdx; // смещение от E (открытая позиция)
  const baseShape = BARRE_SHAPES[suffix];
  if (!baseShape || eOffset === 0) return null;

  const frets = baseShape.map((f) => (f >= 0 ? f + eOffset : f));
  return { frets, barre: eOffset };
}

/** Возвращает аппликатуру { frets, baseFret, barre } для названия аккорда, либо null. */
function getVoicing(chordName) {
  if (!chordName || chordName === "N") return null;
  if (OPEN_CHORD_LIBRARY[chordName]) {
    const v = OPEN_CHORD_LIBRARY[chordName];
    return { frets: v.frets, baseFret: v.baseFret || 1, barre: v.barre || null };
  }

  for (const rootLen of [2, 1]) {
    const rootCandidate = chordName.slice(0, rootLen);
    if (GUITAR_NOTE_NAMES.includes(rootCandidate)) {
      const suffix = chordName.slice(rootLen);
      const fallback = generateBarreFallback(rootCandidate, suffix);
      if (fallback) return { frets: fallback.frets, baseFret: 1, barre: fallback.barre };
      return null;
    }
  }
  return null;
}

/**
 * Рендерит схему лада как SVG-строку. Крестики/кружки/точки нарисованы
 * чистыми SVG-примитивами (line/circle), а не юникод-символами — это
 * надёжнее в плане кроссбраузерной отрисовки и шрифтов.
 */
function renderChordDiagramSVG(chordName, voicing, size = 140) {
  const marginTop = 28;
  const marginLeft = 18;
  const marginRight = 18;
  const marginBottom = 16;
  const nFretsShown = 4;

  const width = size;
  const height = Math.round(size * 1.3);
  const fretboardWidth = width - marginLeft - marginRight;
  const fretboardHeight = height - marginTop - marginBottom;

  const stringGap = fretboardWidth / 5;
  const fretGap = fretboardHeight / nFretsShown;

  const parts = [];
  parts.push(`<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`);
  parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="white"/>`);
  parts.push(`<text x="${width / 2}" y="16" text-anchor="middle" font-size="15" font-weight="700" font-family="Arial" fill="black">${escapeXml(chordName)}</text>`);

  if (voicing.baseFret > 1) {
    parts.push(`<text x="${marginLeft - 6}" y="${marginTop + fretGap * 0.6}" text-anchor="end" font-size="10" font-family="Arial" fill="black">${voicing.baseFret}fr</text>`);
  }

  // струны
  for (let s = 0; s < 6; s++) {
    const x = marginLeft + s * stringGap;
    parts.push(`<line x1="${x}" y1="${marginTop}" x2="${x}" y2="${marginTop + fretboardHeight}" stroke="black" stroke-width="1.2"/>`);
  }

  // лады
  for (let f = 0; f <= nFretsShown; f++) {
    const y = marginTop + f * fretGap;
    const strokeWidth = (f === 0 && voicing.baseFret === 1) ? 3 : 1;
    parts.push(`<line x1="${marginLeft}" y1="${y}" x2="${marginLeft + fretboardWidth}" y2="${y}" stroke="black" stroke-width="${strokeWidth}"/>`);
  }

  // баррэ
  if (voicing.barre) {
    const relativeFret = voicing.barre - voicing.baseFret + 1;
    if (relativeFret >= 1 && relativeFret <= nFretsShown) {
      const y = marginTop + (relativeFret - 0.5) * fretGap;
      const playedStrings = voicing.frets
        .map((f, i) => (f === voicing.barre ? i : -1))
        .filter((i) => i >= 0);
      if (playedStrings.length > 0) {
        const x1 = marginLeft + Math.min(...playedStrings) * stringGap;
        const x2 = marginLeft + Math.max(...playedStrings) * stringGap;
        parts.push(`<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="black" stroke-width="7" stroke-linecap="round"/>`);
      }
    }
  }

  // точки / крестики / кружки
  const markY = marginTop - 9;
  const markR = 4;
  voicing.frets.forEach((fret, s) => {
    const x = marginLeft + s * stringGap;
    if (fret === -1) {
      parts.push(`<line x1="${x - markR}" y1="${markY - markR}" x2="${x + markR}" y2="${markY + markR}" stroke="black" stroke-width="1.3"/>`);
      parts.push(`<line x1="${x - markR}" y1="${markY + markR}" x2="${x + markR}" y2="${markY - markR}" stroke="black" stroke-width="1.3"/>`);
    } else if (fret === 0) {
      parts.push(`<circle cx="${x}" cy="${markY}" r="${markR}" fill="none" stroke="black" stroke-width="1.3"/>`);
    } else {
      const relativeFret = fret - voicing.baseFret + 1;
      if (relativeFret >= 1 && relativeFret <= nFretsShown) {
        const y = marginTop + (relativeFret - 0.5) * fretGap;
        parts.push(`<circle cx="${x}" cy="${y}" r="6" fill="black"/>`);
      }
    }
  });

  parts.push("</svg>");
  return parts.join("");
}

function escapeXml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Возвращает { chord, frets, baseFret, barre, svg } или null, если аккорд не найден. */
function getChordDiagram(chordName) {
  const voicing = getVoicing(chordName);
  if (!voicing) return null;
  const svg = renderChordDiagramSVG(chordName, voicing);
  return {
    chord: chordName,
    frets: voicing.frets,
    baseFret: voicing.baseFret,
    barre: voicing.barre,
    svg,
  };
}

window.GuitarChords = {
  getVoicing,
  getChordDiagram,
  renderChordDiagramSVG,
};
