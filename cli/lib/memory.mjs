// memory.mjs — RAG-OKF builder behind `llms-skills memory`.
//
// Turns an OKF bundle (https://github.com/GoogleCloudPlatform/knowledge-catalog
// okf/SPEC.md v0.1: *.md concepts with `type` frontmatter; index.md/log.md
// reserved) into the origin-memory artifacts the Executable Skills extension
// v0.5 §2.4 defines and the mcpwasm runtimes already consume:
//
//   - a BM25 snapshot (@rckflr/minimemory, format minimemory-okf-v1),
//     CANONICALIZED for byte-determinism (see canonicalizeSnapshot),
//   - three generated knowledge skills (search_knowledge / get_concept /
//     list_concepts) as tool.js + SKILL.md,
//   - manifest wiring (`memory` block + published entries) so a plain
//     `llms-skills publish` emits the skills-memory line and all hashes.
//
// The engine is an optionalDependency: lazily imported; a clear error (not a
// crash) if missing. The consumer side needs nothing new — mcpwasm >= 0.4.0
// verifies snapshot_sha256 and injects host.memorySearch on both runtimes.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, relative, basename } from "node:path";
import { createRequire } from "node:module";
import { parseFrontmatter, sha256NormalizedBuf } from "./core.mjs";

export const SNAPSHOT_FORMAT = "minimemory-okf-v1";
export const RESERVED_FILES = new Set(["index.md", "log.md"]); // OKF 0.1 reserved names
const CHUNK_SIZE = 800; // validated values (same as mcpwasm's docs-site publisher)
const CHUNK_OVERLAP = 50;
const MAX_SNAPSHOT_BYTES = 4194304; // 4 MB — the cap both mcpwasm runtimes enforce
const MAX_EMBED_LIST_BYTES = 262144; // embedded concept list must stay well under the 1 MB tool.js cap

// ---- engine (optionalDependency, lazy) --------------------------------------
export async function loadMemoryEngine() {
  try {
    const require = createRequire(import.meta.url);
    const mod = await import("@rckflr/minimemory");
    mod.initSync({ module: readFileSync(require.resolve("@rckflr/minimemory/minimemory_bg.wasm")) });
    return mod;
  } catch (e) {
    const err = new Error(
      "memory: the BM25 engine (@rckflr/minimemory) is not installed. It is an " +
      "optionalDependency — `npm install @rckflr/minimemory` (or reinstall without " +
      "--omit=optional) and retry. Underlying error: " + (e && e.message ? e.message : String(e))
    );
    err.code = "ENGINE_MISSING";
    throw err;
  }
}

// ---- bundle scan -------------------------------------------------------------
// Walks the bundle, returns concepts sorted by id (determinism) plus warnings.
// concept id = bundle-relative posix path (the okf-integration convention).
export function scanBundle(bundleDir) {
  const concepts = [];
  const warnings = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!name.endsWith(".md") || RESERVED_FILES.has(name)) continue;
      const id = relative(bundleDir, p).replaceAll("\\", "/");
      const raw = readFileSync(p, "utf8");
      const fm = parseFrontmatter(raw);
      let type = fm.type;
      if (!type) {
        warnings.push(`${id}: frontmatter missing 'type' (OKF 0.1 requires it) — defaulting to "Documentation"`);
        type = "Documentation";
      }
      // body = content after the frontmatter block (or the whole file if none)
      let body = raw;
      if (raw.startsWith("---")) {
        const end = raw.indexOf("---", 3);
        if (end !== -1) body = raw.slice(end + 3);
      }
      body = body.replace(/^\s+/, "");
      const h1 = body.match(/^#\s+(.+)$/m);
      const title = fm.title || (h1 ? h1[1].trim() : basename(id, ".md"));
      const description = fm.description || "";
      if (!body.trim()) warnings.push(`${id}: empty body — concept will not be searchable`);
      concepts.push({ id, type, title, description, body });
    }
  };
  walk(bundleDir);
  concepts.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { concepts, warnings };
}

// ---- snapshot ----------------------------------------------------------------
// minimemory's export_snapshot() iterates a Rust HashMap: chunk ORDER varies
// between builds (verified empirically: identical content, shuffled array).
// The snapshot is a plain JSON array with already-sorted object keys, so
// sorting by chunk id and re-serializing compact yields a byte-deterministic,
// import-compatible snapshot. This canonicalization is REQUIRED for the
// content-addressing story (`--check`, CI, sha-pinning) to work at all.
export function canonicalizeSnapshot(snapshot) {
  const arr = JSON.parse(snapshot);
  if (!Array.isArray(arr)) throw new Error("memory: unexpected snapshot shape (not a JSON array)");
  arr.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return JSON.stringify(arr);
}

export function buildSnapshot(mem, concepts) {
  const idx = mem.WasmOkfIndex.with_chunk_size(CHUNK_SIZE, CHUNK_OVERLAP);
  for (const c of concepts) {
    const content = `---\ntype: ${c.type}\ntitle: ${c.title}\n---\n${c.body}`;
    idx.ingest_concept(c.id, content);
  }
  const snapshot = canonicalizeSnapshot(idx.export_snapshot());
  if (Buffer.byteLength(snapshot, "utf8") > MAX_SNAPSHOT_BYTES) {
    throw new Error(
      `memory: snapshot exceeds the 4 MB cap the runtimes enforce (${Buffer.byteLength(snapshot, "utf8")} bytes). ` +
      "Split the bundle or trim concept bodies."
    );
  }
  return snapshot;
}

// ---- generated skills ---------------------------------------------------------
// search_knowledge is a UNIVERSAL template: identical bytes for every
// publisher, so its tool_sha256 is stable ecosystem-wide — audit once,
// attest once. Do not interpolate anything publisher-specific into it.
export function searchToolSource() {
  return `// search_knowledge — universal origin-memory search tool (llms-skills memory).
// Identical for every publisher: its sha256 is a stable, ecosystem-wide constant.
registerTool({
  name: "search_knowledge",
  description: "BM25 search over this origin's published knowledge (OKF bundle). Returns the most relevant chunks with concept ids.",
  inputSchema: { type: "object", properties: { q: { type: "string", description: "search query" }, k: { type: "number", description: "max results (1-10, default 5)" } }, required: ["q"] },
  handler: async function (args) {
    return await host.memorySearch(args.q, typeof args.k === "number" ? args.k : 5);
  }
});
`;
}

export function getConceptToolSource(conceptUrlById) {
  return `// get_concept — fetch a full concept document from this origin's OKF bundle.
// The id->url map is embedded at build time (content-addressed via tool_sha256).
var CONCEPTS = ${JSON.stringify(conceptUrlById)};
registerTool({
  name: "get_concept",
  description: "Fetch the full markdown of a knowledge concept by id (as returned by search_knowledge / list_concepts).",
  inputSchema: { type: "object", properties: { id: { type: "string", description: "concept id, e.g. policies/refunds.md" } }, required: ["id"] },
  handler: async function (args) {
    var url = CONCEPTS[args.id];
    if (!url) throw new Error("unknown concept id: " + args.id);
    var r = await host.fetchOrigin(url);
    if (r.status !== 200) throw new Error("fetch failed: HTTP " + r.status);
    return { id: args.id, markdown: r.body };
  }
});
`;
}

export function listConceptsToolSource(conceptMeta) {
  const embedded = JSON.stringify(conceptMeta);
  if (Buffer.byteLength(embedded, "utf8") > MAX_EMBED_LIST_BYTES) {
    throw new Error(
      "memory: the concept list is too large to embed in list_concepts/tool.js (" +
      Buffer.byteLength(embedded, "utf8") + " bytes > " + MAX_EMBED_LIST_BYTES + "). " +
      "Reduce concepts or descriptions."
    );
  }
  return `// list_concepts — enumerate this origin's published knowledge concepts.
// The list is embedded at build time (content-addressed via tool_sha256).
var CONCEPTS = ${embedded};
registerTool({
  name: "list_concepts",
  description: "List all knowledge concepts published by this origin (id, type, title, description).",
  inputSchema: { type: "object", properties: {} },
  handler: function () { return { concepts: CONCEPTS }; }
});
`;
}

export function knowledgeSkillMd(name, description, license) {
  return `---
name: ${name}
description: ${description}
version: 0.1.0
license: ${license}
---

# ${name}

${description} Generated by \`llms-skills memory\` from this origin's OKF
knowledge bundle; backed by a hash-verified BM25 snapshot (origin memory,
Executable Skills v0.5 §2.4). Call the tool rather than improvising: the
runtime executes it verbatim in a sandbox.
`;
}

// ---- orchestrator --------------------------------------------------------------
// Builds everything under `root`. Returns { targets, warnings, snapshotSha, manifest }
// where targets is [path, content] pairs (the caller writes or checks them).
export async function buildMemoryTargets({ root, bundleDir, manifest, license, scope }) {
  // Executable Skills v0.5 SS2.5: namespace declarativo para origins multi-proyecto.
  if (scope !== undefined && scope !== null && !/^[a-z][a-z0-9_-]*$/.test(String(scope))) {
    throw new Error("memory: invalid --scope (pattern ^[a-z][a-z0-9_-]*$, Executable Skills v0.5 §2.5)");
  }
  const bundleRel = relative(root, bundleDir).replaceAll("\\", "/");
  if (bundleRel.startsWith("..")) {
    throw new Error("memory: the bundle must live inside the publisher root (it is served as static content)");
  }
  const { concepts, warnings } = scanBundle(bundleDir);
  if (concepts.length === 0) throw new Error(`memory: no OKF concepts (*.md) found in ${bundleDir}`);

  const mem = await loadMemoryEngine();
  const snapshot = buildSnapshot(mem, concepts);

  const urlById = {};
  for (const c of concepts) urlById[c.id] = "/" + (bundleRel === "" ? "" : bundleRel + "/") + c.id;
  const conceptMeta = concepts.map((c) => ({ id: c.id, type: c.type, title: c.title, description: c.description }));

  const lic = license || manifest.license || "MIT";
  const SKILLS = [
    ["search_knowledge", searchToolSource(), "BM25 search over this origin's published knowledge bundle. Use it to find which concept answers a question before fetching it."],
    ["get_concept", getConceptToolSource(urlById), "fetch the full markdown of a knowledge concept by id from this origin's bundle."],
    ["list_concepts", listConceptsToolSource(conceptMeta), "list every knowledge concept this origin publishes (id, type, title, description)."],
  ];

  const targets = [[join(root, "skills-index.snapshot"), snapshot]];
  for (const [name, toolSrc, summary] of SKILLS) {
    targets.push([join(root, "skills", name, "tool.js"), toolSrc]);
    targets.push([join(root, "skills", name, "SKILL.md"), knowledgeSkillMd(name, summary.charAt(0).toUpperCase() + summary.slice(1), lic)]);
  }

  // .gitattributes: git autocrlf mangling the snapshot on checkout would break
  // the published sha (real-world footgun) — pin it as -text.
  const gaPath = join(root, ".gitattributes");
  const gaLine = "skills-index.snapshot -text";
  const gaCurrent = existsSync(gaPath) ? readFileSync(gaPath, "utf8") : "";
  if (!gaCurrent.split(/\r?\n/).some((l) => l.trim() === gaLine)) {
    targets.push([gaPath, (gaCurrent ? gaCurrent.replace(/\n?$/, "\n") : "") + gaLine + "\n"]);
  }

  // manifest wiring (idempotent): memory block + one published entry per skill.
  const newManifest = JSON.parse(JSON.stringify(manifest));
  newManifest.memory = {
    snapshot_path: "skills-index.snapshot",
    snapshot_url: "/skills-index.snapshot",
    format: SNAPSHOT_FORMAT,
  };
  if (scope) newManifest.memory.scope = String(scope);
  else delete newManifest.memory.scope;
  if (!Array.isArray(newManifest.published)) newManifest.published = [];
  for (const [name, , summary] of SKILLS) {
    const path = `skills/${name}/SKILL.md`;
    const existing = newManifest.published.find((e) => e && e.path === path);
    if (!existing) {
      const entry = {
        path,
        url: `/skills/${name}/SKILL.md`,
        summary,
        tool: `skills/${name}/tool.js`,
        tool_url: `/skills/${name}/tool.js`,
      };
      if (scope) entry.scope = String(scope);
      newManifest.published.push(entry);
    } else if (scope) {
      existing.scope = String(scope); // re-run con --scope: refresca el namespace
    } else {
      delete existing.scope; // re-run sin --scope: vuelve al default global
    }
  }

  return {
    targets,
    warnings,
    manifest: newManifest,
    snapshotSha: sha256NormalizedBuf(Buffer.from(snapshot, "utf8")),
    conceptCount: concepts.length,
  };
}
