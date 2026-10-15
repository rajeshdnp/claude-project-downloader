// Core logic: talks to claude.ai's own (undocumented) web API with the cookies of the logged-in browser,
// and packs results into a ZIP (store-only, no dependencies). Used by popup.js.
const API = "https://claude.ai";

async function getJson(path) {
  const r = await fetch(API + path, { credentials: "include" });
  if (!r.ok) throw Object.assign(new Error(`${path} -> HTTP ${r.status}`), { status: r.status });
  return r.json();
}

export async function listOrgs() {
  return getJson("/api/organizations");
}

export async function listProjects(orgId) {
  const j = await getJson(`/api/organizations/${orgId}/projects?limit=200`);
  return Array.isArray(j) ? j : j.projects || [];
}

// --- helpers
const safe = (s, fb = "untitled") =>
  (String(s || fb).replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim().slice(0, 120)) || fb;

function uniq(used, name) {
  if (!used.has(name)) { used.add(name); return name; }
  const dot = name.lastIndexOf(".");
  const [b, e] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  for (let i = 2; ; i++) { const n = `${b} (${i})${e}`; if (!used.has(n)) { used.add(n); return n; } }
}

// /docs returns the *extracted text* of a knowledge doc, even when its name says .docx/.pdf. Saving that text under the
// original extension makes other tools (Word, python-docx, document indexers) fail, so label it as text.
function knowledgeName(n) {
  const name = safe(n, "doc.txt");
  return /\.(txt|md|markdown|csv|json|html?|xml|ya?ml)$/i.test(name) ? name : name + ".txt";
}

// --- zip (store only)
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

export class Zip {
  constructor() { this.parts = []; this.central = []; this.offset = 0; this.count = 0; this.roots = new Set(); }
  uniqueRoot(name) { return uniq(this.roots, name); } // two projects may share a name
  add(path, data) {
    const enc = new TextEncoder();
    const name = enc.encode(path);
    const u8 = typeof data === "string" ? enc.encode(data) : new Uint8Array(data);
    const crc = crc32(u8), d = new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, time, true); lh.setUint16(12, date, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, u8.length, true); lh.setUint32(22, u8.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    this.parts.push(lh.buffer, name, u8);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint16(12, time, true); ch.setUint16(14, date, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, u8.length, true); ch.setUint32(24, u8.length, true); ch.setUint16(28, name.length, true);
    ch.setUint32(42, this.offset, true);
    this.central.push(ch.buffer, name);
    this.offset += 30 + name.length + u8.length; this.count++;
  }
  blob() {
    const csize = this.central.reduce((s, b) => s + b.byteLength, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, this.count, true); e.setUint16(10, this.count, true);
    e.setUint32(12, csize, true); e.setUint32(16, this.offset, true);
    return new Blob([...this.parts, ...this.central, e.buffer], { type: "application/zip" });
  }
}

// Original bytes of one project file. `/raw` returns JSON with content_base64 of the exact original for every kind
// (PDF, image, CSV...). The converted/preview assets are only a fallback: previews of images are downscaled copies, so
// the caller compares the size with size_bytes and reports a mismatch instead of silently saving a degraded file.
async function fetchFile(base, f) {
  try {
    const j = await getJson(`${base}/files/${f.uuid || f.file_uuid}/raw`);
    if (typeof j.content_base64 === "string") {
      const bin = atob(j.content_base64), u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return { buf: u8.buffer, degraded: false };
    }
  } catch { /* fall through to assets */ }
  const url = (f.document_asset && f.document_asset.url) || (f.preview_asset && f.preview_asset.url);
  if (!url) throw new Error("no downloadable content");
  const r = await fetch(API + url, { credentials: "include" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const buf = await r.arrayBuffer();
  // converted PDFs are byte-identical to the original; anything else of a different size is a degraded rendition
  return { buf, degraded: !!f.size_bytes && buf.byteLength !== f.size_bytes };
}

// --- one project
// Adds <Project>/instructions.md, <Project>/knowledge/*.txt (text docs), <Project>/files/* (uploads), and returns a report.
export async function addProject(zip, orgId, project, log = () => {}) {
  const root = zip.uniqueRoot(safe(project.name));
  const base = `/api/organizations/${orgId}/projects/${project.uuid}`;
  const rep = { name: project.name, instructions: false, docs: 0, files: 0, failed: [] };

  const detail = await getJson(base);
  const instr = (detail.prompt_template || "").trim();
  if (instr) { zip.add(`${root}/instructions.md`, instr + "\n"); rep.instructions = true; }
  if (detail.description) zip.add(`${root}/description.txt`, detail.description + "\n");

  const used = new Set();
  const docs = await getJson(base + "/docs");
  for (const d of docs) {
    zip.add(`${root}/knowledge/${uniq(used, knowledgeName(d.file_name))}`, d.content || "");
    rep.docs++;
  }

  const files = await getJson(base + "/files");
  const usedF = new Set();
  for (const f of files) {
    const name = safe(f.file_name, f.file_uuid);
    try {
      log(`${project.name}: ${name}`);
      const { buf, degraded } = await fetchFile(base, f);
      let out = name;
      if (degraded) {
        const dot = name.lastIndexOf(".");
        out = dot > 0 ? `${name.slice(0, dot)} (preview only)${name.slice(dot)}` : `${name} (preview only)`;
        rep.failed.push(`${name}: original not available on claude.ai, saved a lower-quality preview (${buf.byteLength} of ${f.size_bytes} bytes)`);
      }
      zip.add(`${root}/files/${uniq(usedF, out)}`, buf);
      rep.files++;
    } catch (e) { rep.failed.push(`${name}: ${e.message}`); }
  }
  if (rep.failed.length) zip.add(`${root}/_failed.txt`, rep.failed.join("\n") + "\n");
  return rep;
}

export const _safe = safe;
export const _knowledgeName = knowledgeName;
