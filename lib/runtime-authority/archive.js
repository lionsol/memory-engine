const { execFileSync } = require("node:child_process");
const { chmodSync, lstatSync, mkdirSync, readFileSync } = require("node:fs");
const { isAbsolute, posix, relative, resolve, sep } = require("node:path");
const { ARCHIVE_SCHEMA } = require("./constants.js");
const { buildRuntimeArtifactManifestV2 } = require("../../bin/runtime-artifact-manifest-v2-lib.cjs");

const TAR_FLAGS = Object.freeze([
  "--format=posix", "--sort=name", "--mtime=@0", "--owner=0", "--group=0", "--numeric-owner",
  "--pax-option=exthdr.name=%d/PaxHeaders/%f,delete=atime,delete=ctime,delete=LIBARCHIVE.creationtime",
  "--null", "--no-recursion", "--no-unquote",
]);

function archiveEntries(root) {
  const manifest = buildRuntimeArtifactManifestV2({ rootDir: root, checkedAt: "1970-01-01T00:00:00.000Z" });
  if (!manifest.valid) throw new Error(`invalid archive source:${manifest.errors.join(",")}`);
  return { manifest, entries: manifest.entries.map(entry => entry.path).sort((left, right) => Buffer.from(left).compare(Buffer.from(right))) };
}

function octal(bytes) {
  const value = bytes.toString("ascii").replace(/\0.*$/, "").trim();
  return value ? Number.parseInt(value, 8) : 0;
}

function tarText(bytes) { return bytes.toString("utf8").replace(/\0.*$/, ""); }

function validateArchiveName(name, label) {
  const normalized = String(name).replaceAll("\\", "/");
  if (!normalized || normalized.includes("\0") || isAbsolute(normalized) || normalized.split("/").includes("..")) throw new Error(`unsafe archive ${label}:${name}`);
  return normalized;
}

function validateArchiveLinkTarget(target) {
  const normalized = String(target).replaceAll("\\", "/");
  if (!normalized || normalized.includes("\0") || isAbsolute(normalized)) throw new Error(`unsafe archive link target:${target}`);
  return normalized;
}

function inspectCanonicalTar(archivePath) {
  const bytes = readFileSync(archivePath);
  const entries = [];
  let offset = 0;
  let pending = {};
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every(value => value === 0)) break;
    const size = octal(header.subarray(124, 136));
    const type = String.fromCharCode(header[156] || 0);
    let name = tarText(header.subarray(0, 100));
    const prefix = tarText(header.subarray(345, 500));
    if (prefix) name = `${prefix}/${name}`;
    let link = tarText(header.subarray(157, 257));
    if (type === "x" || type === "g") {
      const pax = bytes.subarray(offset + 512, offset + 512 + size);
      for (let paxOffset = 0; paxOffset < pax.length;) {
        const space = pax.indexOf(0x20, paxOffset);
        if (space < 0) throw new Error("invalid pax record");
        const length = Number(pax.subarray(paxOffset, space).toString("ascii"));
        if (!Number.isSafeInteger(length) || length <= 0 || paxOffset + length > pax.length) throw new Error("invalid pax record length");
        const record = pax.subarray(paxOffset, paxOffset + length).toString("utf8");
        const value = record.slice(record.indexOf(" ") + 1).replace(/\n$/, "");
        const equals = value.indexOf("=");
        if (equals > 0) pending[value.slice(0, equals)] = value.slice(equals + 1);
        paxOffset += length;
      }
      offset += 512 + Math.ceil(size / 512) * 512;
      continue;
    }
    if (pending.path) name = pending.path;
    if (pending.linkpath) link = pending.linkpath;
    pending = {};
    name = validateArchiveName(name, "entry");
    if (["1", "2"].includes(type)) {
      link = validateArchiveLinkTarget(link);
      const resolvedTarget = posix.normalize(posix.join(posix.dirname(name), link));
      if (resolvedTarget === ".." || resolvedTarget.startsWith("../")) throw new Error(`archive link escapes:${name}`);
    }
    if (!["0", "\0", "5", "1", "2"].includes(type)) throw new Error(`special archive entry:${name}`);
    entries.push({ name, type, link, mode: octal(header.subarray(100, 108)) });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function applyCanonicalModes({ archivePath, destination }) {
  const entries = inspectCanonicalTar(archivePath);
  const directories = [];
  for (const entry of entries) {
    const target = resolve(destination, entry.name);
    if (!(target === resolve(destination) || target.startsWith(`${resolve(destination)}${sep}`))) throw new Error(`archive mode path escape:${entry.name}`);
    const stats = lstatSync(target);
    if (entry.type === "5") directories.push([target, entry.mode]);
    else if (entry.type !== "1" && entry.type !== "2") chmodSync(target, entry.mode);
    else if (stats.isSymbolicLink() && entry.type === "2") continue;
  }
  for (const [target, mode] of directories.sort((left, right) => right[0].length - left[0].length)) chmodSync(target, mode);
  return entries.length;
}

function prepareCanonicalExtraction({ archivePath, destination }) {
  const entries = inspectCanonicalTar(archivePath);
  const destinationRoot = resolve(destination);
  mkdirSync(destinationRoot, { recursive: true, mode: 0o700 });
  for (const entry of entries.filter(candidate => candidate.type === "5").sort((left, right) => left.name.length - right.name.length)) {
    const target = resolve(destinationRoot, entry.name);
    if (!(target === destinationRoot || target.startsWith(`${destinationRoot}${sep}`))) throw new Error(`archive extraction path escape:${entry.name}`);
    mkdirSync(target, { recursive: true, mode: 0o700 });
  }
  return entries;
}

function createCanonicalArchive({ root, archivePath, tarExecutable, run = null }) {
  const source = archiveEntries(root);
  const rootReal = resolve(root);
  const destinationReal = resolve(archivePath);
  if (destinationReal === rootReal || destinationReal.startsWith(`${rootReal}${sep}`)) throw new Error("archive destination must be outside source tree");
  const { manifest, entries } = source;
  const argv = ["-cf", archivePath, ...TAR_FLAGS, "-C", root, "--files-from=-"];
  const input = Buffer.from(`${entries.map(entry => `${entry}\0`).join("")}`, "utf8");
  const execute = run || ((command) => execFileSync(command.executable, command.args, {
    cwd: root, env: { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" }, input: command.input,
    shell: false, timeout: 120_000, maxBuffer: 256 * 1024,
  }));
  execute({ executable: tarExecutable, args: argv, input });
  return { schema: ARCHIVE_SCHEMA, archivePath, manifest, argv };
}

function extractCanonicalArchive({ archivePath, destination, tarExecutable, run = null }) {
  const stats = lstatSync(archivePath);
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error("archive must be regular non-symlink file");
  prepareCanonicalExtraction({ archivePath, destination });
  const listingRunner = run || ((command) => execFileSync(command.executable, command.args, {
    cwd: destination, env: { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" }, shell: false, timeout: 120_000, maxBuffer: 256 * 1024,
  }));
  const listing = listingRunner({ executable: tarExecutable, args: ["-tf", archivePath] });
  const names = String(listing.stdout || "").split(/\r?\n/).filter(Boolean);
  for (const name of names) {
    const normalized = name.replaceAll("\\", "/");
    if (normalized.includes("\0") || isAbsolute(normalized) || normalized.split("/").includes("..")) throw new Error(`unsafe archive entry:${name}`);
    const target = resolve(destination, normalized);
    if (!(target === resolve(destination) || target.startsWith(`${resolve(destination)}${sep}`))) throw new Error(`archive path escape:${name}`);
  }
  const argv = ["-xf", archivePath, "-C", destination, "--no-same-owner", "--no-same-permissions", "--no-overwrite-dir", "--mode=ugo+rwX", "--keep-directory-symlink"];
  const execute = run || ((command) => execFileSync(command.executable, command.args, {
    cwd: destination, env: { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" }, shell: false, timeout: 120_000,
  }));
  execute({ executable: tarExecutable, args: argv });
  applyCanonicalModes({ archivePath, destination });
  return { schema: ARCHIVE_SCHEMA, archivePath, destination, argv };
}

function archiveSha256(path) { return require("node:crypto").createHash("sha256").update(readFileSync(path)).digest("hex"); }

module.exports = { ARCHIVE_SCHEMA, TAR_FLAGS, archiveEntries, inspectCanonicalTar, createCanonicalArchive, extractCanonicalArchive, applyCanonicalModes, prepareCanonicalExtraction, archiveSha256 };
