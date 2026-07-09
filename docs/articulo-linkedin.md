# Cómo enseñar a un agente de IA a usar tu sitio web: la propuesta llms.txt Skills

> **Versión accesible del RFC v0.8** — para desarrolladores, product managers, y cualquier persona que quiera que los agentes de IA entiendan su sitio web sin montar un servidor.

---

## 1. El problema que nadie habla

### Para el lector no técnico

Imagina que acabas de abrir un restaurante. Tienes el menú, las mesas, la cocina... pero todos los asistentes personales del mundo (Siri, Alexa, Claude, ChatGPT) no saben que existes. Cuando alguien les pregunta "¿dónde como cerca de aquí?", tu restaurante no aparece porque esos asistentes no tienen una forma estandarizada de "aprender" sobre ti.

Ahora traslada eso a un sitio web. Tienes una API, un blog, una tienda... pero los agentes de IA que navegan por internet no tienen una manera sencilla de descubrir *cómo interactuar contigo*. Pueden leer tu página, sí, pero no saben que tienes una "skill" —una instrucción especializada— que les enseña exactamente qué endpoints llamar, qué parámetros usar, o cómo formatear una petición.

### Para el lector técnico

Hoy existen dos especies de documentación para agentes de IA que no se hablan:

1. **llms.txt** ([llmstxt.org](https://llmstxt.org/)): le dice al agente *qué* es tu sitio. Es un archivo estático que describes tu producto, tu API, tu filosofía.
2. **SKILL.md** ([agentskills.io](https://agentskills.io/)): le dice al agente *cómo* usar tu sitio. Es un archivo con YAML frontmatter + markdown que contiene patrones de uso, constraints, ejemplos de código.

**El gap:** llms.txt no tiene una forma estándar de decir "aquí está la skill para trabajar conmigo". Y SKILL.md vive en un URL arbitrario que el agente no conoce a menos que alguien se lo diga. Es como tener una API documentada en OpenAPI pero sin un /.well-known/openapi.json.

---

## 2. La solución en una línea

> **Añade una sección ## Skills dentro de tu llms.txt.**

Eso es todo. Una sola sección de markdown que enlaza a tus SKILL.md. El agente que ya lee tu llms.txt para entender quién eres, ahora también descubre *cómo* interactuar contigo —en el mismo documento, con un solo fetch.

```markdown
## Skills

- [placeholder](/skills/placeholder/SKILL.md): generate SVG placeholder image URLs for UI mockups. <!-- skill: {"version":"1.0.0","license":"MIT"} -->
```

---

## 3. ¿Por qué esto importa? Una analogía

### La analogía del electricista

Imagina que tu sitio web es una casa. Hoy tienes tres formas de que un electricista (el agente de IA) sepa cómo trabajar en ella:

**MCP**
- Analogía: el electricista necesita una línea directa de teléfono contigo, 24/7, con protocolos de seguridad, autenticación, y un contrato de mantenimiento.
- Problema: correcto para una fábrica. Absurdo para cambiar un bombillo.

**/.well-known/skills/**
- Analogía: dejas una copia de las instrucciones en un buzón público con una dirección fija.
- Problema: solo cabe un juego de instrucciones. Si tu casa tiene electricidad *y* plomería, solo puedes dejar uno.

**Nada**
- Analogía: el electricista lee el folleto promocional de tu casa (llms.txt) pero no sabe que existen instrucciones técnicas. Se queda adivinando dónde está el tablero.
- Problema: frustrante para ambos.

**## Skills en llms.txt** *(propuesta)*
- Analogía: el folleto promocional *incluye* una sección: "Aquí están las instrucciones técnicas para electricidad, plomería, y jardinería."
- Problema: ninguno. Una sola visita, todo descubierto, sin infraestructura extra.

### La analogía del restaurante (versión no técnica)

Vuelve al restaurante. Hoy tienes tres formas de que un asistente de IA sepa cómo reservar una mesa:

- **MCP**: El asistente necesita una conexión en tiempo real con tu sistema de reservas, con autenticación OAuth2, webhooks, y un proceso persistente. Es lo correcto para una cadena hotelera global. Es un caos para un café de barrio.
- **/.well-known/skills/**: Dejas un único PDF con instrucciones en un buzón público. Solo puedes dejar *uno*. Si además ofreces catering para eventos, no hay espacio.
- **Nada**: El asistente lee tu página web, ve que tienes mesas, pero no sabe si aceptas reservas por WhatsApp, teléfono, o app propia. Intuye. A veces acierta, a veces inventa.
- **## Skills en llms.txt**: Tu página web dice, en una sección estandarizada: "Tengo tres skills: reserva de mesa, pedido para llevar, y catering para eventos. Aquí están los enlaces a cada instrucción." El asistente lo lee todo de una vez, le pregunta al usuario qué quiere, y ejecuta la correcta.

---

## 4. La propuesta técnica, paso a paso

### 4.1 Sintaxis

La sección ## Skills vive dentro del llms.txt que ya sirves en la raíz de tu dominio. Su sintaxis es markdown puro, con metadatos inline opcionales:

```markdown
## Skills

- [skill-name](https://example.com/skills/skill-name/SKILL.md): description of when to use this skill.
- [bundle-name](https://example.com/skills/bundle-name.zip): description. <!-- skill: {"version":"1.0.0"} -->
```

**Reglas:**

1. El heading debe ser exactamente ## Skills (case-insensitive).
2. Cada item sigue la convención de link estándar de llms.txt: - [title](URL): description.
3. La URL debe resolver a:
   - Un SKILL.md raw (text/markdown), o
   - Un archivo .zip o .tar.gz que contenga SKILL.md en la raíz.
4. La skill debe ser un Agent Skill válido (YAML frontmatter + cuerpo markdown).
5. Preferentemente same-origin. Cross-origin requiere confirmación extra del usuario.
6. Metadatos inline opcionales en HTML comment JSON (<!-- skill: {...} -->).

### 4.2 Metadatos inline

El HTML comment al final de cada línea permite declarar versión, hash de integridad, licencia, y dependencias sin romper la legibilidad del markdown:

```markdown
- [pay-with-x402](/skills/x402/SKILL.md): make x402 payments. <!-- skill: {"version":"1.2.0","sha256":"abc123…","license":"MIT"} -->
```

**Claves reconocidas:**

- version: SemVer de la skill.
- sha256: Hash SHA-256 del contenido del SKILL.md (con normalización CRLF→LF).
- requires: Versión mínima del agente runtime.
- license: Licencia SPDX (MIT, Apache-2.0, etc.).
- homepage: URL del proyecto.

### 4.3 Flujo de descubrimiento

```
1. Agente encuentra el dominio (URL o instrucción del usuario)
2. Busca https://dominio/llms.txt
3. Parsea la sección ## Skills
4. Muestra skills disponibles al usuario
5. El usuario aprueba explícitamente
6. Agente descarga SKILL.md (verifica sha256 si existe)
7. Carga y cachea según HTTP cache semantics
```

**Paso 5 es obligatorio.** Los agentes NO deben auto-instalar skills sin aprobación explícita del usuario.

---

## 5. Comparativa honesta con las alternativas

**Requiere servidor corriendo**
- MCP: Sí
- A2A: Sí
- /.well-known/skills/: No
- ## Skills en llms.txt: No

**Funciona en sitios estáticos**
- MCP: No
- A2A: No
- /.well-known/skills/: Sí
- ## Skills en llms.txt: Sí

**Múltiples skills por dominio**
- MCP: Sí
- A2A: Sí
- /.well-known/skills/: No (solo una)
- ## Skills en llms.txt: Sí

**Descubrimiento co-ubicado con llms.txt**
- MCP: No
- A2A: No
- /.well-known/skills/: No
- ## Skills en llms.txt: Sí

**Sin infraestructura extra**
- MCP: No
- A2A: No
- /.well-known/skills/: Sí
- ## Skills en llms.txt: Sí

**Complejidad de implementación**
- MCP: Alta
- A2A: Alta
- /.well-known/skills/: Baja
- ## Skills en llms.txt: Baja

**Adecuado para**
- MCP: Integraciones complejas y stateful
- A2A: Agent-to-agent communication
- /.well-known/skills/: Sitios con una sola skill
- ## Skills en llms.txt: Cualquier sitio estático o API

**Esta propuesta NO reemplaza MCP ni A2A.** Es la capa de descubrimiento para el caso simple: "mi sitio tiene una API, aquí está la skill para usarla".

---

## 6. Implementación de referencia viva

[img.automators.work](https://img.automators.work) es un sitio real, en producción, que implementa esta propuesta. Es un Cloudflare Pages static site —sin servidor, sin proceso persistente, sin autenticación.

### Estructura del repo

```
llms-txt-skills/
├── llms.txt                          # Especificación del API + sección ## Skills
├── README.md                         # Documentación humana
├── .gitignore
├── docs/
│   └── rfc-skills-in-llms-txt.md     # RFC completo (v0.8)
├── scripts/
│   ├── parse_llms_txt_skills.py      # Parser de referencia en Python
│   └── validate.py                   # Validador de llms.txt y skills
├── schema/
│   └── llms-txt-skills.schema.json   # JSON Schema para la salida del parser
├── skills/
│   ├── placeholder/SKILL.md          # Skill #1: generar URLs de placeholder
│   └── api-client/SKILL.md           # Skill #2: patrones de consumo HTTP
└── .well-known/skills/default/
    └── SKILL.md                      # Compatibilidad con convención Cloudflare/Mintlify
```

### La skill placeholder en detalle

Este es el contenido real de skills/placeholder/SKILL.md:

````yaml
---
name: placeholder
description: Generate SVG placeholder images for UI mockups via the placeholder-img HTTP API. Use when the user asks for placeholder images, mockup assets, or dummy images with specific dimensions and colors.
version: 1.0.0
license: MIT
homepage: https://img.automators.work
---

# placeholder

Build URLs for the placeholder-img API to embed mockup images in HTML, CSS, or design prototypes.

## When to use

- User asks for a placeholder image of size W×H.
- User is prototyping a UI and needs a dummy <img> source.
- User wants a colored block of a known aspect ratio as a background.

Do NOT use this skill for production images, photography, or when the user wants real content.

## Base URL

```
https://img.automators.work
```

## Build the URL

```
{base}/{width}x{height}[?bg={hex6}]
```

- width, height: integers in px, each ≤ 4000.
- bg (optional): 6-digit hex without #. Defaults to cccccc.

## Examples

- Generic 400×300 placeholder: https://img.automators.work/400x300
- Dark-blue banner: https://img.automators.work/1200x400?bg=1e3a5f

## Output the agent should produce

When the user asks for a placeholder in HTML context, emit:

```html
<img src="https://img.automators.work/{W}x{H}{?bg}" alt="{W}×{H} placeholder" width="{W}" height="{H}">
```

## Constraints

- Stateless, no auth, no rate limit beyond Cloudflare platform default.
- Responses are immutable and cached one year.
- There are no endpoints other than /{W}x{H}. Do not invent paths.

## Failure modes

- If width or height is not an integer, the API returns HTTP 400.
- If bg is not a 6-digit hex, the SVG is still returned but with the default gray background.
````

### Parser de referencia

El script scripts/parse_llms_txt_skills.py extrae la sección ## Skills y devuelve JSON estructurado:

```bash
python scripts/parse_llms_txt_skills.py ./llms.txt --resolve
```

Salida:

```json
{
  "source": "./llms.txt",
  "skills": [
    {
      "title": "placeholder",
      "url": "https://img.automators.work/skills/placeholder/SKILL.md",
      "description": "generate SVG placeholder image URLs for UI mockups via this API.",
      "metadata": {
        "version": "1.0.0",
        "license": "MIT",
        "sha256": "f427124e22c7bfc3d45271081e2d5eff3b1f9d740f9685748f9d4abd99dd03df"
      }
    }
  ],
  "count": 1
}
```

### Validador de referencia

El script scripts/validate.py verifica:

- Que llms.txt tenga una sección ## Skills bien formada.
- Que cada skill referenciada exista y tenga YAML frontmatter válido.
- Que los metadatos inline sean JSON válido.
- Que los archivos de skill locales existan y resuelvan correctamente. (Para URLs remotas, la verificación de contenido y dominio es responsabilidad del agente runtime).
- Que el hash sha256 declarado coincida con el contenido real.

```bash
python scripts/validate.py ./llms.txt
```

---

## 7. Casos de uso reales

### Caso 1: API de imágenes placeholder (ya en producción)

https://img.automators.work/llms.txt → descubre la skill "placeholder" → el agente genera URLs correctas para mockups sin inventar endpoints.

### Caso 2: Blog con guía de estilo

Un blog técnico publica una skill content-style que enseña al agente cómo citar artículos, qué formato de fecha usar, y cómo referenciar autores. El blog vive en GitHub Pages (100 % estático).

### Caso 3: API con lectura y escritura separadas

Una API SaaS publica dos skills:

- api-read: endpoints públicos de consulta.
- api-write: endpoints autenticados de creación y modificación.

El usuario elige cuál usar. El agente no asume permisos.

### Caso 4: Tienda de e-commerce

Una tienda en Shopify publica una skill product-search que le enseña al agente a usar su buscador Algolia, con filtros de categoría, precio, y disponibilidad. Sin servidor propio, solo archivos estáticos servidos desde el tema.

---

## 8. Seguridad y confianza

### Para el lector no técnico

Esta propuesta no da a los agentes de IA poder ilimitado sobre tu sitio. Es como dejar un manual de instrucciones en la entrada de tu casa: el electricista puede leerlo, pero aún necesita tu permiso para entrar. Además, el manual solo describe *tu* casa; no le da acceso a otras.

### Para el lector técnico

La propuesta incluye reglas de seguridad explícitas:

1. **Same-origin preferente.** Las skills deberían vivir en el mismo dominio que el llms.txt. URLs cross-origin requieren confirmación extra del usuario.
2. **Aprobación explícita obligatoria.** El agente no debe auto-instalar skills. Debe mostrarlas al usuario y esperar un sí.
3. **Verificación de integridad.** El metadato sha256 permite al agente verificar que el SKILL.md no ha sido modificado desde que el publisher lo firmó.
4. **Least privilege.** Una skill opera dentro del scope del dominio que la publica. No puede solicitar capacidades no declaradas en su frontmatter sin re-confirmación.

---

## 9. Limitaciones conocidas (honestidad técnica)

El parser y validador de este repo son herramientas de referencia, no producción lista. Estos son los límites documentados:

1. **Parser YAML frontmatter:** maneja solo pares key: value planos. No soporta listas, objetos anidados, ni multi-line strings (|, >).
2. **Regex de URLs:** soporta un nivel de paréntesis balanceados, pero no múltiples niveles ni caracteres de escape complejos.
3. **Sub-headings dentro de ## Skills:** un heading de nivel 3 (### ...) dentro de la sección se adjunta a la descripción del item anterior.
4. **Verificación sha256:** para skills locales, el validador compara el hash contra el contenido del archivo (con normalización CRLF→LF). Para URLs remotas, la verificación sigue siendo responsabilidad del agente runtime.
5. **Sincronización .well-known/skills/default/SKILL.md:** es una copia manual. No hay mecanismo automático de sincronización; edits unilaterales generan drift.

---

## 10. Cómo adoptar esto hoy

### Paso 1: Crea tu llms.txt (si no lo tienes)

Es un archivo markdown en la raíz de tu dominio que describe quién eres.

### Paso 2: Escribe tu(s) SKILL.md

Sigue la especificación de [agentskills.io](https://agentskills.io/): YAML frontmatter + markdown.

### Paso 3: Añade la sección ## Skills

```markdown
## Skills

- [mi-skill](/skills/mi-skill/SKILL.md): qué hace esta skill y cuándo usarla. <!-- skill: {"version":"1.0.0","license":"MIT"} -->
```

### Paso 4: Sube todo a tu host estático

GitHub Pages, Cloudflare Pages, Netlify, Vercel... cualquiera sirve.

### Paso 5: (Opcional) Implementa /.well-known/skills/default/SKILL.md

Si solo tienes una skill, implementa ambas convenciones para máxima compatibilidad.

### Paso 6: Valida

```bash
python scripts/validate.py ./llms.txt
python scripts/parse_llms_txt_skills.py ./llms.txt --resolve
```

---

## 11. Preguntas abiertas (el RFC es un draft)

1. ¿Debería llms.txt crecer secciones paralelas ## MCP y ## Agents, convirtiéndose en el documento único de descubrimiento de agentes para un dominio?
2. ¿Qué modelo de confianza para skills cross-origin? ¿Deshabilitarlas, permitirlas con confirmación elevada, o permitirlas libremente?
3. ¿.zip como único formato de bundle, o mantener .tar.gz?
4. ¿Es suficiente sha256 o se necesita un esquema de firma (sigstore, Web Bot Auth)?
5. ¿Debería este RFC recomendar explícitamente servir *ambas* convenciones (## Skills + .well-known) para máxima compatibilidad?

---

## 12. Estado del ecosistema y expectativas realistas

Hoy, la mayoría de los agentes de IA leen llms.txt solo cuando el usuario les da una URL explícita. El descubrimiento proactivo, automático, de fondo, no ocurre aún.

Esto **no es un defecto de la propuesta**. MCP, A2A, y /.well-known/skills/ enfrentan el mismo problema: todos requieren que el agente *sepa* que el sitio existe antes de descubrirlo.

**Lo que esta propuesta añade, incluso hoy:** cuando un agente sí encuentra un sitio —por instrucción del usuario, una URL en contexto, o un resultado de búsqueda— una sección ## Skills le da una señal inequívoca, machine-readable, de que existen skills especializadas. Eso es más de lo que cualquier sitio puede expresar hoy a través de llms.txt solo.

A medida que los runtimes de agentes evolucionen hacia un descubrimiento web más proactivo, la sección ## Skills provee la primitiva de declaración que esos sistemas necesitarán.

---

## 13. Licencia y adopción

MIT — este estándar y su implementación de referencia son de dominio público para su adopción. No hay gatekeeper. No hay marketplace que aprobar. Es un git push.

**Autor:** [automators.work](https://automators.work)
**RFC:** v0.8 (2026-06-02)
**Repo:** [github.com/MauricioPerera/llms-txt-skills](https://github.com/MauricioPerera/llms-txt-skills)
**Implementación viva:** [img.automators.work](https://img.automators.work)

---

*¿Tienes un sitio estático con una API que los agentes de IA no saben cómo usar? Añade tres líneas a tu llms.txt y deja de ser invisible.*
