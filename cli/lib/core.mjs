// core.mjs — pure functions behind the llms-skills CLI.
//
// These reproduce, byte-for-byte, what scripts/generate.py and scripts/validate.py
// produce, so a publisher can generate/verify the exact artifacts a runtime (mcpwasm,
// the MCP server, agents.txt) already consumes — without cloning this repo or having
// Python. The byte-identity is enforced by cli/test.mjs against the Python output.
//
// No external dependencies: ed25519 via node:crypto, hashing via node:crypto.

import { createHash, createPrivateKey, createPublicKey, sign as cryptoSign, generateKeyPairSync } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve as pathResolve } from "node:path";

// ---- hashing (CRLF normalized to LF, identical to generate.py/validate.py) ----
export function sha256NormalizedBuf(buf) {
  // latin1 is a 1:1 byte<->char map, so this CRLF->LF replace is byte-exact.
  const normalized = Buffer.from(buf.toString("latin1").replaceAll("\r\n", "\n"), "latin1");
  return createHash("sha256").update(normalized).digest("hex");
}
export function sha256NormalizedFile(path) {
  return sha256NormalizedBuf(readFileSync(path));
}

// ---- YAML frontmatter (flat key: value, same subset generate.py handles) ----
export function parseFrontmatter(text) {
  if (!text.startsWith("---")) return {};
  const parts = text.split("---");
  if (parts.length < 3) return {};
  const body = parts[1].trim();
  const result = {};
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)$/);
    if (m) result[m[1]] = m[2].trim().replace(/^"|"$/g, "");
  }
  return result;
}

const REQUIRED_FRONTMATTER = ["name", "description", "version", "license"];

// ---- load skills from a manifest (mirrors generate.py load_skills) ----
export function loadSkills(manifest, repoRoot) {
  const skills = [];
  for (const entry of manifest.published) {
    const path = join(repoRoot, entry.path);
    if (!existsSync(path)) throw new Error(`SKILL.md not found: ${entry.path}`);
    const fm = parseFrontmatter(readFileSync(path, "utf8"));
    for (const key of REQUIRED_FRONTMATTER) {
      if (!(key in fm)) throw new Error(`${entry.path}: frontmatter missing '${key}'`);
    }
    let toolUrl = null, toolSha256 = null;
    if (entry.tool) {
      if (!entry.tool_url) throw new Error(`${entry.path}: declares 'tool' without 'tool_url' (both required together)`);
      const toolPath = join(repoRoot, entry.tool);
      if (!existsSync(toolPath)) throw new Error(`tool.js not found: ${entry.tool}`);
      toolUrl = entry.tool_url;
      toolSha256 = sha256NormalizedFile(toolPath);
    }
    skills.push({
      name: fm.name, description: fm.description, version: fm.version, license: fm.license,
      homepage: fm.homepage || null, url: entry.url, summary: entry.summary,
      sha256: sha256NormalizedFile(path), path, toolUrl, toolSha256,
    });
  }
  return skills;
}

export function loadMemory(manifest, repoRoot) {
  const memory = manifest.memory;
  if (!memory) return null;
  for (const key of ["snapshot_path", "snapshot_url", "format"]) {
    if (!memory[key]) throw new Error(`manifest.memory needs '${key}'`);
  }
  const snapshotPath = join(repoRoot, memory.snapshot_path);
  if (!existsSync(snapshotPath)) throw new Error(`snapshot not found: ${memory.snapshot_path}`);
  return { snapshot_url: memory.snapshot_url, format: memory.format, snapshot_sha256: sha256NormalizedFile(snapshotPath) };
}

// ---- render: ## Skills section (compact JSON, exact key order of generate.py) ----
export function renderSkillsSection(manifest, skills) {
  const lines = ["## Skills", "", manifest.section_intro, ""];
  for (const s of skills) {
    const meta = { version: s.version, license: s.license, sha256: s.sha256 };
    if (s.toolUrl && s.toolSha256) { meta.tool = s.toolUrl; meta.tool_sha256 = s.toolSha256; }
    lines.push(`- [${s.name}](${s.url}): ${s.summary} <!-- skill: ${JSON.stringify(meta)} -->`);
  }
  return lines.join("\n") + "\n";
}

export function renderSkillsMemoryLine(memory) {
  if (!memory) return "";
  const meta = { snapshot: memory.snapshot_url, snapshot_sha256: memory.snapshot_sha256, format: memory.format };
  return `<!-- skills-memory: ${JSON.stringify(meta)} -->\n\n`;
}

const MEMORY_LINE_RE = /^<!--\s*skills-memory:\s*\{.*?\}\s*-->\s*$/;

export function renderLlmsTxt(current, section, memoryLine = "") {
  const out = [];
  for (const line of current.split(/\r?\n/)) {
    if (/^##\s+skills\s*$/i.test(line.trim())) break;
    if (MEMORY_LINE_RE.test(line.trim())) continue;
    out.push(line);
  }
  while (out.length && out[out.length - 1].trim() === "") out.pop();
  return out.join("\n") + "\n\n" + memoryLine + section;
}

// ---- ed25519 (matches generate.py's raw-32-byte + PKCS8 handling) ----
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

export function privateKeyFromSeed(seed32) {
  const der = Buffer.concat([PKCS8_ED25519_PREFIX, seed32]);
  return createPrivateKey({ key: der, format: "der", type: "pkcs8" });
}
export function deriveDemoKey(seedStr) {
  return privateKeyFromSeed(createHash("sha256").update(seedStr, "utf8").digest());
}
export function privateKeyFromPem(pem) {
  return createPrivateKey({ key: pem, format: "pem" });
}
export function publicKeyRawB64(privateKey) {
  const spki = createPublicKey(privateKey).export({ type: "spki", format: "der" });
  return spki.subarray(spki.length - 32).toString("base64"); // last 32 bytes = raw ed25519 pubkey
}
export function signB64(privateKey, msgBuf) {
  return cryptoSign(null, msgBuf, privateKey).toString("base64");
}
export function generateKeyPair() {
  const { privateKey } = generateKeyPairSync("ed25519");
  return {
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }),
    publicB64: publicKeyRawB64(privateKey),
  };
}

// signing config: {private_key_path} (real, offline) or {demo_seed} (reproducible demo)
export function loadSigningKey(manifest, repoRoot) {
  const signing = manifest.signing;
  if (!signing) return null;
  if (signing.private_key_path) return privateKeyFromPem(readFileSync(join(repoRoot, signing.private_key_path)));
  if (signing.demo_seed) return deriveDemoKey(signing.demo_seed);
  throw new Error("manifest.signing needs 'private_key_path' or 'demo_seed'");
}

export function signSkills(skills, privateKey) {
  for (const s of skills) {
    const normalized = Buffer.from(readFileSync(s.path).toString("latin1").replaceAll("\r\n", "\n"), "latin1");
    s.signature = signB64(privateKey, normalized);
  }
}

// ---- render: .well-known/agent-skills/index.json (superset of agentskills.io 0.2.0) ----
const AGENTSKILLS_DISCOVERY_SCHEMA = "https://schemas.agentskills.io/discovery/0.2.0/schema.json";

export function renderIndex(skills, signingKeyB64) {
  const items = skills.map((s) => {
    const item = { name: s.name, type: "skill-md", description: s.description, url: s.url, digest: `sha256:${s.sha256}` };
    item.version = s.version;
    item.license = s.license;
    if (s.homepage) item.homepage = s.homepage;
    item.sha256 = s.sha256;
    if (s.toolUrl && s.toolSha256) { item.tool = s.toolUrl; item.tool_sha256 = s.toolSha256; }
    if (s.signature) item.signature = s.signature;
    return item;
  });
  const doc = { $schema: AGENTSKILLS_DISCOVERY_SCHEMA };
  if (signingKeyB64) { doc.signing_alg = "ed25519"; doc.signing_key = signingKeyB64; }
  doc.skills = items;
  return JSON.stringify(doc, null, 2) + "\n";
}

// ---- validate (port of validate.py validate_llms_txt) ----
function resolveSkillPath(skillUrl, source) {
  if (/^https?:\/\//.test(skillUrl)) return skillUrl;
  if (/^https?:\/\//.test(source)) return new URL(skillUrl, source).href;
  const baseDir = dirname(source);
  return pathResolve(baseDir, skillUrl.replace(/^\/+/, ""));
}

export function validateLlmsTxt(source, text) {
  const errors = [], warnings = [];
  const err = (message, line = "") => errors.push({ message, line });
  const warn = (message, line = "") => warnings.push({ message, line });

  // origin memory line (optional)
  const memMatch = text.split(/\r?\n/).map((l) => l.trim().match(MEMORY_CAPTURE_RE)).find(Boolean);
  if (memMatch) validateMemory(memMatch[1], source, err, warn);

  // find ## Skills section
  const lines = text.split(/\r?\n/);
  let inSkills = false;
  const skillLines = [];
  for (const line of lines) {
    const t = line.trim();
    if (/^##\s+skills\s*$/i.test(t)) { inSkills = true; continue; }
    if (inSkills && /^##\s+/i.test(t)) break;
    if (inSkills) skillLines.push(line);
  }
  if (!inSkills) { err("No ## Skills section found"); return { errors, warnings }; }
  if (skillLines.every((l) => !l.trim())) warn("## Skills section exists but is empty");

  // group items (lines starting with "- ")
  const items = [];
  let cur = null;
  for (const line of skillLines) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith("- ")) { if (cur) items.push(cur); cur = [t]; }
    else if (cur) cur.push(t);
  }
  if (cur) items.push(cur);
  if (!items.length) warn("No items found in ## Skills");

  for (const itemLines of items) {
    const raw = itemLines.join(" ");
    const m = raw.match(/^-\s*\[([^\]]+)\]\s*\(([^)]+)\)\s*:\s*([\s\S]+?)(?:\s*<!--\s*skill:\s*(\{[\s\S]*?\})\s*-->)?$/i);
    if (!m) { err("Invalid skill entry format", raw.slice(0, 80)); continue; }
    const url = m[2].trim(), desc = m[3].trim(), metaRaw = m[4];
    let metaParsed = null;
    if (metaRaw) {
      try {
        metaParsed = JSON.parse(metaRaw);
        if ("version" in metaParsed && !/^\d+\.\d+\.\d+$/.test(String(metaParsed.version)))
          warn(`Non-semantic version: ${metaParsed.version}`, raw.slice(0, 80));
        if ("sha256" in metaParsed && !/^[a-fA-F0-9]{64}$/.test(String(metaParsed.sha256)))
          err("Invalid SHA-256 (must be 64 hex chars)", raw.slice(0, 80));
        const hasTool = "tool" in metaParsed, hasToolSha = "tool_sha256" in metaParsed;
        if (hasTool && !hasToolSha) err("'tool' declared without 'tool_sha256' (both required together)", raw.slice(0, 80));
        if (hasToolSha && !hasTool) err("'tool_sha256' declared without 'tool' (both required together)", raw.slice(0, 80));
        if (hasToolSha && !/^[a-fA-F0-9]{64}$/.test(String(metaParsed.tool_sha256)))
          err("Invalid tool_sha256 (must be 64 hex chars)", raw.slice(0, 80));
      } catch (e) { err(`Invalid metadata JSON: ${e.message}`, raw.slice(0, 80)); }
    }
    const resolved = resolveSkillPath(url, source);
    if (!/^https?:\/\//.test(resolved)) {
      if (!existsSync(resolved)) { err(`Skill file not found: ${resolved}`, raw.slice(0, 80)); }
      else {
        if (metaParsed && metaParsed.sha256) {
          const actual = sha256NormalizedFile(resolved);
          if (actual !== metaParsed.sha256) err(`SHA-256 mismatch: declared ${metaParsed.sha256}, actual ${actual}`, raw.slice(0, 80));
        }
        if (metaParsed && metaParsed.tool && metaParsed.tool_sha256) {
          const toolResolved = resolveSkillPath(metaParsed.tool, source);
          if (!/^https?:\/\//.test(toolResolved)) {
            if (!existsSync(toolResolved)) err(`tool.js not found: ${toolResolved}`, raw.slice(0, 80));
            else {
              const actual = sha256NormalizedFile(toolResolved);
              if (actual !== metaParsed.tool_sha256) err(`tool_sha256 mismatch: declared ${metaParsed.tool_sha256}, actual ${actual}`, raw.slice(0, 80));
            }
          }
        }
        const fm = parseFrontmatter(readFileSync(resolved, "utf8"));
        if (!Object.keys(fm).length) err("Skill without valid YAML frontmatter");
        else for (const key of REQUIRED_FRONTMATTER) if (!(key in fm)) err(`Frontmatter missing '${key}'`);
      }
    }
    if (!desc || desc.length < 10) warn("Description too short", raw.slice(0, 80));
  }
  return { errors, warnings };
}

const MEMORY_CAPTURE_RE = /^<!--\s*skills-memory:\s*(.*?)\s*-->\s*$/;
function validateMemory(memJson, source, err, warn) {
  let meta;
  try { meta = JSON.parse(memJson); }
  catch (e) { err(`skills-memory: invalid JSON: ${e.message}`); return; }
  let ok = true;
  for (const key of ["snapshot", "snapshot_sha256", "format"]) {
    if (typeof meta[key] !== "string") { err(`skills-memory: missing or invalid '${key}' (must be string)`); ok = false; }
  }
  if (!ok) return;
  if (!/^[a-fA-F0-9]{64}$/.test(meta.snapshot_sha256)) err("skills-memory: invalid snapshot_sha256 (must be 64 hex chars)");
  if (meta.format !== "minimemory-okf-v1") warn(`skills-memory: format '${meta.format}' is not the only one recognized today (minimemory-okf-v1)`);
  const resolved = resolveSkillPath(meta.snapshot, source);
  if (!/^https?:\/\//.test(resolved)) {
    if (!existsSync(resolved)) err(`skills-memory: snapshot not found: ${resolved}`);
    else if (/^[a-fA-F0-9]{64}$/.test(meta.snapshot_sha256)) {
      const actual = sha256NormalizedFile(resolved);
      if (actual !== meta.snapshot_sha256) err(`skills-memory: snapshot_sha256 mismatch: declared ${meta.snapshot_sha256}, actual ${actual}`);
    }
  }
}
