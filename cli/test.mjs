// test.mjs — correctness gate for the llms-skills CLI.
//
// The crown-jewel test is byte-identity: the CLI must reproduce, exactly, the
// artifacts scripts/generate.py produces (llms.txt ## Skills, index.json incl.
// ed25519 signatures, signing-key.pub) on this repo's real data — so what a
// publisher emits is what a runtime already verifies. Also exercises the real
// init → publish → validate round-trip and the keygen/sign/verify path.

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { verify as cryptoVerify, createPublicKey } from "node:crypto";
import {
  loadSkills, loadMemory, renderSkillsSection, renderSkillsMemoryLine, renderLlmsTxt,
  renderIndex, loadSigningKey, signSkills, publicKeyRawB64, generateKeyPair, privateKeyFromPem,
  signB64, validateLlmsTxt,
} from "./lib/core.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const BIN = join(HERE, "bin", "llms-skills.mjs");
const norm = (s) => s.replaceAll("\r\n", "\n");

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok  - ${name}`); }
  catch (e) { failures++; console.error(`  FAIL- ${name}\n        ${e.message}`); }
}
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg || "not equal"}\n  a=${JSON.stringify(a)?.slice(0,120)}\n  b=${JSON.stringify(b)?.slice(0,120)}`); }
function ok(v, msg) { if (!v) throw new Error(msg || "expected truthy"); }

console.log("Part 1: byte-identity with scripts/generate.py (this repo's real data)");
{
  const manifest = JSON.parse(readFileSync(join(REPO, "scripts/skills-manifest.json"), "utf8"));
  const skills = loadSkills(manifest, REPO);
  const memory = loadMemory(manifest, REPO);
  const section = renderSkillsSection(manifest, skills);
  const memLine = renderSkillsMemoryLine(memory);
  const myLlms = renderLlmsTxt(readFileSync(join(REPO, "llms.txt"), "utf8"), section, memLine);
  const pk = loadSigningKey(manifest, REPO);
  let kb64 = null;
  if (pk) { signSkills(skills, pk); kb64 = publicKeyRawB64(pk); }
  const myIndex = renderIndex(skills, kb64);

  check("llms.txt matches generate.py output", () =>
    eq(norm(myLlms), norm(readFileSync(join(REPO, "llms.txt"), "utf8")), "llms.txt drift"));
  check("index.json matches generate.py output (incl. ed25519 signatures)", () =>
    eq(norm(myIndex), norm(readFileSync(join(REPO, ".well-known/agent-skills/index.json"), "utf8")), "index.json drift"));
  check("signing-key.pub matches generate.py output", () =>
    eq(norm(kb64 + "\n"), norm(readFileSync(join(REPO, ".well-known/agent-skills/signing-key.pub"), "utf8")), "signing-key drift"));
}

console.log("\nPart 2: init -> publish -> validate round-trip (real CLI process)");
{
  const dir = join(tmpdir(), "llms-skills-test-" + Date.now());
  mkdirSync(dir, { recursive: true });
  try {
    writeFileSync(join(dir, "llms.txt"), "# Test site\n\n> A test.\n", "utf8");
    const run = (cliArgs) => execFileSync("node", [BIN, ...cliArgs], { cwd: dir, encoding: "utf8" });

    run(["init", "hello-skill"]);
    ok(existsSync(join(dir, "skills/hello-skill/SKILL.md")), "SKILL.md scaffolded");
    ok(existsSync(join(dir, "llms-skills.json")), "manifest scaffolded");
    // give the scaffolded SKILL.md a real summary + description so validate is clean
    const mf = JSON.parse(readFileSync(join(dir, "llms-skills.json"), "utf8"));
    mf.published[0].summary = "generate a friendly greeting for the given name via the /hello endpoint.";
    writeFileSync(join(dir, "llms-skills.json"), JSON.stringify(mf, null, 2) + "\n", "utf8");

    const pubOut = run(["publish"]);
    ok(/1 skill\(s\) published/.test(pubOut), "publish reported success");
    ok(existsSync(join(dir, ".well-known/agent-skills/index.json")), "index.json written");
    ok(/## Skills/.test(readFileSync(join(dir, "llms.txt"), "utf8")), "## Skills injected into llms.txt");

    check("publish --check is clean right after publish", () => {
      run(["publish", "--check"]); // throws (non-zero exit) if drift
    });
    check("validate passes on the generated llms.txt (no errors)", () => {
      const { errors } = validateLlmsTxt(join(dir, "llms.txt"), readFileSync(join(dir, "llms.txt"), "utf8"));
      eq(errors.length, 0, "validate errors: " + JSON.stringify(errors));
    });
    check("editing a SKILL.md is detected as drift by --check", () => {
      const sp = join(dir, "skills/hello-skill/SKILL.md");
      writeFileSync(sp, readFileSync(sp, "utf8") + "\nextra line changes the hash\n", "utf8");
      let threw = false;
      try { run(["publish", "--check"]); } catch { threw = true; }
      ok(threw, "--check should fail after the SKILL.md hash changed");
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log("\nPart 3: keygen / sign / verify");
{
  check("generated keypair signs and verifies over the exact bytes, with the published raw pubkey", () => {
    const { privatePem, publicB64 } = generateKeyPair();
    const priv = privateKeyFromPem(privatePem);
    const msg = Buffer.from("some SKILL.md bytes\n", "utf8");
    const sig = Buffer.from(signB64(priv, msg), "base64");
    const rawPub = Buffer.from(publicB64, "base64");
    eq(rawPub.length, 32, "raw ed25519 pubkey must be 32 bytes");
    // reconstruct an SPKI public key from the raw 32 bytes a consumer would read from index.json
    const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), rawPub]);
    const pubKey = createPublicKey({ key: spki, format: "der", type: "spki" });
    ok(cryptoVerify(null, msg, pubKey, sig), "signature verifies against the published raw pubkey");
    ok(!cryptoVerify(null, Buffer.from("tampered\n"), pubKey, sig), "signature must NOT verify on tampered bytes");
  });
}

console.log("\nPart 4: memory (RAG-OKF builder) — determinism, warnings, drift");
{
  const mkFixture = (dir) => {
    mkdirSync(join(dir, "knowledge", "policies"), { recursive: true });
    writeFileSync(join(dir, "llms.txt"), "# Demo\n\n> Demo.\n", "utf8");
    writeFileSync(join(dir, "knowledge", "policies", "refunds.md"),
      "---\ntype: Policy\ntitle: Refunds policy\ndescription: Refund rules.\n---\n\n# Refunds policy\n\nCustomers can request a full refund within thirty days of purchase.\nThe original receipt is required.\n", "utf8");
    writeFileSync(join(dir, "knowledge", "shipping.md"),
      "# Shipping\n\nStandard shipping takes five business days. Express arrives in two days.\n", "utf8");
    writeFileSync(join(dir, "knowledge", "index.md"), "# Index\n", "utf8"); // reserved: must be skipped
  };
  const dirA = join(tmpdir(), "llms-mem-a-" + Date.now());
  const dirB = join(tmpdir(), "llms-mem-b-" + Date.now());
  try {
    mkFixture(dirA);
    mkFixture(dirB);
    const runIn = (dir, cliArgs) => execFileSync("node", [BIN, ...cliArgs], { cwd: dir, encoding: "utf8" });

    const outA = runIn(dirA, ["memory", "knowledge"]);
    runIn(dirB, ["memory", "knowledge"]);
    check("memory: snapshot build is byte-deterministic across independent runs", () => {
      const a = readFileSync(join(dirA, "skills-index.snapshot"), "utf8");
      const b = readFileSync(join(dirB, "skills-index.snapshot"), "utf8");
      eq(a, b, "snapshots differ between identical builds");
    });
    check("memory: reserved index.md excluded; missing-type warning surfaces", () => {
      ok(/2 concept\(s\) indexed/.test(outA), "expected exactly 2 concepts (index.md skipped)");
      // warning goes to stderr; assert via the generated list instead:
      const list = readFileSync(join(dirA, "skills", "list_concepts", "tool.js"), "utf8");
      ok(!list.includes("index.md"), "index.md leaked into the concept list");
      ok(list.includes('"type":"Documentation"'), "missing type did not default to Documentation");
    });
    check("memory: search_knowledge tool.js is the universal template (no publisher data)", () => {
      const t = readFileSync(join(dirA, "skills", "search_knowledge", "tool.js"), "utf8");
      ok(!t.includes("refunds") && !t.includes("shipping"), "universal search tool must not embed publisher content");
    });
    check("memory: publish + validate green over the generated artifacts", () => {
      runIn(dirA, ["publish"]);
      const { errors } = validateLlmsTxt(join(dirA, "llms.txt"), readFileSync(join(dirA, "llms.txt"), "utf8"));
      eq(errors.length, 0, "validate errors: " + JSON.stringify(errors));
      ok(/skills-memory/.test(readFileSync(join(dirA, "llms.txt"), "utf8")), "skills-memory line missing from llms.txt");
    });
    check("memory --check: clean right after build, drift after editing a concept", () => {
      runIn(dirA, ["memory", "knowledge", "--check"]); // must exit 0
      const cp = join(dirA, "knowledge", "policies", "refunds.md");
      writeFileSync(cp, readFileSync(cp, "utf8") + "\nA new sentence changes the snapshot.\n", "utf8");
      let threw = false;
      try { runIn(dirA, ["memory", "knowledge", "--check"]); } catch { threw = true; }
      ok(threw, "--check must fail after concept content changed");
    });
  } finally {
    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
  }
}

console.log("\nPart 5: e2e — published mcpwasm consumes the builder output (real npx)");
{
  const dir = join(tmpdir(), "llms-mem-e2e-" + Date.now());
  try {
    mkdirSync(join(dir, "knowledge"), { recursive: true });
    writeFileSync(join(dir, "llms.txt"), "# Demo\n\n> Demo.\n", "utf8");
    writeFileSync(join(dir, "knowledge", "refunds.md"),
      "---\ntype: Policy\ntitle: Refunds\n---\n\nCustomers can request a full refund within thirty days of purchase.\n", "utf8");
    execFileSync("node", [BIN, "memory", "knowledge"], { cwd: dir, encoding: "utf8" });
    execFileSync("node", [BIN, "publish"], { cwd: dir, encoding: "utf8" });

    const reqs = [
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search_knowledge", arguments: { q: "refund thirty days" } } },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_concept", arguments: { id: "refunds.md" } } },
    ].map((r) => JSON.stringify(r)).join("\n") + "\n";
    const isWin = process.platform === "win32";
    const out = execFileSync(isWin ? "npx.cmd" : "npx", ["-y", "@rckflr/mcpwasm@0.4.0", "--serve", dir, "--port", "8979"], {
      input: reqs, encoding: "utf8", timeout: 180000, shell: isWin,
    });
    const lines = out.trim().split("\n").map((l) => JSON.parse(l));
    check("e2e: mcpwasm verifies the snapshot and search_knowledge returns the right concept", () => {
      const hits = lines.find((l) => l.id === 1).result.structuredContent.hits;
      ok(Array.isArray(hits) && hits.length > 0 && hits[0].concept_id === "refunds.md",
        "expected refunds.md as top hit, got " + JSON.stringify(hits && hits[0]));
    });
    check("e2e: get_concept fetches the concept markdown via fetchOrigin", () => {
      const sc = lines.find((l) => l.id === 2).result.structuredContent;
      ok(sc.id === "refunds.md" && /thirty days/.test(sc.markdown), "concept markdown not returned correctly");
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log("\nPart 6: scopes (Executable Skills v0.5 §2.5) — --scope wiring + generate.py mirror");
{
  const dir = join(tmpdir(), "llms-scope-" + Date.now());
  try {
    mkdirSync(join(dir, "knowledge"), { recursive: true });
    writeFileSync(join(dir, "llms.txt"), "# Demo\n\n> Demo.\n", "utf8");
    writeFileSync(join(dir, "knowledge", "refunds.md"),
      "---\ntype: Policy\ntitle: Refunds\n---\n\nCustomers can request a full refund within thirty days of purchase.\n", "utf8");
    const runIn = (cliArgs) => execFileSync("node", [BIN, ...cliArgs], { cwd: dir, encoding: "utf8" });

    runIn(["memory", "knowledge", "--scope", "kdd"]);
    runIn(["publish"]);

    check("scope: manifest carries scope on memory and on every generated entry", () => {
      const mf = JSON.parse(readFileSync(join(dir, "llms-skills.json"), "utf8"));
      eq(mf.memory.scope, "kdd", "manifest.memory.scope");
      ok(mf.published.length === 3 && mf.published.every((e) => e.scope === "kdd"),
        "every published entry must carry scope kdd");
    });
    check("scope: llms.txt lines carry scope as the LAST key (skill + memory)", () => {
      const txt = readFileSync(join(dir, "llms.txt"), "utf8");
      ok(/"format":"minimemory-okf-v1","scope":"kdd"\}/.test(txt), "memory line: scope must be last key");
      const skillLines = txt.split(/\r?\n/).filter((l) => /<!-- skill:/.test(l));
      eq(skillLines.length, 3, "expected 3 skill lines");
      ok(skillLines.every((l) => /"tool_sha256":"[0-9a-f]{64}","scope":"kdd"\}/.test(l)),
        "each skill line: scope must follow tool_sha256");
    });
    check("scope: validate is green over the scoped output", () => {
      const { errors } = validateLlmsTxt(join(dir, "llms.txt"), readFileSync(join(dir, "llms.txt"), "utf8"));
      eq(errors.length, 0, "validate errors: " + JSON.stringify(errors));
    });
    check("scope: validate rejects an invalid scope and duplicated memory scopes", () => {
      const bad = "<!-- skills-memory: {\"snapshot\":\"/s\",\"snapshot_sha256\":\"" + "a".repeat(64) + "\",\"format\":\"minimemory-okf-v1\",\"scope\":\"KDD\"} -->\n" +
        "<!-- skills-memory: {\"snapshot\":\"https://x/s\",\"snapshot_sha256\":\"" + "a".repeat(64) + "\",\"format\":\"minimemory-okf-v1\",\"scope\":\"kdd\"} -->\n" +
        "<!-- skills-memory: {\"snapshot\":\"https://x/s2\",\"snapshot_sha256\":\"" + "b".repeat(64) + "\",\"format\":\"minimemory-okf-v1\",\"scope\":\"kdd\"} -->\n" +
        "\n## Skills\n\n- [a](https://x/SKILL.md): does something useful indeed. <!-- skill: {\"version\":\"1.0.0\",\"tool\":\"https://x/t.js\",\"tool_sha256\":\"" + "c".repeat(64) + "\",\"scope\":\"Bad Scope\"} -->\n";
      const { errors } = validateLlmsTxt("https://example.com/llms.txt", bad);
      ok(errors.some((e) => /skills-memory: invalid 'scope'/.test(e.message)), "uppercase memory scope must error");
      ok(errors.some((e) => /duplicate line for scope 'kdd'/.test(e.message)), "duplicated scope must error");
      ok(errors.some((e) => /Invalid 'scope'/.test(e.message)), "invalid skill-line scope must error");
    });
    check("scope: byte-identity with generate.py on the scoped fixture", () => {
      // Mirror harness: generate.py resolves everything from its own location
      // (scripts/ inside the publisher root), so copy it into the fixture and
      // let it re-render the SAME manifest the CLI just wired.
      mkdirSync(join(dir, "scripts"), { recursive: true });
      writeFileSync(join(dir, "scripts", "generate.py"), readFileSync(join(REPO, "scripts", "generate.py"), "utf8"), "utf8");
      const mf = JSON.parse(readFileSync(join(dir, "llms-skills.json"), "utf8"));
      // generate.py requires default_skill (name from SKILL.md frontmatter);
      // the CLI has no such concept — set it only for the mirror run.
      mf.default_skill = "search_knowledge";
      writeFileSync(join(dir, "scripts", "skills-manifest.json"), JSON.stringify(mf, null, 2) + "\n", "utf8");
      const cliLlms = norm(readFileSync(join(dir, "llms.txt"), "utf8"));
      execFileSync("python", [join(dir, "scripts", "generate.py")], { cwd: dir, encoding: "utf8" });
      const pyLlms = norm(readFileSync(join(dir, "llms.txt"), "utf8"));
      eq(pyLlms, cliLlms, "generate.py re-render must be byte-identical to the CLI output");
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(failures === 0 ? "\nCLI TEST: OK" : `\nCLI TEST: ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
