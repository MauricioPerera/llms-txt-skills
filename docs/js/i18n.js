// docs/js/i18n.js — EN/ES/PT dictionary + apply/detect logic for the landing
// page. Pure progressive enhancement: the HTML already contains the English
// (default) text as its literal content, so a client with JS disabled (or
// this script failing to load) sees the same fully-formed English page as
// before — this file only SWAPS text after the fact, never gates visibility.
//
// Technical terms are left untranslated on purpose, consistently across the
// three languages: llms.txt, SKILL.md, MCP, A2A, sha256, ed25519, RFC.
//
// Keys marked in TRANSLATIONS with a "__html" suffix are applied via
// innerHTML (their value legitimately contains inline markup — <code>, <a>,
// <strong> — authored entirely by this file, never from user input); every
// other key is applied via textContent.
(function () {
  "use strict";

  var TRANSLATIONS = {
    en: {
      "common.copy": "Copy",
      "common.copied": "Copied",

      "meta.title": "llms.txt Skills — teach any agent how to use your site, no server required",
      "meta.description": "Add a `## Skills` section to your llms.txt and any agent that already reads it discovers, verifies, and uses your published Agent Skills. Zero infrastructure, sha256 + ed25519 verified.",

      "hero.h1": "Teach any agent how to use your site. No server required.",
      "hero.lede": "llms.txt already tells agents WHAT your site is. This adds a standard way to say HOW to use it: a `## Skills` section pointing at your SKILL.md files — discovered, verified, and used with explicit opt-in.",
      "hero.ctaTry": "See the format",
      "hero.ctaGithub": "View on GitHub",
      "hero.ctaRfc": "Read the RFC",

      "problem.h2": "Two ecosystems that don't talk to each other",
      "problem.lede": "llms.txt tells an agent what your site is. Agent Skills (SKILL.md) tell it how to use it. Today there is no standard way for a site to say \"here is the skill for working with me\" — so an agent that reads your llms.txt has no signal a skill even exists.",
      "problem.typicalH3": "Without this standard",
      "problem.typicalLi1": "Agent reads llms.txt, sees prose about your API",
      "problem.typicalLi2": "No signal that a SKILL.md exists or where",
      "problem.typicalLi3": "Agent invents a generic call and gets it wrong",
      "problem.newLi1": "One `## Skills` section, same llms.txt fetch",
      "problem.newLi2": "Agent discovers title, description, and URL",
      "problem.newLi3": "Verified by sha256 (and ed25519 if signed), then used",

      "how.h2": "How it works",
      "how.lede": "Four steps. The user's opt-in is never skipped.",
      "how.svgTitle": "A publisher's llms.txt lists ## Skills; the agent shows them to the user, the user opts in, and the agent fetches and verifies the SKILL.md before using it.",
      "how.boxPublisherTitle": "Publisher site",
      "how.boxPublisherSub1": "static: GitHub Pages, R2, any host",
      "how.boxPublisherSub2": "serves /llms.txt + /skills/*/SKILL.md",
      "how.boxAgentTitle": "Agent",
      "how.boxAgentSub1": "Claude, Cursor, any MCP-aware runtime",
      "how.boxAgentSub2": "parses ## Skills, verifies sha256",
      "how.boxUserTitle": "User",
      "how.boxUserSub1": "sees the skill list",
      "how.boxUserSub2": "opt-in is mandatory, never automatic",
      "how.step1": "llms.txt + ## Skills",
      "how.step2": "list skills, ask opt-in",
      "how.step3": "approve",
      "how.step4": "fetch + verify SKILL.md",
      "how.list1__html": "A publisher adds a <code>## Skills</code> section to the <code>llms.txt</code> it already serves — one line of markdown per skill.",
      "how.list2__html": "An agent that reads <code>llms.txt</code> now sees the skills available and lists them to the user.",
      "how.list3__html": "The user opts in explicitly. Agents MUST NOT auto-install a skill.",
      "how.list4__html": "The agent fetches the <code>SKILL.md</code>, verifies its <code>sha256</code> (and <code>ed25519</code> signature if declared), then loads it as context.",

      "ways.h2": "Three ways to consume it today",
      "ways.lede": "All three are real and working, not roadmap.",
      "ways.pluginTag": "recommended",
      "ways.pluginP": "Install the llms-txt-aware consumer skill as a Claude Code plugin. It activates automatically whenever you're about to touch a web domain.",
      "ways.mcpTag": "any MCP runtime",
      "ways.mcpP": "A standalone MCP server exposing discover/fetch/verify as tools — for Cline, Continue, Cursor, Windsurf, or any MCP client.",
      "ways.promptTag": "any agent",
      "ways.promptP": "Copy the 6-step procedure into your agent's system prompt. No plugin system required, works with any model that follows instructions.",

      "trust.h2": "Two rings of trust",
      "trust.lede": "sha256 alone proves integrity, not authenticity — the same document that points to a skill also asserts its hash. Signing closes that gap.",
      "trust.card1H3": "Integrity — sha256",
      "trust.card1P__html": "Declared inline in <code>## Skills</code> and in <code>/.well-known/agent-skills/index.json</code>. Agents MUST verify it and refuse to load on mismatch.",
      "trust.card2H3": "Authenticity — ed25519 + key pinning",
      "trust.card2P__html": "The publisher signs each <code>SKILL.md</code> with a key kept offline. Agents pin the key per origin (TOFU) and flag a silent change across sessions.",

      "evidence.h2": "Does publishing a skill change what an agent does?",
      "evidence.lede": "Measured, not asserted — 6 local models, 7 scenarios, 3 reference sites.",
      "evidence.stat1Label": "baseline: uses the real endpoint",
      "evidence.stat1Sub": "given only the task, models mostly invent a local fallback",
      "evidence.stat2Label": "discovery: uses the real endpoint",
      "evidence.stat2Sub": "given the site's llms.txt + SKILL.md, most get it right",
      "evidence.stat3Label": "models tested locally",
      "evidence.stat3Sub": "0.5B to 9B parameters, via LM Studio",
      "evidence.stat4Label": "scenarios × sites",
      "evidence.stat4Sub": "image API, storefront, wireframe validator",
      "evidence.disclaimer__html": "Small-N proof of mechanism, not a benchmark — all 3 sites are first-party. Full methodology, caveats, and raw data in <a href=\"https://github.com/MauricioPerera/llms-txt-skills/blob/master/evals/results.md\">evals/results.md</a>.",

      "publishers.h2": "Live publishers you can consume right now",
      "publishers.lede__html": "Seven first-party origins dogfood the full stack — <code>## Skills</code>, hash-pinned BM25 knowledge, executable tools, SKILL.md recipes, signed index. The root origin is directly consumable (<code>npx -y @rckflr/mcpwasm https://mauricioperera.github.io</code>); project pages are consumed via clone + <code>--serve</code> (RFC v0.9 OQ6).",
      "publishers.root": "root origin: site_facts + the standard's own skills, live-consumable",
      "publishers.own": "this spec: 4 skills incl. a custom validator + 6-concept knowledge bundle",
      "publishers.kdd": "a real pre-existing OKF bundle, 40 concepts",
      "publishers.family": "the KDD methodology family, each publishing its own specs as searchable skills",

      "compare.h2": "Where this fits",
      "compare.lede": "This does not replace MCP or A2A — it fills the gap below them: publishing a skill for a simple API or static site, with no server to run.",
      "compare.rowServer": "Requires a running server",
      "compare.rowStatic": "Works on static sites",
      "compare.rowMulti": "Multiple skills per domain",
      "compare.rowColocated": "Co-located with llms.txt",
      "compare.rowComplexity": "Implementation complexity",
      "compare.yes": "Yes",
      "compare.no": "No",
      "compare.high": "High",
      "compare.low": "Low",
      "compare.oneOnly": "No (one only)",

      "quickstart.h2": "Adopt it in 3 steps",
      "quickstart.sub0": "The one-command way (CLI)",
      "quickstart.sub1": "1. Or add the section to your llms.txt by hand",
      "quickstart.sub2": "2. Write the SKILL.md",
      "quickstart.sub3": "3. Or install the consumer skill (Claude Code)",
      "quickstart.disclaimer__html": "The CLI (<a href=\"https://www.npmjs.com/package/@rckflr/llms-skills\"><code>@rckflr/llms-skills</code></a>) computes the sha256, syncs <code>.well-known/agent-skills/index.json</code>, and signs — so none of it is done by hand. In CI, a reusable GitHub Action (<code>uses: MauricioPerera/llms-txt-skills@master</code>) fails the build if what you serve drifts from your sources. Full guide in the <a href=\"https://github.com/MauricioPerera/llms-txt-skills#readme\">README</a>.",

      "bridge.h2": "From a static site to a live MCP server",
      "bridge.lede__html": "<a href=\"https://github.com/MauricioPerera/llms-txt-skills\">llms-txt-skills</a> is the <strong>format</strong>; <a href=\"https://github.com/MauricioPerera/mcpwasm\">mcpwasm</a> is a <strong>runtime</strong> for it. A publisher serves hash-pinned, attested skills once, the standard way — the runtime discovers, verifies, and runs each as an MCP tool. The whole contract between them is one <code>tool_sha256</code> and its attestation.",
      "bridge.svgTitle": "A static publisher site serves llms.txt skills and tool.js; mcpwasm fetches and verifies them, then exposes each as an MCP tool that a client can call, running the tool.js sandboxed.",
      "bridge.boxSiteTitle": "Static site",
      "bridge.boxSiteSub1": "llms.txt · ## Skills · tool.js",
      "bridge.boxSiteSub2": "index.json · attestations.json",
      "bridge.boxRuntimeTitle": "mcpwasm runtime",
      "bridge.boxRuntimeSub1": "gateway (Workers) or npx local",
      "bridge.boxRuntimeSub2": "verify + QuickJS sandbox",
      "bridge.boxClientTitle": "MCP client",
      "bridge.boxClientSub1": "Claude, Cursor, any MCP host",
      "bridge.boxClientSub2": "lists and calls the tools",
      "bridge.step1": "fetch + verify",
      "bridge.step2": "serve as MCP tools",
      "bridge.step3": "call tool(args)",
      "bridge.step4": "sandboxed tool.js",
      "bridge.list1__html": "A publisher serves an <code>llms.txt</code> whose <code>## Skills</code> section lists each executable skill with its <code>tool.js</code> and <code>tool_sha256</code> — mirrored in <code>/.well-known/agent-skills/index.json</code> and signed in <code>attestations.json</code>. Optionally, a hash-pinned BM25 snapshot (one <code>llms-skills memory</code> command over an OKF bundle) adds serverless search over the site's own knowledge. This is exactly what this spec defines.",
      "bridge.list2__html": "A runtime like <code>mcpwasm</code> points at that origin, fetches the <code>llms.txt</code>, and verifies every <code>tool.js</code> against its <code>tool_sha256</code> and its attestation — rejecting any mismatch <em>before</em> loading it.",
      "bridge.list3__html": "Each verified skill becomes an <strong>MCP tool</strong>, and its <code>SKILL.md</code> recipe is served alongside as an MCP <strong>resource</strong> (with a <code>get_skill_guide</code> fallback) — the agent gets the manual, not just the hammer. Claude, Cursor, any MCP host list and call it like any other tool.",
      "bridge.list4__html": "On a call, the runtime executes that <code>tool.js</code> <strong>verbatim</strong> inside a QuickJS-wasm sandbox — no network or filesystem except the host capabilities it grants (a scoped <code>fetchOrigin</code> back to the site, and search over the site's own content). The result returns to the client.",
      "bridge.takeaway__html": "Neither side has to trust the other's prose: the runtime re-derives the hash and checks the signature itself. Static hosting + a verifying runtime = an MCP server with <strong>no server to run</strong>.",

      "ecosystem.h2": "Part of a growing spec",
      "ecosystem.lede__html": "This RFC (v0.9) has two provisional extensions: <strong>Executable Skills</strong>, sandboxed <code>tool.js</code> a runtime executes verbatim instead of asking a model to improvise, and <strong>Skill Attestations</strong>, signed human review with an expiry window. Both are field-tested end-to-end in <a href=\"https://github.com/MauricioPerera/mcpwasm\">mcpwasm</a>, their reference implementation.",

      "footer.rfc": "Read the RFC",
      "footer.onboard": "Adoption status",
      "footer.license": "MIT License",
    },

    es: {
      "common.copy": "Copiar",
      "common.copied": "Copiado",

      "meta.title": "llms.txt Skills — enseñale a cualquier agente a usar tu sitio, sin servidor",
      "meta.description": "Añadí una sección `## Skills` a tu llms.txt y cualquier agente que ya lo lee descubre, verifica y usa tus Agent Skills publicadas. Cero infraestructura, verificado por sha256 + ed25519.",

      "hero.h1": "Enseñale a cualquier agente a usar tu sitio. Sin servidor.",
      "hero.lede": "llms.txt ya le dice a los agentes QUÉ es tu sitio. Esto agrega una forma estándar de decir CÓMO usarlo: una sección `## Skills` que apunta a tus SKILL.md — descubierta, verificada, y usada con opt-in explícito.",
      "hero.ctaTry": "Ver el formato",
      "hero.ctaGithub": "Ver en GitHub",
      "hero.ctaRfc": "Leer el RFC",

      "problem.h2": "Dos ecosistemas que no se hablan",
      "problem.lede": "llms.txt le dice a un agente qué es tu sitio. Agent Skills (SKILL.md) le dice cómo usarlo. Hoy no hay una forma estándar de que un sitio diga \"acá está la skill para trabajar conmigo\" — así que un agente que lee tu llms.txt no tiene ninguna señal de que exista una skill.",
      "problem.typicalH3": "Sin este estándar",
      "problem.typicalLi1": "El agente lee llms.txt, ve prosa sobre tu API",
      "problem.typicalLi2": "Ninguna señal de que exista un SKILL.md, ni dónde",
      "problem.typicalLi3": "El agente inventa una llamada genérica y se equivoca",
      "problem.newLi1": "Una sección `## Skills`, mismo fetch de llms.txt",
      "problem.newLi2": "El agente descubre título, descripción, y URL",
      "problem.newLi3": "Verificado por sha256 (y ed25519 si está firmado), y usado",

      "how.h2": "Cómo funciona",
      "how.lede": "Cuatro pasos. El opt-in del usuario nunca se saltea.",
      "how.svgTitle": "El llms.txt de un publisher lista ## Skills; el agente se las muestra al usuario, el usuario aprueba, y el agente descarga y verifica el SKILL.md antes de usarlo.",
      "how.boxPublisherTitle": "Sitio publisher",
      "how.boxPublisherSub1": "estático: GitHub Pages, R2, cualquier host",
      "how.boxPublisherSub2": "sirve /llms.txt + /skills/*/SKILL.md",
      "how.boxAgentTitle": "Agente",
      "how.boxAgentSub1": "Claude, Cursor, cualquier runtime con MCP",
      "how.boxAgentSub2": "parsea ## Skills, verifica sha256",
      "how.boxUserTitle": "Usuario",
      "how.boxUserSub1": "ve la lista de skills",
      "how.boxUserSub2": "el opt-in es obligatorio, nunca automático",
      "how.step1": "llms.txt + ## Skills",
      "how.step2": "lista skills, pide opt-in",
      "how.step3": "aprueba",
      "how.step4": "descarga + verifica SKILL.md",
      "how.list1__html": "Un publisher agrega una sección <code>## Skills</code> al <code>llms.txt</code> que ya sirve — una línea de markdown por skill.",
      "how.list2__html": "Un agente que lee <code>llms.txt</code> ahora ve las skills disponibles y se las lista al usuario.",
      "how.list3__html": "El usuario aprueba explícitamente. Los agentes NO deben auto-instalar una skill.",
      "how.list4__html": "El agente descarga el <code>SKILL.md</code>, verifica su <code>sha256</code> (y firma <code>ed25519</code> si está declarada), y lo carga como contexto.",

      "ways.h2": "Tres formas de consumirlo hoy",
      "ways.lede": "Las tres son reales y funcionan, no es roadmap.",
      "ways.pluginTag": "recomendado",
      "ways.pluginP": "Instalá la skill consumidora llms-txt-aware como plugin de Claude Code. Se activa sola cada vez que vas a tocar un dominio web.",
      "ways.mcpTag": "cualquier runtime MCP",
      "ways.mcpP": "Un servidor MCP standalone que expone descubrir/descargar/verificar como tools — para Cline, Continue, Cursor, Windsurf, o cualquier cliente MCP.",
      "ways.promptTag": "cualquier agente",
      "ways.promptP": "Copiá el procedimiento de 6 pasos al system prompt de tu agente. Sin sistema de plugins, funciona con cualquier modelo que siga instrucciones.",

      "trust.h2": "Dos anillos de confianza",
      "trust.lede": "El sha256 solo prueba integridad, no autenticidad — lo asevera el mismo documento que apunta a la skill. Firmar cierra esa brecha.",
      "trust.card1H3": "Integridad — sha256",
      "trust.card1P__html": "Declarado inline en <code>## Skills</code> y en <code>/.well-known/agent-skills/index.json</code>. Los agentes DEBEN verificarlo y rechazar la carga si no coincide.",
      "trust.card2H3": "Autenticidad — ed25519 + key pinning",
      "trust.card2P__html": "El publisher firma cada <code>SKILL.md</code> con una clave offline. Los agentes fijan la clave por origen (TOFU) y avisan si cambia en silencio entre sesiones.",

      "evidence.h2": "¿Publicar una skill cambia lo que hace un agente?",
      "evidence.lede": "Medido, no afirmado — 6 modelos locales, 7 escenarios, 3 sitios de referencia.",
      "evidence.stat1Label": "baseline: usa el endpoint real",
      "evidence.stat1Sub": "con solo la tarea, los modelos casi siempre inventan un fallback local",
      "evidence.stat2Label": "discovery: usa el endpoint real",
      "evidence.stat2Sub": "con el llms.txt + SKILL.md del sitio, la mayoría acierta",
      "evidence.stat3Label": "modelos testeados localmente",
      "evidence.stat3Sub": "de 0.5B a 9B parámetros, vía LM Studio",
      "evidence.stat4Label": "escenarios × sitios",
      "evidence.stat4Sub": "API de imágenes, tienda, validador de wireframes",
      "evidence.disclaimer__html": "Prueba de mecanismo con n chico, no un benchmark — los 3 sitios son del mismo autor. Metodología completa, salvedades, y datos crudos en <a href=\"https://github.com/MauricioPerera/llms-txt-skills/blob/master/evals/results.md\">evals/results.md</a>.",

      "publishers.h2": "Publicadores vivos que podés consumir ya",
      "publishers.lede__html": "Siete origins first-party dogfoodean el stack completo — <code>## Skills</code>, conocimiento BM25 fijado por hash, tools ejecutables, recetas SKILL.md, índice firmado. El origin raíz es consumible directo (<code>npx -y @rckflr/mcpwasm https://mauricioperera.github.io</code>); las project pages se consumen con clone + <code>--serve</code> (RFC v0.9 OQ6).",
      "publishers.root": "origin raíz: site_facts + las skills del propio estándar, consumible en vivo",
      "publishers.own": "esta spec: 4 skills (incl. un validador custom) + bundle de conocimiento de 6 conceptos",
      "publishers.kdd": "un bundle OKF real preexistente, 40 conceptos",
      "publishers.family": "la familia de metodologías KDD, cada una publicando sus propias specs como skills buscables",

      "compare.h2": "Dónde encaja esto",
      "compare.lede": "Esto no reemplaza a MCP ni A2A — llena el hueco debajo de ellos: publicar una skill para una API simple o un sitio estático, sin servidor que correr.",
      "compare.rowServer": "Requiere un servidor corriendo",
      "compare.rowStatic": "Funciona en sitios estáticos",
      "compare.rowMulti": "Múltiples skills por dominio",
      "compare.rowColocated": "Co-ubicado con llms.txt",
      "compare.rowComplexity": "Complejidad de implementación",
      "compare.yes": "Sí",
      "compare.no": "No",
      "compare.high": "Alta",
      "compare.low": "Baja",
      "compare.oneOnly": "No (solo una)",

      "quickstart.h2": "Adoptalo en 3 pasos",
      "quickstart.sub0": "La vía de un comando (CLI)",
      "quickstart.sub1": "1. O agregá la sección a tu llms.txt a mano",
      "quickstart.sub2": "2. Escribí el SKILL.md",
      "quickstart.sub3": "3. O instalá la skill consumidora (Claude Code)",
      "quickstart.disclaimer__html": "El CLI (<a href=\"https://www.npmjs.com/package/@rckflr/llms-skills\"><code>@rckflr/llms-skills</code></a>) calcula el sha256, sincroniza <code>.well-known/agent-skills/index.json</code>, y firma — nada se hace a mano. En CI, una GitHub Action reutilizable (<code>uses: MauricioPerera/llms-txt-skills@master</code>) hace fallar el build si lo que servís se desvía de tus fuentes. Guía completa en el <a href=\"https://github.com/MauricioPerera/llms-txt-skills#readme\">README</a>.",

      "bridge.h2": "De un sitio estático a un servidor MCP vivo",
      "bridge.lede__html": "<a href=\"https://github.com/MauricioPerera/llms-txt-skills\">llms-txt-skills</a> es el <strong>formato</strong>; <a href=\"https://github.com/MauricioPerera/mcpwasm\">mcpwasm</a> es un <strong>runtime</strong> para él. Un publicador sirve una vez sus skills fijadas por hash y atestadas, de la forma estándar — el runtime las descubre, verifica y ejecuta cada una como una herramienta MCP. Todo el contrato entre ambos es un <code>tool_sha256</code> y su atestación.",
      "bridge.svgTitle": "Un sitio publicador estático sirve skills de llms.txt y tool.js; mcpwasm los descarga y verifica, y luego expone cada uno como una herramienta MCP que un cliente puede invocar, ejecutando el tool.js sandboxeado.",
      "bridge.boxSiteTitle": "Sitio estático",
      "bridge.boxSiteSub1": "llms.txt · ## Skills · tool.js",
      "bridge.boxSiteSub2": "index.json · attestations.json",
      "bridge.boxRuntimeTitle": "runtime mcpwasm",
      "bridge.boxRuntimeSub1": "gateway (Workers) o npx local",
      "bridge.boxRuntimeSub2": "verificar + sandbox QuickJS",
      "bridge.boxClientTitle": "Cliente MCP",
      "bridge.boxClientSub1": "Claude, Cursor, cualquier host MCP",
      "bridge.boxClientSub2": "lista e invoca las herramientas",
      "bridge.step1": "descargar + verificar",
      "bridge.step2": "exponer como herramientas MCP",
      "bridge.step3": "invocar tool(args)",
      "bridge.step4": "tool.js sandboxeado",
      "bridge.list1__html": "Un publicador sirve un <code>llms.txt</code> cuya sección <code>## Skills</code> lista cada skill ejecutable con su <code>tool.js</code> y su <code>tool_sha256</code> — reflejado en <code>/.well-known/agent-skills/index.json</code> y firmado en <code>attestations.json</code>. Opcionalmente, un snapshot BM25 fijado por hash (un solo comando <code>llms-skills memory</code> sobre un bundle OKF) agrega búsqueda sin servidor sobre el conocimiento del propio sitio. Esto es exactamente lo que define esta spec.",
      "bridge.list2__html": "Un runtime como <code>mcpwasm</code> apunta a ese origen, descarga el <code>llms.txt</code> y verifica cada <code>tool.js</code> contra su <code>tool_sha256</code> y su atestación — rechazando cualquier discrepancia <em>antes</em> de cargarlo.",
      "bridge.list3__html": "Cada skill verificada se vuelve una <strong>herramienta MCP</strong>, y su receta <code>SKILL.md</code> se sirve al lado como <strong>resource</strong> MCP (con el fallback <code>get_skill_guide</code>) — el agente recibe el manual, no solo el martillo. Claude, Cursor o cualquier host MCP la lista e invoca como cualquier otra herramienta.",
      "bridge.list4__html": "Al invocarla, el runtime ejecuta ese <code>tool.js</code> <strong>al pie de la letra</strong> dentro de un sandbox QuickJS-wasm — sin red ni sistema de archivos salvo las capabilities que le concede el host (un <code>fetchOrigin</code> acotado de vuelta al sitio, y búsqueda sobre el propio contenido del sitio). El resultado vuelve al cliente.",
      "bridge.takeaway__html": "Ninguna de las dos partes tiene que confiar en la prosa de la otra: el runtime re-deriva el hash y verifica la firma por sí mismo. Hosting estático + un runtime que verifica = un servidor MCP <strong>sin servidor que correr</strong>.",

      "ecosystem.h2": "Parte de una spec en crecimiento",
      "ecosystem.lede__html": "Este RFC (v0.9) tiene dos extensiones provisionales: <strong>Executable Skills</strong>, un <code>tool.js</code> sandboxeado que un runtime ejecuta al pie de la letra en vez de pedirle a un modelo que improvise, y <strong>Skill Attestations</strong>, revisión humana firmada con ventana de vencimiento. Ambas están probadas de punta a punta en <a href=\"https://github.com/MauricioPerera/mcpwasm\">mcpwasm</a>, su implementación de referencia.",

      "footer.rfc": "Leer el RFC",
      "footer.onboard": "Estado de adopción",
      "footer.license": "Licencia MIT",
    },

    pt: {
      "common.copy": "Copiar",
      "common.copied": "Copiado",

      "meta.title": "llms.txt Skills — ensine qualquer agente a usar seu site, sem servidor",
      "meta.description": "Adicione uma seção `## Skills` ao seu llms.txt e qualquer agente que já o lê descobre, verifica e usa suas Agent Skills publicadas. Zero infraestrutura, verificado por sha256 + ed25519.",

      "hero.h1": "Ensine qualquer agente a usar seu site. Sem servidor.",
      "hero.lede": "O llms.txt já diz aos agentes O QUE é seu site. Isso adiciona uma forma padrão de dizer COMO usá-lo: uma seção `## Skills` apontando para seus SKILL.md — descoberta, verificada e usada com opt-in explícito.",
      "hero.ctaTry": "Ver o formato",
      "hero.ctaGithub": "Ver no GitHub",
      "hero.ctaRfc": "Ler o RFC",

      "problem.h2": "Dois ecossistemas que não conversam entre si",
      "problem.lede": "O llms.txt diz a um agente o que é seu site. Agent Skills (SKILL.md) dizem como usá-lo. Hoje não existe uma forma padrão de um site dizer \"aqui está a skill para trabalhar comigo\" — então um agente que lê seu llms.txt não tem nenhum sinal de que uma skill exista.",
      "problem.typicalH3": "Sem este padrão",
      "problem.typicalLi1": "O agente lê o llms.txt, vê prosa sobre sua API",
      "problem.typicalLi2": "Nenhum sinal de que exista um SKILL.md, ou onde",
      "problem.typicalLi3": "O agente inventa uma chamada genérica e erra",
      "problem.newLi1": "Uma seção `## Skills`, no mesmo fetch do llms.txt",
      "problem.newLi2": "O agente descobre título, descrição e URL",
      "problem.newLi3": "Verificado por sha256 (e ed25519 se assinado), e usado",

      "how.h2": "Como funciona",
      "how.lede": "Quatro passos. O opt-in do usuário nunca é pulado.",
      "how.svgTitle": "O llms.txt de um publisher lista ## Skills; o agente as mostra ao usuário, o usuário aprova, e o agente busca e verifica o SKILL.md antes de usá-lo.",
      "how.boxPublisherTitle": "Site publisher",
      "how.boxPublisherSub1": "estático: GitHub Pages, R2, qualquer host",
      "how.boxPublisherSub2": "serve /llms.txt + /skills/*/SKILL.md",
      "how.boxAgentTitle": "Agente",
      "how.boxAgentSub1": "Claude, Cursor, qualquer runtime com MCP",
      "how.boxAgentSub2": "analisa ## Skills, verifica sha256",
      "how.boxUserTitle": "Usuário",
      "how.boxUserSub1": "vê a lista de skills",
      "how.boxUserSub2": "o opt-in é obrigatório, nunca automático",
      "how.step1": "llms.txt + ## Skills",
      "how.step2": "lista skills, pede opt-in",
      "how.step3": "aprova",
      "how.step4": "busca + verifica SKILL.md",
      "how.list1__html": "Um publisher adiciona uma seção <code>## Skills</code> ao <code>llms.txt</code> que já serve — uma linha de markdown por skill.",
      "how.list2__html": "Um agente que lê <code>llms.txt</code> agora vê as skills disponíveis e as lista ao usuário.",
      "how.list3__html": "O usuário aprova explicitamente. Agentes NÃO devem auto-instalar uma skill.",
      "how.list4__html": "O agente busca o <code>SKILL.md</code>, verifica seu <code>sha256</code> (e assinatura <code>ed25519</code> se declarada), e o carrega como contexto.",

      "ways.h2": "Três formas de consumir hoje",
      "ways.lede": "As três são reais e funcionam, não é roadmap.",
      "ways.pluginTag": "recomendado",
      "ways.pluginP": "Instale a skill consumidora llms-txt-aware como plugin do Claude Code. Ela se ativa sozinha sempre que você for tocar em um domínio web.",
      "ways.mcpTag": "qualquer runtime MCP",
      "ways.mcpP": "Um servidor MCP standalone que expõe descobrir/buscar/verificar como tools — para Cline, Continue, Cursor, Windsurf, ou qualquer cliente MCP.",
      "ways.promptTag": "qualquer agente",
      "ways.promptP": "Copie o procedimento de 6 passos para o system prompt do seu agente. Sem sistema de plugins, funciona com qualquer modelo que siga instruções.",

      "trust.h2": "Dois anéis de confiança",
      "trust.lede": "O sha256 sozinho prova integridade, não autenticidade — quem afirma isso é o mesmo documento que aponta para a skill. Assinar fecha essa brecha.",
      "trust.card1H3": "Integridade — sha256",
      "trust.card1P__html": "Declarado inline em <code>## Skills</code> e em <code>/.well-known/agent-skills/index.json</code>. Os agentes DEVEM verificá-lo e recusar o carregamento se não bater.",
      "trust.card2H3": "Autenticidade — ed25519 + key pinning",
      "trust.card2P__html": "O publisher assina cada <code>SKILL.md</code> com uma chave mantida offline. Os agentes fixam a chave por origem (TOFU) e alertam sobre uma troca silenciosa entre sessões.",

      "evidence.h2": "Publicar uma skill muda o que um agente faz?",
      "evidence.lede": "Medido, não afirmado — 6 modelos locais, 7 cenários, 3 sites de referência.",
      "evidence.stat1Label": "baseline: usa o endpoint real",
      "evidence.stat1Sub": "só com a tarefa, os modelos quase sempre inventam um fallback local",
      "evidence.stat2Label": "discovery: usa o endpoint real",
      "evidence.stat2Sub": "com o llms.txt + SKILL.md do site, a maioria acerta",
      "evidence.stat3Label": "modelos testados localmente",
      "evidence.stat3Sub": "de 0,5B a 9B parâmetros, via LM Studio",
      "evidence.stat4Label": "cenários × sites",
      "evidence.stat4Sub": "API de imagens, loja, validador de wireframes",
      "evidence.disclaimer__html": "Prova de mecanismo com n pequeno, não um benchmark — os 3 sites são do mesmo autor. Metodologia completa, ressalvas e dados brutos em <a href=\"https://github.com/MauricioPerera/llms-txt-skills/blob/master/evals/results.md\">evals/results.md</a>.",

      "publishers.h2": "Publicadores ao vivo que você pode consumir agora",
      "publishers.lede__html": "Sete origins first-party fazem dogfood do stack completo — <code>## Skills</code>, conhecimento BM25 fixado por hash, tools executáveis, receitas SKILL.md, índice assinado. A origin raiz é consumível direto (<code>npx -y @rckflr/mcpwasm https://mauricioperera.github.io</code>); as project pages são consumidas com clone + <code>--serve</code> (RFC v0.9 OQ6).",
      "publishers.root": "origin raiz: site_facts + as skills do próprio padrão, consumível ao vivo",
      "publishers.own": "esta spec: 4 skills (incl. um validador custom) + bundle de conhecimento de 6 conceitos",
      "publishers.kdd": "um bundle OKF real preexistente, 40 conceitos",
      "publishers.family": "a família de metodologias KDD, cada uma publicando suas próprias specs como skills pesquisáveis",

      "compare.h2": "Onde isso se encaixa",
      "compare.lede": "Isso não substitui MCP nem A2A — preenche a lacuna abaixo deles: publicar uma skill para uma API simples ou um site estático, sem servidor para rodar.",
      "compare.rowServer": "Exige um servidor rodando",
      "compare.rowStatic": "Funciona em sites estáticos",
      "compare.rowMulti": "Múltiplas skills por domínio",
      "compare.rowColocated": "Co-localizado com llms.txt",
      "compare.rowComplexity": "Complexidade de implementação",
      "compare.yes": "Sim",
      "compare.no": "Não",
      "compare.high": "Alta",
      "compare.low": "Baixa",
      "compare.oneOnly": "Não (só uma)",

      "quickstart.h2": "Adote em 3 passos",
      "quickstart.sub0": "O caminho de um comando (CLI)",
      "quickstart.sub1": "1. Ou adicione a seção ao seu llms.txt manualmente",
      "quickstart.sub2": "2. Escreva o SKILL.md",
      "quickstart.sub3": "3. Ou instale a skill consumidora (Claude Code)",
      "quickstart.disclaimer__html": "O CLI (<a href=\"https://www.npmjs.com/package/@rckflr/llms-skills\"><code>@rckflr/llms-skills</code></a>) calcula o sha256, sincroniza <code>.well-known/agent-skills/index.json</code>, e assina — nada é feito manualmente. No CI, uma GitHub Action reutilizável (<code>uses: MauricioPerera/llms-txt-skills@master</code>) faz o build falhar se o que você serve divergir das suas fontes. Guia completo no <a href=\"https://github.com/MauricioPerera/llms-txt-skills#readme\">README</a>.",

      "bridge.h2": "De um site estático a um servidor MCP ativo",
      "bridge.lede__html": "<a href=\"https://github.com/MauricioPerera/llms-txt-skills\">llms-txt-skills</a> é o <strong>formato</strong>; <a href=\"https://github.com/MauricioPerera/mcpwasm\">mcpwasm</a> é um <strong>runtime</strong> para ele. Um publicador serve uma vez suas skills fixadas por hash e atestadas, da forma padrão — o runtime as descobre, verifica e executa cada uma como uma ferramenta MCP. Todo o contrato entre os dois é um <code>tool_sha256</code> e sua atestação.",
      "bridge.svgTitle": "Um site publicador estático serve skills de llms.txt e tool.js; o mcpwasm os baixa e verifica, e então expõe cada um como uma ferramenta MCP que um cliente pode chamar, executando o tool.js isolado.",
      "bridge.boxSiteTitle": "Site estático",
      "bridge.boxSiteSub1": "llms.txt · ## Skills · tool.js",
      "bridge.boxSiteSub2": "index.json · attestations.json",
      "bridge.boxRuntimeTitle": "runtime mcpwasm",
      "bridge.boxRuntimeSub1": "gateway (Workers) ou npx local",
      "bridge.boxRuntimeSub2": "verificar + sandbox QuickJS",
      "bridge.boxClientTitle": "Cliente MCP",
      "bridge.boxClientSub1": "Claude, Cursor, qualquer host MCP",
      "bridge.boxClientSub2": "lista e chama as ferramentas",
      "bridge.step1": "baixar + verificar",
      "bridge.step2": "expor como ferramentas MCP",
      "bridge.step3": "chamar tool(args)",
      "bridge.step4": "tool.js isolado",
      "bridge.list1__html": "Um publicador serve um <code>llms.txt</code> cuja seção <code>## Skills</code> lista cada skill executável com seu <code>tool.js</code> e seu <code>tool_sha256</code> — espelhado em <code>/.well-known/agent-skills/index.json</code> e assinado em <code>attestations.json</code>. Opcionalmente, um snapshot BM25 fixado por hash (um único comando <code>llms-skills memory</code> sobre um bundle OKF) adiciona busca sem servidor sobre o conhecimento do próprio site. É exatamente o que esta spec define.",
      "bridge.list2__html": "Um runtime como <code>mcpwasm</code> aponta para essa origem, baixa o <code>llms.txt</code> e verifica cada <code>tool.js</code> contra seu <code>tool_sha256</code> e sua atestação — rejeitando qualquer divergência <em>antes</em> de carregá-lo.",
      "bridge.list3__html": "Cada skill verificada vira uma <strong>ferramenta MCP</strong>, e sua receita <code>SKILL.md</code> é servida ao lado como <strong>resource</strong> MCP (com o fallback <code>get_skill_guide</code>) — o agente recebe o manual, não só o martelo. Claude, Cursor ou qualquer host MCP a lista e chama como qualquer outra ferramenta.",
      "bridge.list4__html": "Ao chamá-la, o runtime executa esse <code>tool.js</code> <strong>ao pé da letra</strong> dentro de um sandbox QuickJS-wasm — sem rede nem sistema de arquivos exceto as capabilities que o host concede (um <code>fetchOrigin</code> restrito de volta ao site, e busca sobre o próprio conteúdo do site). O resultado volta ao cliente.",
      "bridge.takeaway__html": "Nenhum dos lados precisa confiar na prosa do outro: o runtime re-deriva o hash e verifica a assinatura por conta própria. Hospedagem estática + um runtime que verifica = um servidor MCP <strong>sem servidor para rodar</strong>.",

      "ecosystem.h2": "Parte de uma spec em crescimento",
      "ecosystem.lede__html": "Este RFC (v0.9) tem duas extensões provisórias: <strong>Executable Skills</strong>, um <code>tool.js</code> isolado que um runtime executa ao pé da letra em vez de pedir a um modelo que improvise, e <strong>Skill Attestations</strong>, revisão humana assinada com janela de validade. Ambas são testadas de ponta a ponta no <a href=\"https://github.com/MauricioPerera/mcpwasm\">mcpwasm</a>, sua implementação de referência.",

      "footer.rfc": "Ler o RFC",
      "footer.onboard": "Status de adoção",
      "footer.license": "Licença MIT",
    },
  };

  var SUPPORTED = ["en", "es", "pt"];
  var STORAGE_KEY = "llmstxt-lang";

  function detectLang() {
    try {
      var saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved && SUPPORTED.indexOf(saved) !== -1) return saved;
    } catch {
      // localStorage unavailable (private mode, disabled): fall through to browser detection.
    }
    var langs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || "en"];
    for (var i = 0; i < langs.length; i++) {
      var prefix = String(langs[i]).slice(0, 2).toLowerCase();
      if (SUPPORTED.indexOf(prefix) !== -1) return prefix;
    }
    return "en";
  }

  function t(lang, key) {
    var dict = TRANSLATIONS[lang] || TRANSLATIONS.en;
    return Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : TRANSLATIONS.en[key];
  }

  // Aplica el idioma: recorre [data-i18n], setea textContent o innerHTML segun
  // el sufijo "__html" de la key (ese sufijo NUNCA se muestra: solo decide el
  // metodo de asignacion). Actualiza tambien <html lang>, document.title, y
  // meta[name=description].
  function applyLang(lang) {
    document.documentElement.setAttribute("lang", lang);
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      var key = el.getAttribute("data-i18n");
      var isHtml = key.slice(-6) === "__html";
      var value = t(lang, key);
      if (value === undefined) return;
      if (isHtml) el.innerHTML = value;
      else el.textContent = value;
    });
    var titleText = t(lang, "meta.title");
    if (titleText) document.title = titleText;
    var descEl = document.querySelector('meta[name="description"]');
    var descText = t(lang, "meta.description");
    if (descEl && descText) descEl.setAttribute("content", descText);
    try {
      window.localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // best-effort: switching still works within this page load without storage.
    }
  }

  // Construye el selector de idioma (fixed, esquina superior derecha) y lo
  // inyecta via JS: si este script no corre, no aparece ningun control
  // no-funcional en el no-JS baseline.
  function buildSwitcher(current) {
    var wrap = document.createElement("div");
    wrap.className = "lang-switch";
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", "Language");
    SUPPORTED.forEach(function (code) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = code.toUpperCase();
      btn.setAttribute("aria-pressed", String(code === current));
      if (code === current) btn.classList.add("is-active");
      btn.addEventListener("click", function () {
        applyLang(code);
        wrap.querySelectorAll("button").forEach(function (b) {
          var active = b === btn;
          b.classList.toggle("is-active", active);
          b.setAttribute("aria-pressed", String(active));
        });
      });
      wrap.appendChild(btn);
    });
    document.body.appendChild(wrap);
  }

  function init() {
    var lang = detectLang();
    applyLang(lang);
    buildSwitcher(lang);
  }

  window.LLMSTXT_I18N = { init: init, t: t, applyLang: applyLang, detectLang: detectLang };
})();
