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

console.log(failures === 0 ? "\nCLI TEST: OK" : `\nCLI TEST: ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
