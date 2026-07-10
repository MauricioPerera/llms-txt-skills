#!/usr/bin/env node
// llms-skills — one-command publisher CLI for the llms.txt Skills standard.
//
//   llms-skills init <name>        scaffold a SKILL.md (+ optional tool.js) and manifest entry
//   llms-skills publish            regenerate ## Skills in llms.txt + .well-known/index.json (+ sign)
//   llms-skills validate <src>     validate an llms.txt (local path or URL) and its skills
//   llms-skills keygen             generate an ed25519 signing keypair (keep the key offline)
//
// Produces byte-identical artifacts to scripts/generate.py (enforced by cli/test.mjs),
// so what you publish is exactly what a runtime (mcpwasm, the MCP server, agents.txt) verifies.
// Zero external dependencies.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, relative, isAbsolute } from "node:path";
import {
  loadSkills, loadMemory, renderSkillsSection, renderSkillsMemoryLine, renderLlmsTxt,
  renderIndex, loadSigningKey, signSkills, publicKeyRawB64, generateKeyPair, validateLlmsTxt,
} from "../lib/core.mjs";
import { buildMemoryTargets } from "../lib/memory.mjs";
import { checkFreshness, attestVigencia } from "../lib/freshness.mjs";

const args = process.argv.slice(2);
const cmd = args[0];

function flag(name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; }
function has(name) { return args.includes(name); }
function die(msg) { console.error(msg); process.exit(1); }

const USAGE = `llms-skills — publisher CLI for the llms.txt Skills standard

Usage:
  llms-skills init <name> [--tool] [--root <dir>]   scaffold SKILL.md (+ tool.js) + manifest entry
  llms-skills memory <bundle-dir> [--check] [--root <dir>] [--license <spdx>] [--scope <name>]
                                                    OKF bundle -> BM25 snapshot + knowledge skills (RAG)
  llms-skills publish [--check] [--manifest <p>] [--root <dir>]   generate llms.txt ## Skills + index.json
  llms-skills validate <src> [--strict]             validate an llms.txt (path or URL)
  llms-skills freshness <bundle-dir> [--now <ISO>] [--json] [--root <dir>]
                                                    check knowledge freshness: TTLs (freshness.yaml)
                                                    + signed human attestations (attestations.json)
  llms-skills attest <bundle-dir> --concept <rel.md> --by <reviewer> --until <ISO>
                     --key <privkey-hex-file> [--on <ISO>] [--note <text>] [--root <dir>]
                                                    sign "this content is still true" (ed25519,
                                                    voided on edit, expires at --until)
  llms-skills keygen [--out <keyfile>]              generate an ed25519 signing keypair

The minimal case (L0) needs no signing key and no tool.js — just init + publish.
Add --tool for an executable skill; add a "signing" block to the manifest for L3 attestation.
\`memory\` turns a directory of OKF concepts (*.md with type/title frontmatter) into a
serverless RAG: a hash-pinned snapshot + search_knowledge/get_concept/list_concepts skills.
Run \`publish\` afterwards, as always.`;

function findManifest(root) {
  const cands = [flag("--manifest"), "llms-skills.json", "scripts/skills-manifest.json"].filter(Boolean);
  for (const c of cands) { const p = join(root, c); if (existsSync(p)) return p; }
  return null;
}

// ---- init ----
function cmdInit() {
  const name = args[1];
  if (!name || name.startsWith("--")) die("init: needs a skill name, e.g. `llms-skills init my-skill`");
  const root = flag("--root") || process.cwd();
  const withTool = has("--tool");

  const skillDir = join(root, "skills", name);
  const skillPath = join(skillDir, "SKILL.md");
  if (existsSync(skillPath)) die(`init: ${skillPath} already exists (refusing to overwrite)`);
  mkdirSync(skillDir, { recursive: true });

  writeFileSync(skillPath,
`---
name: ${name}
description: <one line — when an agent should reach for this skill>
version: 0.1.0
license: MIT
---

# ${name}

<Concrete instructions the agent follows to use your site/API. Name the exact
endpoints, parameters, and the shape of a correct call.>
`, "utf8");
  console.log(`[WRITE] skills/${name}/SKILL.md`);

  const entry = { path: `skills/${name}/SKILL.md`, url: `/skills/${name}/SKILL.md`, summary: `<what this skill does>` };
  if (withTool) {
    const toolPath = join(skillDir, "tool.js");
    writeFileSync(toolPath,
`// tool.js — executed verbatim inside a QuickJS-wasm sandbox. Call registerTool once.
// The only bridge out of the sandbox is the host capabilities the runtime injects
// (e.g. host.fetchOrigin(path, init) — scoped to your origin).
registerTool({
  name: "${name}",
  description: "<what this tool does>",
  inputSchema: { type: "object", properties: {}, required: [] },
  async handler(args, host) {
    // const res = await host.fetchOrigin("/api/...", { method: "GET" });
    return { ok: true };
  },
});
`, "utf8");
    console.log(`[WRITE] skills/${name}/tool.js`);
    entry.tool = `skills/${name}/tool.js`;
    entry.tool_url = `/skills/${name}/tool.js`;
  }

  const manifestPath = join(root, "llms-skills.json");
  let manifest = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, "utf8"))
    : { section_intro: "Remote Agent Skills published by this domain.", published: [] };
  if (!manifest.published) manifest.published = [];
  if (manifest.published.some((e) => e.path === entry.path)) {
    console.log(`[skip] manifest already lists ${entry.path}`);
  } else {
    manifest.published.push(entry);
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
    console.log(`[WRITE] llms-skills.json (added ${name})`);
  }
  console.log(`\nNext: fill in the SKILL.md${withTool ? " and tool.js" : ""}, then run  llms-skills publish`);
}

// ---- memory (RAG-OKF builder) ----
async function cmdMemory() {
  const bundleArg = args[1];
  if (!bundleArg || bundleArg.startsWith("--")) die("memory: needs a bundle directory, e.g. `llms-skills memory ./knowledge`");
  const root = flag("--root") || process.cwd();
  const bundleDir = join(root, bundleArg) === bundleArg ? bundleArg : join(root, bundleArg);
  if (!existsSync(bundleDir)) die(`memory: bundle directory not found: ${bundleDir}`);

  const manifestPath = findManifest(root) || join(root, "llms-skills.json");
  const manifest = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, "utf8"))
    : { section_intro: "Remote Agent Skills published by this domain.", published: [] };

  const { targets, warnings, manifest: newManifest, snapshotSha, conceptCount } =
    await buildMemoryTargets({ root, bundleDir, manifest, license: flag("--license"), scope: flag("--scope") });
  for (const w of warnings) console.error(`[warn] ${w}`);

  const rel = (p) => (relative(root, p) || p).replaceAll("\\", "/");
  const norm = (s) => s.replaceAll("\r\n", "\n");
  const manifestContent = JSON.stringify(newManifest, null, 2) + "\n";
  const all = [...targets, [manifestPath, manifestContent]];

  if (has("--check")) {
    const drift = all.filter(([p, c]) => (existsSync(p) ? norm(readFileSync(p, "utf8")) : null) !== norm(c));
    if (drift.length) {
      console.error("[DRIFT] Out-of-date memory artifacts. Run: llms-skills memory " + bundleArg);
      for (const [p] of drift) console.error(`  - ${rel(p)}`);
      process.exit(1);
    }
    console.log(`[OK] Memory in sync (${conceptCount} concepts, snapshot ${snapshotSha.slice(0, 12)}…).`);
    return;
  }

  for (const [p, c] of all) {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, c, "utf8");
    console.log(`[WRITE] ${rel(p)}`);
  }
  console.log(`\n${conceptCount} concept(s) indexed; snapshot sha256 ${snapshotSha.slice(0, 12)}…`);
  console.log("Next: run  llms-skills publish  to emit the skills-memory line and hash the tools.");
}

// ---- publish ----
function cmdPublish() {
  const root = flag("--root") || process.cwd();
  const manifestPath = findManifest(root);
  if (!manifestPath) die("publish: no manifest found (looked for llms-skills.json / scripts/skills-manifest.json). Run `llms-skills init` first.");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

  const skills = loadSkills(manifest, root);
  const memory = loadMemory(manifest, root);
  const section = renderSkillsSection(manifest, skills);
  const memoryLine = renderSkillsMemoryLine(memory);

  const llmsTxtPath = join(root, "llms.txt");
  const currentLlms = existsSync(llmsTxtPath) ? readFileSync(llmsTxtPath, "utf8") : "# " + (manifest.title || "My site") + "\n";
  const newLlms = renderLlmsTxt(currentLlms, section, memoryLine);

  const privateKey = loadSigningKey(manifest, root);
  let signingKeyB64 = null;
  if (privateKey) { signSkills(skills, privateKey); signingKeyB64 = publicKeyRawB64(privateKey); }
  const newIndex = renderIndex(skills, signingKeyB64);

  const indexPath = join(root, ".well-known", "agent-skills", "index.json");
  const pubKeyPath = join(root, ".well-known", "agent-skills", "signing-key.pub");
  const targets = [[llmsTxtPath, newLlms], [indexPath, newIndex]];
  if (signingKeyB64) targets.push([pubKeyPath, signingKeyB64 + "\n"]);

  const check = has("--check");
  const rel = (p) => (relative(root, p) || p).replaceAll("\\", "/");
  // Newline-insensitive comparison (matches generate.py, which reads via Python's
  // universal-newline mode): the generated content is LF; a file checked out with
  // CRLF (git autocrlf on Windows) is not real drift.
  const norm = (s) => s.replaceAll("\r\n", "\n");
  const drift = targets.filter(([p, c]) => (existsSync(p) ? norm(readFileSync(p, "utf8")) : null) !== norm(c));
  if (check) {
    if (drift.length) {
      console.error("[DRIFT] Out-of-date files. Run: llms-skills publish");
      for (const [p] of drift) console.error(`  - ${rel(p)}`);
      process.exit(1);
    }
    console.log("[OK] Everything in sync.");
    return;
  }
  for (const [p, c] of targets) {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, c, "utf8");
    console.log(`[WRITE] ${rel(p)}`);
  }
  console.log(`\n${skills.length} skill(s) published${signingKeyB64 ? " (signed)" : ""}.`);
}

// ---- validate ----
async function cmdValidate() {
  const src = args[1];
  if (!src || src.startsWith("--")) die("validate: needs a path or URL to an llms.txt");
  let text;
  if (/^https?:\/\//.test(src)) {
    const res = await fetch(src);
    if (!res.ok) die(`validate: fetch failed: ${res.status} ${res.statusText}`);
    text = await res.text();
  } else {
    if (!existsSync(src)) die(`validate: file not found: ${src}`);
    text = readFileSync(src, "utf8");
  }
  const { errors, warnings } = validateLlmsTxt(src, text);
  for (const e of errors) { console.log(`[ERROR] ${e.message}`); if (e.line) console.log(`  line: ${e.line}`); }
  for (const w of warnings) { console.log(`[WARNING] ${w.message}`); if (w.line) console.log(`  line: ${w.line}`); }
  if (!errors.length && !warnings.length) console.log("[OK] Valid. No errors or warnings.");
  else if (!errors.length) console.log(`[OK] Valid with ${warnings.length} warning(s).`);
  else console.log(`[FAIL] ${errors.length} error(s), ${warnings.length} warning(s).`);
  if (errors.length || (has("--strict") && warnings.length)) process.exit(1);
}

// ---- keygen ----
function cmdKeygen() {
  const out = flag("--out") || "llms-skills-signing.key";
  if (existsSync(out)) die(`keygen: ${out} already exists (refusing to overwrite)`);
  const { privatePem, publicB64 } = generateKeyPair();
  writeFileSync(out, privatePem, { encoding: "utf8", mode: 0o600 });
  console.log(`[WRITE] ${out}  (ed25519 private key — keep it OFFLINE, never commit it)`);
  console.log(`public key (base64): ${publicB64}`);
  console.log(`\nTo sign on publish, add to your manifest:\n  "signing": { "private_key_path": "${out}" }\nand keep ${out} out of git (.gitignore).`);
}

// ---- dispatch ----
// ---- freshness (RAG-OKF v2: signed knowledge freshness) ----
function resolveBundle(cmdName) {
  const bundleArg = args[1];
  if (!bundleArg || bundleArg.startsWith("--")) die(`${cmdName}: needs a bundle directory, e.g. \`llms-skills ${cmdName} ./knowledge\``);
  const root = flag("--root") || process.cwd();
  const bundleDir = isAbsolute(bundleArg) ? bundleArg : join(root, bundleArg);
  if (!existsSync(bundleDir)) die(`${cmdName}: bundle directory not found: ${bundleDir}`);
  return bundleDir;
}

function cmdFreshness() {
  const bundleDir = resolveBundle("freshness");
  const now = flag("--now") || new Date().toISOString().slice(0, 10);
  const result = checkFreshness(bundleDir, now, (w) => console.error(`[warn] ${w}`));
  if (has("--json")) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`FRESHNESS @ ${result.now}  (on_stale=${result.on_stale})`);
    for (const r of result.concepts) {
      const age = r.age_days === null || r.age_days === undefined ? "-" : `${r.age_days}d`;
      const ttl = r.ttl_days === null || r.ttl_days === undefined ? "-" : `${r.ttl_days}d`;
      const rem = r.remaining_days !== undefined && r.status === "fresh" ? `  (${r.remaining_days}d left)` : "";
      const extra = r.detail ? `  [${r.by || "-"}] ${r.detail}` : "";
      console.log(`  [${String(r.status).padStart(14)}] ${r.concept.padEnd(32)} age=${age.padEnd(5)} ttl=${ttl}${rem}${extra}`);
    }
    console.log(`  stale=${result.stale}  missing_required_ts=${result.missing_required_ts}`);
  }
  if (result.fail) process.exit(1);
}

// ---- attest (sign one freshness attestation) ----
function cmdAttest() {
  const bundleDir = resolveBundle("attest");
  const concept = flag("--concept"); const by = flag("--by");
  const until = flag("--until"); const keyPath = flag("--key");
  if (!concept || !by || !until || !keyPath) die("attest: --concept, --by, --until and --key are required");
  const on = flag("--on") || new Date().toISOString().slice(0, 10);
  const entry = attestVigencia({ bundleDir, concept, by, on, until, keyPath, note: flag("--note") || "" });
  console.log(`ATTESTED+SIGNED: ${concept} fresh per ${by} until ${until} (sha ${entry.content_sha256.slice(0, 8)}..., sig ${entry.signature.slice(0, 8)}...)`);
}

(async () => {
  try {
    switch (cmd) {
      case "init": cmdInit(); break;
      case "memory": await cmdMemory(); break;
      case "publish": cmdPublish(); break;
      case "validate": await cmdValidate(); break;
      case "freshness": cmdFreshness(); break;
      case "attest": cmdAttest(); break;
      case "keygen": cmdKeygen(); break;
      case "-h": case "--help": case "help": case undefined: console.log(USAGE); break;
      default: die(`Unknown command: ${cmd}\n\n${USAGE}`);
    }
  } catch (e) {
    die(`Error: ${e.message}`);
  }
})();
