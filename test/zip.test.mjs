// node test/zip.test.mjs  -- writes a zip with the extension's own writer and verifies it with `unzip -t` and python.
import { Zip } from "../core.js";
import fs from "fs"; import os from "os"; import path from "path"; import { execFileSync } from "child_process";
const z = new Zip();
const r1 = z.uniqueRoot("Same"), r2 = z.uniqueRoot("Same");
if (r1 === r2) throw new Error("project folder names must be unique");
z.add(`${r1}/instructions.md`, "héllo wörld\n");
z.add(`${r2}/files/a.bin`, new Uint8Array([0, 1, 2, 255]).buffer);
const f = path.join(os.tmpdir(), "cpd-test.zip");
fs.writeFileSync(f, Buffer.from(await z.blob().arrayBuffer()));
console.log(execFileSync("unzip", ["-tq", f]).toString().trim());
const names = execFileSync("unzip", ["-Z1", f]).toString().trim().split("\n");
if (names.join() !== "Same/instructions.md,Same (2)/files/a.bin") throw new Error("names " + names);
console.log("ok", names.join(" | "));
// knowledge docs hold extracted text: keep text extensions, label others .txt
const { _knowledgeName } = await import("../core.js");
for (const [i, o] of [["a.docx", "a.docx.txt"], ["notes.md", "notes.md"], ["x.pdf", "x.pdf.txt"], ["data.csv", "data.csv"], ["plain", "plain.txt"]])
  if (_knowledgeName(i) !== o) throw new Error(`knowledgeName(${i}) = ${_knowledgeName(i)}`);
console.log("knowledgeName ok");
