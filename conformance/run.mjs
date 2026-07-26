#!/usr/bin/env node
// run.mjs — kit de conformancia ejecutable del estandar llms-txt-skills.
//
// Un runtime tercero demuestra conformancia corriendo este kit contra SI
// mismo: el kit levanta un publicador-fixture determinista en localhost y
// maneja el runtime por MCP stdio, validando cada MUST del core RFC y de la
// Executable Skills extension (v0.5). Los MUST fallan la conformancia; los
// SHOULD solo advierten.
//
// Uso:
//   node conformance/run.mjs --cmd "npx -y @rckflr/mcpwasm {origin}"
//
// {origin} se sustituye por la URL del fixture. El runtime debe hablar MCP
// por stdio (una respuesta JSON por linea). Runtimes no-MCP: --fixture-only
// escribe el fixture + expected.json en un directorio para auto-chequeo.
//
// Cero dependencias. Node 20+.

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// sha256 de los bytes EXACTOS, sin normalizar nada. Antes normalizaba CRLF->LF
// antes de digerir. Hoy eso es inocuo, porque las fixtures son literales de
// plantilla y JavaScript ya normaliza sus terminadores de linea al parsear — pero
// codificaba la interpretacion equivocada del requisito 1 justo en la herramienta
// con la que un tercero demuestra conformancia, y rompe en cuanto una fixture
// sirva CRLF a proposito, como la de C15.
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");

// ---------------------------------------------------------------------------
// Fixture publisher: cada archivo esta pensado para ejercitar un MUST.
const T_SUM = `registerTool({
  name: "c_sum",
  description: "Sum a and b.",
  inputSchema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] },
  handler(args) { return args.a + args.b; }
});`;
const T_CORRUPT = `registerTool({ name: "c_corrupt", description: "x", inputSchema: { type: "object" }, handler() { return 1; } });`;
const T_EXTERNAL = `registerTool({
  name: "c_external",
  description: "Tries to fetch OUTSIDE the publishing origin (must fail).",
  inputSchema: { type: "object" },
  handler: async function () {
    const r = await host.fetchOrigin("https://example.com/secret");
    return r.body;
  }
});`;
const T_ORIGIN = `registerTool({
  name: "c_origin",
  description: "Fetches from its own origin (must work).",
  inputSchema: { type: "object" },
  handler: async function () {
    const r = await host.fetchOrigin("/data.json");
    return JSON.parse(r.body);
  }
});`;
const T_SEARCH = `registerTool({
  name: "c_search",
  description: "Searches this scope's memory.",
  inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
  handler: async function (args) { return await host.memorySearch(args.q, 5); }
});`;
const SKILL_MD_GOOD = "---\nname: c_sum\n---\n\n# c_sum\n\nCONFORMANCE-RECIPE-MARKER: always pass both a and b.\n";
const SKILL_MD_BAD = "---\nname: c_origin\n---\n\n# tampered\n";

// Snapshot minimo VALIDO del formato minimemory-okf-v1 no es generable sin el
// engine; el kit ejercita la rama NEGATIVA de memoria (hash adulterado =>
// capability ausente, MUST fail-closed) que es la exigida por la spec, y la
// POSITIVA queda cubierta si el runtime carga c_search (la skill DEBE cargar
// aunque la memoria no este). El snapshot servido es texto arbitrario cuyo
// hash declarado NO coincide.
const FAKE_SNAPSHOT = '{"not":"a real snapshot"}';

// Fixture de C15: bytes servidos con CRLF y hash declarado sobre ESOS bytes.
// Se construye con join() a proposito — un literal de plantilla no sirve, porque
// JavaScript normaliza sus terminadores de linea al parsear.
//
// Un runtime que normalice antes de hashear calculara el hash de la version LF,
// no coincidira con lo declarado y rechazara la skill: eso es NO conformancia con
// el requisito 1 ("over the exact received bytes"), y hasta ahora ningun check lo
// detectaba. Caso real: tres implementaciones del mismo estandar discrepaban sobre
// que bytes cubre tool_sha256, y la que normalizaba pasaba este kit entero.
const T_CRLF = [
  'registerTool({',
  '  name: "c_crlf",',
  '  description: "Served with CRLF line endings.",',
  '  inputSchema: { type: "object" },',
  '  handler() { return "crlf-ok"; }',
  '});',
].join("\r\n");

function llmsTxt() {
  return `# conformance fixture

> Deterministic publisher exercising the MUSTs of llms-txt-skills.

Decoy list outside the Skills section (MUST NOT load):

- [c_decoy](/skills/decoy/tool.js): looks like a skill but is outside ## Skills. <!-- skill: ${JSON.stringify({ version: "1.0.0", tool: "/skills/decoy/tool.js", tool_sha256: sha(T_SUM) })} -->

<!-- skills-memory: ${JSON.stringify({ snapshot: "/mem.snapshot", snapshot_sha256: "f".repeat(64), format: "minimemory-okf-v1", scope: "alpha" })} -->

## Skills

- [c_sum](/skills/c_sum/SKILL.md): Sum two numbers. <!-- skill: ${JSON.stringify({ version: "1.0.0", sha256: sha(SKILL_MD_GOOD), tool: "/skills/c_sum/tool.js", tool_sha256: sha(T_SUM) })} -->
- [c_corrupt](/skills/c_corrupt/SKILL.md): Broken hash on purpose. <!-- skill: ${JSON.stringify({ version: "1.0.0", tool: "/skills/c_corrupt/tool.js", tool_sha256: "0".repeat(64) })} -->
- [c_prose](/skills/c_prose/SKILL.md): Prose-only skill (no tool declared).
- [c_external](/skills/c_external/SKILL.md): Tries to escape the origin. <!-- skill: ${JSON.stringify({ version: "1.0.0", tool: "/skills/c_external/tool.js", tool_sha256: sha(T_EXTERNAL) })} -->
- [c_origin](/skills/c_origin/SKILL.md): Fetches own origin. <!-- skill: ${JSON.stringify({ version: "1.0.0", sha256: sha(SKILL_MD_GOOD), tool: "/skills/c_origin/tool.js", tool_sha256: sha(T_ORIGIN) })} -->
- [c_search](/skills/c_search/SKILL.md): Scoped memory search (memory is tampered). <!-- skill: ${JSON.stringify({ version: "1.0.0", tool: "/skills/c_search/tool.js", tool_sha256: sha(T_SEARCH), scope: "alpha" })} -->
- [c_sum](/skills/c_sum2/SKILL.md): Same public name as line 1 (collision). <!-- skill: ${JSON.stringify({ version: "1.0.0", tool: "/skills/c_sum/tool.js", tool_sha256: sha(T_SUM) })} -->
- [c_crlf](/skills/c_crlf/SKILL.md): Served with CRLF; declared hash is of the exact bytes. <!-- skill: ${JSON.stringify({ version: "1.0.0", tool: "/skills/c_crlf/tool.js", tool_sha256: sha(T_CRLF) })} -->
- [c_badscope](/skills/x/SKILL.md): Invalid scope value. <!-- skill: ${JSON.stringify({ version: "1.0.0", tool: "/skills/c_sum/tool.js", tool_sha256: sha(T_SUM), scope: "Not A Scope" })} -->
`;
}

const ROUTES = {
  "/llms.txt": [llmsTxt, "text/plain; charset=utf-8"],
  "/skills/c_sum/tool.js": [() => T_SUM, "application/javascript"],
  "/skills/c_sum/SKILL.md": [() => SKILL_MD_GOOD, "text/markdown"],
  "/skills/c_corrupt/tool.js": [() => T_CORRUPT, "application/javascript"],
  "/skills/c_external/tool.js": [() => T_EXTERNAL, "application/javascript"],
  "/skills/c_origin/tool.js": [() => T_ORIGIN, "application/javascript"],
  "/skills/c_origin/SKILL.md": [() => SKILL_MD_BAD, "text/markdown"], // sha declarado = del bueno => mismatch
  "/skills/c_search/tool.js": [() => T_SEARCH, "application/javascript"],
  "/skills/c_crlf/tool.js": [() => T_CRLF, "application/javascript"],
  "/skills/decoy/tool.js": [() => T_SUM, "application/javascript"],
  "/mem.snapshot": [() => FAKE_SNAPSHOT, "application/json"],
  "/data.json": [() => JSON.stringify({ conformance: true }), "application/json"],
};

// ---------------------------------------------------------------------------
// Los checks. level: "MUST" (falla) | "SHOULD" (advierte). cite: seccion.
const CHECKS = [];
const check = (id, level, cite, desc, fn) => CHECKS.push({ id, level, cite, desc, fn });

check("C01", "MUST", "core RFC §3.1", "solo se cargan skills de la seccion ## Skills (el señuelo externo NO)", (ctx) =>
  !ctx.toolNames.includes("c_decoy"));
check("C02", "MUST", "ext v0.5 §3.3", "tool_sha256 mismatch => la skill NO se carga", (ctx) =>
  !ctx.toolNames.includes("c_corrupt"));
check("C03", "MUST", "ext v0.5 §2.1", "una skill valida carga y ejecuta (c_sum(2,40) => 42)", async (ctx) =>
  (await ctx.call("c_sum", { a: 2, b: 40 })).value === 42);
check("C04", "MUST", "core RFC §3.2", "una skill de prosa (sin tool/tool_sha256) NO se expone como ejecutable", (ctx) =>
  !ctx.toolNames.includes("c_prose"));
check("C05", "MUST", "ext v0.5 §3.2 (Isolation)", "fetch fuera del origin publicador => fallo controlado, no datos", async (ctx) => {
  const r = await ctx.call("c_external", {});
  return r.isError === true || (r.value && typeof r.value === "object" && r.value.error !== undefined);
});
check("C06", "MUST", "ext v0.5 §3.2 (host.fetchOrigin)", "fetch al propio origin funciona", async (ctx) => {
  const r = await ctx.call("c_origin", {});
  return r.value && r.value.conformance === true;
});
check("C07", "MUST", "ext v0.5 §3.2 (Exposure)", "retorno primitivo => structuredContent objeto (wrap {result})", async (ctx) => {
  const r = await ctx.call("c_sum", { a: 1, b: 1 });
  return r.structured !== null && typeof r.structured === "object" && !Array.isArray(r.structured);
});
check("C08", "MUST", "ext v0.5 §2.5 (scopes)", "skill con scope se expone como <scope>__<name>", (ctx) =>
  ctx.toolNames.includes("alpha__c_search") && !ctx.toolNames.includes("c_search"));
check("C09", "MUST", "ext v0.5 §2.5", "scope invalido => la linea NO se carga", (ctx) =>
  !ctx.toolNames.includes("c_badscope") && !ctx.toolNames.some((n) => n.includes("Not A Scope")));
check("C10", "MUST", "ext v0.5 §2.5", "colision de nombre publico => una sola instancia (gana la primera)", (ctx) =>
  ctx.toolNames.filter((n) => n === "c_sum").length === 1);
check("C11", "MUST", "ext v0.5 §2.4 (origin memory)", "snapshot con hash adulterado => capability AUSENTE, fallo controlado (fail-closed)", async (ctx) => {
  if (!ctx.toolNames.includes("alpha__c_search")) return false; // la skill debe cargar igual
  const r = await ctx.call("alpha__c_search", { q: "anything" });
  return r.isError === true || (r.value && r.value.error !== undefined);
});
check("C12", "SHOULD", "ext v0.5 §2.2 (recipes)", "la receta SKILL.md verificada se sirve como resource skill://<name>", async (ctx) => {
  const uris = await ctx.listResourceUris();
  return uris.includes("skill://c_sum");
});
check("C13", "SHOULD", "ext v0.5 §2.2", "receta con sha256 mismatch se OMITE pero su tool carga igual", async (ctx) => {
  const uris = await ctx.listResourceUris();
  return !uris.includes("skill://c_origin") && ctx.toolNames.includes("c_origin");
});
check("C15", "MUST", "ext v0.5 §3.3 / §4.1", "bytes tal cual se sirven: skill con CRLF y hash de los bytes exactos CARGA (el runtime NO normaliza)", async (ctx) => {
  if (!ctx.toolNames.includes("c_crlf")) return false;
  const r = await ctx.call("c_crlf", {});
  return !r.isError && r.value === "crlf-ok";
});

check("C14", "MUST", "ext v0.5 §3.2 (Exposure)", "tool inexistente => error controlado, no crash del runtime", async (ctx) => {
  const r = await ctx.call("no_such_tool_xyz", {});
  if (!(r.isError === true || r.rpcError)) return false;
  const again = await ctx.call("c_sum", { a: 20, b: 22 }); // sigue vivo
  return again.value === 42;
});

// ---------------------------------------------------------------------------
// Driver MCP stdio generico.
function makeDriver(child) {
  const pending = [];
  const waiting = [];
  let buf = "";
  child.stdout.on("data", (d) => {
    buf += String(d);
    let i;
    while ((i = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line || !line.startsWith("{")) continue;
      const w = waiting.shift();
      if (w) w(line);
      else pending.push(line);
    }
  });
  let id = 0;
  const request = (method, params) => {
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: ++id, method, ...(params ? { params } : {}) }) + "\n");
    if (pending.length) return Promise.resolve(JSON.parse(pending.shift()));
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error("timeout esperando " + method)), 120000);
      waiting.push((l) => { clearTimeout(t); res(JSON.parse(l)); });
    });
  };
  return { request };
}

// ---------------------------------------------------------------------------
async function main() {
  const argv = process.argv.slice(2);
  let cmd = null;
  let fixtureOnly = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--cmd") cmd = argv[++i];
    else if (argv[i] === "--fixture-only") fixtureOnly = argv[++i];
  }

  if (fixtureOnly) {
    mkdirSync(fixtureOnly, { recursive: true });
    for (const [route, [body]] of Object.entries(ROUTES)) {
      const p = join(fixtureOnly, route.slice(1).replace(/\//g, "_"));
      writeFileSync(p, body(), "utf8");
    }
    writeFileSync(join(fixtureOnly, "expected.json"), JSON.stringify({
      note: "Autochequeo para runtimes no-MCP: sirva estos archivos con sus rutas originales y valide los comportamientos listados.",
      checks: CHECKS.map(({ id, level, cite, desc }) => ({ id, level, cite, desc })),
    }, null, 2) + "\n", "utf8");
    console.log("fixture + expected.json escritos en " + fixtureOnly);
    return 0;
  }

  if (!cmd || !cmd.includes("{origin}")) {
    console.error('Uso: node conformance/run.mjs --cmd "<comando con {origin}>"');
    console.error('     node conformance/run.mjs --fixture-only <dir>   (runtimes no-MCP)');
    return 2;
  }

  const server = createServer((req, res) => {
    const route = ROUTES[new URL(req.url, "http://x").pathname];
    if (!route) { res.writeHead(404); res.end("nf"); return; }
    res.writeHead(200, { "content-type": route[1] });
    res.end(route[0]());
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  console.log(`fixture publisher: ${origin}`);

  const full = cmd.replace("{origin}", origin);
  console.log(`runtime bajo prueba: ${full}\n`);
  // stderr del runtime: se CAPTURA en todas las plataformas y se muestra cuando
  // hace falta (fallo de MUST, o error duro como un timeout). Antes iba a
  // "inherit" en Unix y se DESCARTABA en Windows, asi que un runtime que fallaba
  // la conformancia no dejaba nada con que diagnosticar en la plataforma donde
  // mas problemas de este tipo aparecen — y en Unix se mezclaba en vivo con las
  // lineas de los checks, sin quedar asociado al fallo.
  const child = spawn(full, [], { shell: true, stdio: ["pipe", "pipe", "pipe"] });
  const errChunks = [];
  let errBytes = 0;
  const ERR_CAP = 64 * 1024; // suficiente para diagnosticar, sin volcar un log entero
  child.stderr.on("data", (d) => {
    if (errBytes >= ERR_CAP) return;
    errBytes += d.length;
    errChunks.push(d.toString());
  });
  const runtimeStderr = () => {
    const t = errChunks.join("").trimEnd();
    if (!t) return "  (el runtime no escribio nada en stderr)";
    const lines = t.split(/\r?\n/);
    const shown = lines.slice(-40);
    return (lines.length > shown.length ? `  … (${lines.length - shown.length} lineas previas omitidas)\n` : "") +
      shown.map((l) => "  " + l).join("\n") +
      (errBytes >= ERR_CAP ? "\n  … (truncado a " + ERR_CAP + " bytes)" : "");
  };
  const drv = makeDriver(child);

  // contexto que ven los checks. Si el runtime no contesta (se cayo al arrancar,
  // rechazo todas las skills, no habla MCP por stdio...) el kit moria con un stack
  // trace de SU propio timeout, que no dice nada del runtime bajo prueba.
  let listed;
  try {
    listed = await drv.request("tools/list");
  } catch (e) {
    console.log(`\nNOT CONFORMANT: el runtime no respondio a tools/list (${e.message}).`);
    console.log("stderr del runtime:");
    console.log(runtimeStderr());
    try { child.kill(); } catch { /* best-effort */ }
    server.close();
    return 1;
  }
  const tools = (listed.result && listed.result.tools) || [];
  const ctx = {
    toolNames: tools.map((t) => t.name),
    async call(name, args) {
      const r = await drv.request("tools/call", { name, arguments: args });
      if (r.error) return { rpcError: true };
      const res = r.result || {};
      const structured = res.structuredContent ?? null;
      let value;
      if (structured && typeof structured === "object" && "result" in structured && Object.keys(structured).length === 1) value = structured.result;
      else value = structured;
      return { isError: res.isError === true, structured, value };
    },
    async listResourceUris() {
      try {
        const r = await drv.request("resources/list");
        return ((r.result && r.result.resources) || []).map((x) => String(x.uri));
      } catch { return []; }
    },
  };

  let mustFail = 0, shouldWarn = 0, passed = 0;
  for (const c of CHECKS) {
    let ok = false;
    try { ok = await c.fn(ctx); } catch { ok = false; }
    if (ok) { passed++; console.log(`  PASS  [${c.level}] ${c.id} ${c.desc}  (${c.cite})`); }
    else if (c.level === "MUST") { mustFail++; console.log(`  FAIL  [MUST] ${c.id} ${c.desc}  (${c.cite})`); }
    else { shouldWarn++; console.log(`  WARN  [SHOULD] ${c.id} ${c.desc}  (${c.cite})`); }
  }

  child.stdin.end();
  await new Promise((r) => { child.on("exit", r); setTimeout(r, 3000); });
  server.close();

  console.log("");
  if (mustFail === 0) {
    console.log(`CONFORMANT: ${passed}/${CHECKS.length} checks (${shouldWarn} SHOULD warning(s))`);
    return 0;
  }
  console.log(`NOT CONFORMANT: ${mustFail} MUST check(s) fallidos (${shouldWarn} SHOULD warning(s))`);
  // El diagnostico del propio runtime suele decir POR QUE fallo (que skill
  // rechazo y con que hash, que capability falto). Se muestra solo al fallar:
  // en verde seria ruido.
  console.log("\nstderr del runtime (para diagnosticar):");
  console.log(runtimeStderr());
  return 1;
}

process.exit(await main());
