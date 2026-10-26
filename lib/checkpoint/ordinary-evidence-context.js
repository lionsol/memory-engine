"use strict";
// Context comes only from original source ranges; it never authorizes extra facts.
function headingText(text) {
  const line = text.split(/\r?\n/, 1)[0];
  return /^(?:#{1,6} .+|\*\*.+\*\*[:：]?|.+[:：])$/.test(line) ? line : null;
}
function tableCells(line) {
  const cells = []; let cursor = 0, ticks = 0, pipes = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\") { i++; continue; }
    if (line[i] === "`") {
      let end = i + 1;
      while (line[end] === "`") end++;
      const width = end - i;
      if (!ticks) ticks = width; else if (ticks === width) ticks = 0;
      i = end - 1; continue;
    }
    if (line[i] === "|" && !ticks) { cells.push(line.slice(cursor, i)); cursor = i + 1; pipes++; }
  }
  if (!pipes || ticks) return null;
  cells.push(line.slice(cursor));
  if (!cells[0].trim()) cells.shift();
  if (!cells.at(-1)?.trim()) cells.pop();
  return cells.length >= 1 ? cells : null;
}
function tableHeaders(unit, start, end, code) {
  const lines = []; let offset = 0;
  for (const raw of unit.text.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    lines.push({ text: line, start: unit.start + offset, end: unit.start + offset + line.length });
    offset += raw.length + 1;
  }
  const result = [];
  for (let i = 0; i + 2 < lines.length; i++) {
    const header = tableCells(lines[i].text), delimiter = tableCells(lines[i + 1].text);
    if (!header || !delimiter || header.length !== delimiter.length
      || !delimiter.every(cell => /^\s*:?-{3,}:?\s*$/.test(cell))) continue;
    let next = i + 2, intersects = false;
    while (next < lines.length) {
      const cells = tableCells(lines[next].text);
      if (!cells || cells.length !== header.length) break;
      if (start < lines[next].end && lines[next].start < end) {
        const row = lines[next], from = row.start + row.text.length - row.text.trimStart().length;
        const to = row.end - row.text.length + row.text.trimEnd().length;
        if (code && !(start <= from && end >= to)) throw Object.assign(new Error(code), { code });
        intersects = true;
      }
      next++;
    }
    const from = lines[i].start, to = lines[i + 1].end;
    if (intersects && !(start <= from && end >= to)) result.push({
      unit, quote: unit.text.slice(from - unit.start, to - unit.start),
      start: from, end: to, kind: "table_header",
    });
    i = Math.max(i, next - 1);
  }
  return result;
}
function contextFor(unit, start, end, byUnit) {
  const result = [], headerUnit = headingText(unit.text) ? unit : byUnit.get(unit.context_ref);
  const quote = headerUnit && headingText(headerUnit.text);
  if (quote && !(headerUnit.id === unit.id && start <= unit.start && end >= unit.start + quote.length)) {
    result.push({ unit: headerUnit, quote, start: headerUnit.start,
      end: headerUnit.start + quote.length, kind: "heading" });
  }
  return result.concat(tableHeaders(unit, start, end));
}
function assertTableScope(unit, start, end, code) { tableHeaders(unit, start, end, code); }
module.exports = { headingText, tableCells, contextFor, assertTableScope };
