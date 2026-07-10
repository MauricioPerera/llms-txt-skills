// freshness.mjs — signed knowledge freshness (RAG-OKF v2, "vigencia").
//
// Port of ccdd/examples/okf-integration (check_freshness.py + attest_vigencia.py),
// kept WIRE-COMPATIBLE with that Python tooling: same signed message
// `vigencia:{concept}:{content_sha256}:{attested_at}:{valid_until}`, same raw-hex
// ed25519 keys/signatures, same bundle-root files (freshness.yaml,
// attestations.json, reviewers.json). An attestation signed by either toolchain
// verifies in the other.
//
// Three distinct signals, honestly separated:
//   - content hashes (publish) say "not tampered";
//   - age vs TTL (freshness.yaml) says "recent" — a PROXY, age != truth;
//   - a SIGNED human attestation says "still true", bound to the exact
//     content sha (voided by any edit) and expiring at valid_until
//     (re-affirmable without touching content). The machine binds, verifies
//     and expires; the human judges.
//
// NOTE on hashing: content_sha256 here is over the RAW file bytes (no CRLF
// normalization) for compatibility with the Python reference. On Windows,
// git autocrlf can rewrite *.md on checkout and spuriously void attestations —
// pin your bundle's markdown as `*.md text eol=lf` (or -text) in .gitattributes.

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { createHash, createPublicKey, createPrivateKey, sign as cryptoSign, verify as cryptoVerify } from "node:crypto";
import { privateKeyFromSeed } from "./core.mjs";

const RESERVED = new Set(["index.md", "log.md"]);
const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function sha256RawFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function vigenciaMsg(concept, contentSha, on, until) {
  return Buffer.from(`vigencia:${concept}:${contentSha}:${on}:${until}`, "utf8");
}

export function signVigenciaHex(privHex, msgBuf) {
  const seed = Buffer.from(privHex.trim(), "hex");
  if (seed.length !== 32) throw new Error("private key must be 32 raw ed25519 bytes in hex");
  return cryptoSign(null, msgBuf, privateKeyFromSeed(seed)).toString("hex");
}

export function verifyVigenciaHex(pubHex, msgBuf, sigHex) {
  try {
    const raw = Buffer.from(String(pubHex), "hex");
    if (raw.length !== 32) return false;
    const pub = createPublicKey({ key: Buffer.concat([SPKI_ED25519_PREFIX, raw]), format: "der", type: "spki" });
    return cryptoVerify(null, msgBuf, pub, Buffer.from(String(sigHex), "hex"));
  } catch {
    return false;
  }
}

// ---- minimal YAML subset parser for freshness.yaml --------------------------
// Supports exactly the reference file shape: top-level scalars, one-level
// nested maps (defaults/overrides), and inline lists ([A, B]). Comments and
// blank lines ignored. Anything deeper is out of scope (fail loud, not wrong).
export function parseFreshnessYaml(text) {
  const root = {};
  let current = null; // name of the open nested map
  for (const rawLine of text.split(/\r?\n/)) {
    const noComment = rawLine.replace(/(^|\s)#.*$/, "");
    if (!noComment.trim()) continue;
    const indented = /^\s/.test(noComment);
    const m = noComment.trim().match(/^("?)([^":]+)\1\s*:\s*(.*)$/);
    if (!m) throw new Error(`freshness.yaml: unsupported line: ${rawLine.trim()}`);
    const key = m[2].trim();
    let val = m[3].trim();
    if (indented) {
      if (!current) throw new Error(`freshness.yaml: indented key '${key}' outside a map`);
      root[current][key] = coerce(val);
      continue;
    }
    if (val === "") {
      root[key] = {};
      current = key;
      continue;
    }
    current = null;
    root[key] = coerce(val);
  }
  return root;

  function coerce(v) {
    if (/^\[.*\]$/.test(v)) {
      const inner = v.slice(1, -1).trim();
      return inner === "" ? [] : inner.split(",").map((s) => s.trim().replace(/^["']|["']$/g, ""));
    }
    v = v.replace(/^["']|["']$/g, "");
    if (/^-?\d+$/.test(v)) return parseInt(v, 10);
    return v;
  }
}

// ---- frontmatter timestamp --------------------------------------------------
function parseDateISO(s) {
  const m = String(s).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return isNaN(d.getTime()) ? null : d;
}
const dayDiff = (a, b) => Math.floor((a.getTime() - b.getTime()) / 86400000);

function loadFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (v.length >= 2 && ((v[0] === '"' && v.at(-1) === '"') || (v[0] === "'" && v.at(-1) === "'"))) v = v.slice(1, -1);
    fm[kv[1]] = v;
  }
  return fm;
}

function* walkMd(dir, rel = "") {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const r = rel ? rel + "/" + name : name;
    if (statSync(full).isDirectory()) yield* walkMd(full, r);
    else if (name.endsWith(".md") && !RESERVED.has(name)) yield [full, r];
  }
}

function loadJsonIf(path, label, warn) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    warn(`could not load ${label}: ${e.message}`);
    return null;
  }
}

// ---- check ------------------------------------------------------------------
// Returns { now, stale, missingRequiredTs, onStale, concepts: rows, fail }.
export function checkFreshness(bundleDir, nowISO, warn = () => {}) {
  const polPath = join(bundleDir, "freshness.yaml");
  if (!existsSync(polPath)) throw new Error(`freshness.yaml not found in ${bundleDir}`);
  const pol = parseFreshnessYaml(readFileSync(polPath, "utf8"));
  const now = parseDateISO(nowISO);
  if (!now) throw new Error("--now must be ISO (YYYY-MM-DD)");

  const defaults = pol.defaults || {};
  const overrides = pol.overrides || {};
  let onStale = pol.on_stale || "warn";
  if (onStale !== "warn" && onStale !== "abort") {
    warn(`unknown on_stale '${onStale}'; using 'warn'`);
    onStale = "warn";
  }
  const requireTs = new Set(pol.require_timestamp_for_types || []);

  const attData = loadJsonIf(join(bundleDir, "attestations.json"), "attestations.json", warn);
  const attestations = {};
  for (const a of (attData && Array.isArray(attData.attestations) ? attData.attestations : [])) {
    if (a && typeof a === "object" && a.concept) attestations[a.concept] = a;
  }
  const reviewers = loadJsonIf(join(bundleDir, "reviewers.json"), "reviewers.json", warn) || {};

  const rows = [];
  let stale = 0, missing = 0;
  for (const [full, rel] of walkMd(bundleDir)) {
    const fm = loadFrontmatter(readFileSync(full, "utf8"));
    if (fm === null) continue;
    const ctype = fm.type;
    const ttl = rel in overrides ? overrides[rel] : (ctype in defaults ? defaults[ctype] : null);

    // Authoritative signal: a SIGNED human freshness attestation supersedes
    // age — honored only if the ed25519 signature verifies against a reviewer
    // registered in reviewers.json (the trust root).
    const att = attestations[rel];
    if (att !== undefined) {
      const by = att.attested_by;
      const pub = by ? reviewers[by] : undefined;
      const signedSha = att.content_sha256 || "";
      const msg = vigenciaMsg(rel, signedSha, att.attested_at || "", att.valid_until || "");
      const sigOk = typeof pub === "string" && verifyVigenciaHex(pub, msg, att.signature || "");
      if (!sigOk) {
        stale++;
        rows.push({ concept: rel, type: ctype, age_days: null, ttl_days: ttl, status: "INVALID-ATTEST", by, detail: "missing/invalid signature or unregistered reviewer" });
        continue;
      }
      if (signedSha !== sha256RawFile(full)) {
        stale++;
        rows.push({ concept: rel, type: ctype, age_days: null, ttl_days: ttl, status: "VOID-ATTEST", by, detail: "content changed since attestation; re-attest" });
        continue;
      }
      const until = att.valid_until ? parseDateISO(att.valid_until) : null;
      if (!until || now.getTime() > until.getTime()) {
        stale++;
        rows.push({ concept: rel, type: ctype, age_days: null, ttl_days: ttl, status: "EXPIRED-ATTEST", by, detail: `attestation expired ${att.valid_until || "(no valid_until)"}; re-attest` });
        continue;
      }
      rows.push({ concept: rel, type: ctype, age_days: null, ttl_days: ttl, status: "VIGENT", by, detail: `attested fresh until ${att.valid_until}` });
      continue;
    }

    const ts = fm.timestamp !== undefined ? parseDateISO(fm.timestamp) : null;
    if (!ts) {
      const sev = requireTs.has(ctype) ? "MISSING-TS" : "no-ts";
      if (sev === "MISSING-TS") missing++;
      rows.push({ concept: rel, type: ctype, age_days: null, ttl_days: ttl, status: sev });
      continue;
    }
    if (ttl === null || ttl === undefined) {
      rows.push({ concept: rel, type: ctype, age_days: dayDiff(now, ts), ttl_days: null, status: "untracked" });
      continue;
    }
    const age = dayDiff(now, ts);
    const status = age > ttl ? "STALE" : "fresh";
    if (status === "STALE") stale++;
    rows.push({ concept: rel, type: ctype, age_days: age, ttl_days: ttl, status, remaining_days: ttl - age });
  }

  return {
    now: nowISO, stale, missing_required_ts: missing, on_stale: onStale, concepts: rows,
    fail: (stale + missing) > 0 && onStale === "abort",
  };
}

// ---- attest -----------------------------------------------------------------
// Signs and upserts one freshness attestation into <bundle>/attestations.json.
export function attestVigencia({ bundleDir, concept, by, on, until, keyPath, note = "" }) {
  const root = resolve(bundleDir);
  const target = resolve(root, concept);
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error(`'${concept}' must live inside the bundle`);
  }
  if (!existsSync(target)) throw new Error(`no such concept: ${concept}`);
  if (!parseDateISO(on) || !parseDateISO(until)) throw new Error("--on and --until must be ISO (YYYY-MM-DD)");

  const regPath = join(root, "reviewers.json");
  if (!existsSync(regPath)) {
    throw new Error("no reviewers.json in the bundle. Register the reviewer's raw ed25519 pubkey (hex) there first.");
  }
  const registry = JSON.parse(readFileSync(regPath, "utf8"));
  if (!(by in registry)) throw new Error(`'${by}' is not registered in reviewers.json`);
  if (!existsSync(keyPath)) throw new Error(`no such private key file: ${keyPath}`);

  const privHex = readFileSync(keyPath, "utf8").trim();
  const contentSha = sha256RawFile(target);
  const signature = signVigenciaHex(privHex, vigenciaMsg(concept, contentSha, on, until));

  // Sanity: the key must actually belong to the registered reviewer.
  if (!verifyVigenciaHex(registry[by], vigenciaMsg(concept, contentSha, on, until), signature)) {
    throw new Error(`the private key does not match the registered pubkey for '${by}'`);
  }

  const storePath = join(root, "attestations.json");
  let data = { vigencia_version: "0.2", attestations: [] };
  if (existsSync(storePath)) {
    data = JSON.parse(readFileSync(storePath, "utf8"));
    if (!data || typeof data !== "object" || !Array.isArray(data.attestations)) {
      throw new Error("attestations.json does not have the expected structure");
    }
  }
  const entry = {
    concept, content_sha256: contentSha, statement: "vigente",
    attested_by: by, attested_at: on, valid_until: until, signature, note,
  };
  data.vigencia_version = "0.2";
  data.attestations = data.attestations
    .filter((a) => !(a && typeof a === "object" && a.concept === concept))
    .concat([entry]);
  writeFileSync(storePath, JSON.stringify(data, null, 2) + "\n", "utf8");
  return entry;
}
