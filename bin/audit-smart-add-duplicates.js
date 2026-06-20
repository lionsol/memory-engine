#!/usr/bin/env node
const { readFileSync, writeFileSync } = require("fs");
const { resolve } = require("path");

function printUsage() {
  console.error(`Usage:
  node bin/audit-smart-add-duplicates.js <smart-add.md> [--fix]
  node bin/audit-smart-add-duplicates.js [--json|--markdown] [--out <path>]

Notes:
  - Positional file mode preserves the legacy single-file fingerprint audit.
  - Report mode is read-only and audits lifecycle-owned smart-add duplicate_exact groups by default.`);
}

function lineNumberAt(content, index) {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (content.charCodeAt(i) === 10) line++;
  }
  return line;
}

function parseEntries(content, buildSmartAddFingerprint) {
  const headingRe = /^##\s+.+$/gm;
  const headings = [];
  let m;
  while ((m = headingRe.exec(content)) !== null) {
    headings.push({ start: m.index, end: m.index + m[0].length, titleLine: m[0] });
  }

  const entries = [];
  for (let i = 0; i < headings.length; i++) {
    const cur = headings[i];
    const nextStart = i + 1 < headings.length ? headings[i + 1].start : content.length;
    const block = content.slice(cur.start, nextStart);

    const categoryLineMatch = block.match(/^Category:\s*([^\n]*?)\s*$/m);
    const categoryLine = categoryLineMatch ? categoryLineMatch[1] : "";
    const isProtected = /\|\s*Protected\b/i.test(categoryLine);
    const category = categoryLine.split("|")[0].trim();

    let textStartInBlock = 0;
    const fingerprintCommentRe = /<!--\s*smart-add-fingerprint:\s*[a-f0-9]{8,64}\s*-->/i;
    const fpMatch = block.match(fingerprintCommentRe);
    if (fpMatch && fpMatch.index != null) {
      textStartInBlock = fpMatch.index + fpMatch[0].length;
    } else if (categoryLineMatch && categoryLineMatch.index != null) {
      textStartInBlock = categoryLineMatch.index + categoryLineMatch[0].length;
    }

    const text = block.slice(textStartInBlock).trim();
    const computedFingerprint = buildSmartAddFingerprint(text, category, isProtected);

    entries.push({
      start: cur.start,
      end: nextStart,
      line: lineNumberAt(content, cur.start),
      titleLine: cur.titleLine,
      category,
      isProtected,
      text,
      fingerprint: computedFingerprint,
    });
  }
  return entries;
}

function formatGroup(group) {
  const lines = [
    `fingerprint: ${group.fingerprint}`,
    `count: ${group.entries.length}`,
    "entries:",
  ];
  for (const e of group.entries) {
    lines.push(`  - line ${e.line}: ${e.titleLine}`);
  }
  return lines.join("\n");
}

function readFlagValue(args, index, flagName) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flagName} expects a value`);
  }
  return value;
}

function parseAuditArgs(argv = []) {
  const options = {
    json: false,
    markdown: false,
    out: null,
    help: false,
    fileArg: null,
    fix: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--fix") {
      options.fix = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--markdown") {
      options.markdown = true;
      continue;
    }
    if (arg === "--out") {
      options.out = readFlagValue(argv, i, "--out");
      i += 1;
      continue;
    }
    if (!arg.startsWith("--") && !options.fileArg) {
      options.fileArg = arg;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  if (options.json && options.markdown) {
    throw new Error("choose exactly one output format: --json or --markdown");
  }
  if (!options.fileArg && !options.json && !options.markdown) {
    options.json = true;
  }
  return options;
}

async function runLegacyFileAudit(fileArg, fix) {
  const { buildSmartAddFingerprint } = await import("../smart-add-fingerprint.js");
  const filePath = resolve(process.cwd(), fileArg);
  const content = readFileSync(filePath, "utf8");
  const entries = parseEntries(content, buildSmartAddFingerprint);

  const groups = new Map();
  for (const entry of entries) {
    if (!entry.fingerprint) continue;
    const arr = groups.get(entry.fingerprint) || [];
    arr.push(entry);
    groups.set(entry.fingerprint, arr);
  }

  const dupGroups = [];
  for (const [fingerprint, groupEntries] of groups.entries()) {
    if (groupEntries.length > 1) {
      dupGroups.push({ fingerprint, entries: groupEntries.sort((a, b) => a.line - b.line) });
    }
  }
  dupGroups.sort((a, b) => a.entries[0].line - b.entries[0].line);

  if (dupGroups.length === 0) {
    console.log(`No duplicates found in ${fileArg}`);
    return;
  }

  console.log(`Found ${dupGroups.length} duplicate fingerprint group(s) in ${fileArg}:`);
  for (const g of dupGroups) {
    console.log("\n" + formatGroup(g));
  }

  if (!fix) return;

  const removeRanges = [];
  for (const g of dupGroups) {
    for (let i = 1; i < g.entries.length; i++) {
      removeRanges.push({ start: g.entries[i].start, end: g.entries[i].end });
    }
  }

  removeRanges.sort((a, b) => b.start - a.start);
  let nextContent = content;
  for (const r of removeRanges) {
    nextContent = nextContent.slice(0, r.start) + nextContent.slice(r.end);
  }

  writeFileSync(filePath, nextContent, "utf8");
  console.log(`\nApplied --fix: removed ${removeRanges.length} duplicate entr${removeRanges.length === 1 ? "y" : "ies"}.`);
}

async function main() {
  const options = parseAuditArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    process.exit(0);
  }

  if (options.fileArg) {
    await runLegacyFileAudit(options.fileArg, options.fix);
    return;
  }

  const audit = await import("../lib/quality/smart-add-duplicate-audit.js");
  const { writeAuditReport } = await import("../lib/quality/chunks-without-confidence-audit.js");
  const report = audit.runSmartAddDuplicateAudit();
  const output = options.markdown
    ? audit.renderSmartAddDuplicateAuditMarkdown(report)
    : JSON.stringify(report, null, 2);

  if (options.out) {
    writeAuditReport(output, options.out);
  }
  console.log(output);
}

main().catch((error) => {
  console.error(String(error?.message || error));
  process.exit(1);
});

module.exports = {
  main,
  parseAuditArgs,
};
