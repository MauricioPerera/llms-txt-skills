# llms.txt Skills Specification

> Draft v0.4 — Especificación para publicar y consumir Agent Skills a través de `llms.txt`.

---

## TL;DR — ¿Qué es esto?

Un estándar de dos caras:

1. **Publisher**: cualquier sitio web puede anunciar skills descargables añadiendo una sección `## Skills` a su `llms.txt`. No requiere servidor, proceso persistente, ni autenticación.
2. **Consumer**: cualquier agente puede descubrir esas skills automáticamente consultando `/llms.txt` antes de interactuar con un dominio. Una skill de referencia (`llms-txt-aware`) documenta exactamente cómo hacerlo.

---

## El problema dual

### Para los publishers

Hoy, si eres desarrollador de un sitio web y quieres que los agentes de IA sepan cómo interactuar contigo, tus opciones son:

- **MCP**: necesitas un servidor persistente. Excesivo para un blog en GitHub Pages o una API REST simple.
- **`/.well-known/skills/`**: solo permite una skill por dominio.
- **Nada**: el agente lee `llms.txt` pero no sabe que existe una skill.

### Para los consumers (agentes)

Hoy, cuando un usuario dice "usa https://img.automators.work/", el agente:
- No busca automáticamente `/llms.txt`.
- No descubre que el sitio publica una skill `placeholder`.
- No sabe que podría delegar la tarea al servicio remoto.
- En su lugar, crea una imagen local con Python/PIL, ignorando la URL por completo.

Este es el **execution gap**: el sitio publica la skill, pero el runtime no la consume.

---

## La solución (lado publisher)

Añadir una sección `## Skills` dentro de `llms.txt`. Una sola línea de markdown por skill:

```markdown
## Skills

- [placeholder](/skills/placeholder/SKILL.md): generate SVG placeholder image URLs for UI mockups. <!-- skill: {"version":"1.0.0"} -->
```

El agente que ya leyó `llms.txt` ahora sabe que existe una skill y dónde encontrarla. El metadata inline solo lleva `version` como hint rápido. Para verificación de integridad (sha256) y metadata completa (licencia, costo), el agente consulta `/.well-known/agent-skills/index.json` si está disponible.

---

## La solución (lado consumer)

Antes de interactuar con cualquier dominio, el agente debe ejecutar este flujo:

```
1. Extraer el origen de la URL mencionada
2. HEAD /llms.txt (o leer Link header de una request previa)
3. Si 200 OK: leer el archivo COMPLETO (no solo ## Skills)
4. Aplicar constraints, endpoints, parámetros y ejemplos canónicos
5. Si existe ## Skills: listarlas al usuario y pedir opt-in
6. Si el usuario aprueba: descargar SKILL.md y seguir sus instrucciones exactas
7. Cachear por sesión
```

Implementamos este flujo como skill de referencia: [`llms-txt-aware`](skills/llms-txt-aware/SKILL.md).

### ¿Por qué usar la skill `llms-txt-aware`?

| Sin la skill | Con la skill |
|---|---|
| Usuario: "Crea imagen verde en img.automators.work" → agente crea PNG local con PIL | Usuario: "Crea imagen verde en img.automators.work" → agente busca `/llms.txt` → descubre skill `placeholder` → genera URL correcta `/600x50?bg=22c55e` |
| Usuario: "Busca teclados en demoshop" → agente abre browser sin saber qué hacer | Usuario: "Busca teclados en demoshop" → agente busca `/llms.txt` → descubre `product-search` → sabe exactamente qué endpoint llamar |
| Cada sitio requiere investigación manual | Un solo procedimiento cubre cualquier dominio |

La skill no inventa protocolos: usa lo que el sitio publica. Si el sitio no tiene `llms.txt`, falla silenciosamente y sigue con herramientas locales.

---

## ¿Por qué usar este estándar?

### Para publishers (developers)

| Antes | Después |
|---|---|
| "Mi API existe pero los agentes no saben cómo usarla" | "Añadí 3 líneas a mi `llms.txt` y cualquier agente compatible puede descubrir la skill" |
| "Necesito mantener un servidor MCP" | "No necesito nada, es un sitio estático" |
| "La skill vive en un marketplace externo" | "La skill vive en mi repo, se despliega con mi API" |
| "Solo puedo publicar una skill" | "Puedo publicar tantas como necesite" |

### Para consumers (agentes / runtimes)

| Antes | Después |
|---|---|
| Cada sitio requiere código custom o prompting manual | Un solo procedimiento (`llms-txt-aware`) cubre cualquier dominio |
| URLs en prompts se interpretan como decorativas | URLs en prompts disparan descubrimiento automático de skills |
| No sabemos qué versión de la skill usar | Metadatos inline indican versión; sha256 y licencia en `.well-known` |
| Sin contexto de cuándo usar la skill | La descripción del item de lista lo dice |

### Para los usuarios

| Antes | Después |
|---|---|
| "¿Cómo hago que el agente use esta API?" | El agente detecta automáticamente la skill disponible |
| Instalar skills manualmente desde marketplaces | Skills descubiertas y validadas en el momento |

---

## Comparación con soluciones actuales

| Característica | MCP | A2A | `/.well-known/skills/` | **`## Skills` en `llms.txt`** |
|---|---|---|---|---|
| Requiere servidor corriendo | Sí | Sí | **No** | **No** |
| Funciona en sitios estáticos | No | No | **Sí** | **Sí** |
| Múltiples skills por dominio | Sí | Sí | **No** | **Sí** |
| Descubrimiento co-ubicado con `llms.txt` | No | No | No | **Sí** |
| Sin infraestructura extra | No | No | Sí | **Sí** |
| Complejidad de implementación | Alta | Alta | Baja | **Baja** |
| Metadata e integridad (sha256, licencia) | N/A | N/A | No | Vía `.well-known/agent-skills/index.json` |
| Adecuado para | Integraciones complejas y stateful | Agent-to-agent | Sitios con una sola skill | **Cualquier sitio estático o API** |

**Este estándar NO reemplaza MCP ni A2A.** Es la capa de descubrimiento para el caso simple. Para metadata e integridad, se complementa con `/.well-known/agent-skills/index.json`: `## Skills` es el puntero de descubrimiento, `.well-known` es la fuente de verdad de metadatos.

---

## Implementación de referencia

Este repo contiene:

- **RFC v0.5**: especificación completa del protocolo
- **Parser y validador**: herramientas de referencia en Python
- **Generador/sincronizador**: regenera `## Skills`, la copia `.well-known` y el índice canónico desde el frontmatter de cada skill
- **Firma y verificación**: firma ed25519 de cada skill (autenticidad) y verificador independiente
- **JSON Schema**: validación estructurada de la salida del parser
- **Skills de ejemplo**: `placeholder` y `api-client` para `img.automators.work`
- **Skill de consumo**: `llms-txt-aware` para que los agentes descubran skills automáticamente
- **Consumers reales**: plugin de Claude Code, MCP server cross-runtime, y un PR nativo a aider — ver [estado de adopción](docs/adoption.md)
- **Benchmark empírico**: harness que mide el uso correcto de skills baseline vs discovery — ver [evals/](evals/README.md)
- **Tests manuales**: resultados contra 3 dominios reales

### Estructura del repo

```
llms-txt-skills/
├── llms.txt                          # Especificación del API + sección ## Skills
├── README.md                         # Este archivo
├── .gitignore
├── docs/
│   ├── rfc-skills-in-llms-txt.md     # RFC completo (v0.5)
│   ├── adoption.md                   # Estado de adopción (consumers, trust model, hilos)
│   ├── articulo-propuesta.md         # Divulgación
│   └── articulo-linkedin.md          # Divulgación
├── scripts/
│   ├── parse_llms_txt_skills.py      # Parser de referencia
│   ├── validate.py                   # Validador de llms.txt y skills
│   ├── generate.py                   # Generador/sincronizador + firma (--check para CI)
│   ├── verify_signatures.py          # Verifica firmas ed25519 del índice
│   ├── skills-manifest.json          # Qué skills publica el dominio + config de firma
│   └── deploy-cloudflare-pages.sh    # Script de despliegue
├── schema/
│   └── llms-txt-skills.schema.json   # Schema JSON para validación
├── skills/
│   ├── placeholder/SKILL.md          # Skill de ejemplo: generador de imágenes
│   ├── api-client/SKILL.md           # Skill de ejemplo: cliente HTTP
│   └── llms-txt-aware/SKILL.md       # Skill de consumo (fuente canónica)
├── integrations/
│   └── mcp/                          # MCP server: descubrir/consumir skills en cualquier runtime MCP
├── evals/
│   ├── harness.py                    # Benchmark baseline vs discovery (adapters LM Studio/Anthropic/CF)
│   ├── scenarios.json                # Escenarios del benchmark
│   ├── results.md                    # Resultados medidos
│   └── README.md                     # Metodología
├── .claude-plugin/
│   └── marketplace.json              # Marketplace de Claude Code
├── plugins/
│   └── llms-txt-aware/               # Plugin instalable (skill generado desde la fuente)
├── tests/
│   └── skill-test-results.md         # Resultados de pruebas manuales
├── .well-known/
│   ├── skills/default/SKILL.md       # Alias de compatibilidad (generado)
│   └── agent-skills/
│       ├── index.json                # Índice canónico: metadata + sha256 + firma (generado)
│       └── signing-key.pub           # Clave pública ed25519 del publisher (generado)
└── .github/workflows/
    └── validate.yml                  # CI: valida + sincronización + firmas
```

---

## Cómo usar la skill `llms-txt-aware`

### Como plugin de Claude Code (recomendado)

Este repo es además un marketplace de Claude Code. Instalá el consumer skill en dos comandos:

```shell
/plugin marketplace add MauricioPerera/llms-txt-skills
/plugin install llms-txt-aware@llms-txt-skills
```

A partir de ahí, Claude Code activa la skill automáticamente cuando vayas a tocar un dominio web, según su `description`.

### Como system prompt

Copiá el contenido de [`skills/llms-txt-aware/SKILL.md`](skills/llms-txt-aware/SKILL.md) al system prompt de tu agente. La skill define un procedimiento de 6 pasos que el agente debe ejecutar antes de interactuar con cualquier dominio web.

### Como skill local de Codex

En Codex (OpenAI), las skills se cargan desde `~/.codex/skills/`. Copiá el directorio `llms-txt-aware/` ahí y activala en la sesión con `$llms-txt-aware`.

### Como regla de Ollama / LM Studio

Inyectá el contenido del SKILL.md como parte del system prompt del modelo. Funciona con cualquier modelo local que respete instrucciones de system prompt.

### Como tool en un runtime custom

Convertí los 6 pasos del procedimiento en una función:

```python
def discover_skills(domain: str) -> list[Skill]:
    """Busca llms.txt en el dominio y devuelve skills disponibles."""
    llms = fetch(f"{domain}/llms.txt")
    return parse_skills_section(llms)
```

El RFC §5.1 documenta 4 mecanismos de descubrimiento (HTTP Link header, DNS TXT, HTML meta tag, convention probe).

---

## Cómo adoptar el estándar en tu dominio (3 pasos)

### Paso 1: Crea tu `llms.txt`

```markdown
# Mi API

> Descripción compacta de lo que hace tu sitio.

## Endpoint

`GET https://ejemplo.com/api/recurso`

## Skills

- [mi-skill](/skills/mi-skill/SKILL.md): descripción de cuándo usar esta skill. <!-- skill: {"version":"1.0.0"} -->
```

### Paso 2: Crea tu `SKILL.md`

```markdown
---
name: mi-skill
description: Qué hace esta skill y cuándo usarla.
version: 1.0.0
license: MIT
homepage: https://ejemplo.com
---

# mi-skill

Instrucciones detalladas para el agente.
```

### Paso 3: Despliega

Sube ambos archivos a cualquier host estático. No necesitas servidor, proceso persistente, ni autenticación.

### Mantener todo sincronizado (recomendado)

En vez de editar a mano la sección `## Skills`, calcular el `sha256` y copiar el `.well-known`, declará qué skills publica el dominio en `scripts/skills-manifest.json` y dejá que el generador haga el resto:

```bash
python scripts/generate.py          # regenera ## Skills, .well-known/skills/default y .well-known/agent-skills/index.json
python scripts/generate.py --check  # falla si algo quedó desincronizado (lo usa CI)
```

El generador toma `name`, `description`, `version` y `license` del frontmatter de cada `SKILL.md`, calcula el `sha256` (CRLF→LF) y escribe las salidas de forma determinista. El step `--check` en CI garantiza que nunca haya drift entre el `SKILL.md` y lo publicado.

### Firmar las skills (autenticidad)

Si el manifest declara `signing`, el generador firma cada `SKILL.md` con ed25519 y agrega `signing_key` + `signature` al `index.json` (y escribe `signing-key.pub`). La firma es determinista (RFC 8032), así que `--check` sigue siendo idempotente.

```bash
python scripts/verify_signatures.py   # verifica las firmas contra la clave pública del publisher
```

En producción, el publisher usa `"signing": {"private_key_path": "..."}` con una clave **offline que nunca se commitea**. El repo de ejemplo usa `"demo_seed"` (clave de demo derivada de un seed público, reproducible) — **no usar en producción**. Ver el modelo de confianza completo en el RFC §4.6.

---

## Ejemplos reales de uso

### Ejemplo 1: API de imágenes placeholder

```
https://img.automators.work/llms.txt  →  descubre la skill "placeholder"
                                         →  el agente genera URLs correctas
```

### Ejemplo 2: Blog con guía de estilo

```
https://blog.ejemplo.com/llms.txt     →  descubre la skill "content-style"
                                         →  el agente sigue la guía al escribir
```

### Ejemplo 3: API con lectura y escritura separadas

```
https://api.ejemplo.com/llms.txt      →  descubre "api-read" y "api-write"
                                         →  el usuario elige cuál usar
```

### Ejemplo 4: Tienda online con carrito y checkout

```
https://demoshop-88e.pages.dev/llms.txt  →  descubre 3 skills:
                                              - product-search
                                              - cart-add
                                              - checkout-complete
                                          →  el agente busca, agrega y compra
```

Ver el flujo completo documentado en la sección [DemoShop](#demoshop--flujo-completo-probado).

---

## DemoShop — flujo completo probado

[DemoShop](https://demoshop-88e.pages.dev) es una tienda demo desplegada en Cloudflare Pages que implementa el estándar `## Skills` con 3 skills funcionales. Es un caso de uso real del **Pattern A — API wrapping** del RFC.

### Skills publicadas

| Skill | Cuándo usar | Endpoint principal |
|---|---|---|
| [product-search](https://demoshop-88e.pages.dev/skills/product-search/SKILL.md) | Buscar productos por nombre, categoría o descripción | `GET /api/products?q=...` |
| [cart-add](https://demoshop-88e.pages.dev/skills/cart-add/SKILL.md) | Agregar productos al carrito | `POST /api/cart` |
| [checkout-complete](https://demoshop-88e.pages.dev/skills/checkout-complete/SKILL.md) | Completar un pedido con datos del cliente | `POST /api/checkout` |

### Flujo simulado de compra

```
PASO 1: Descubrimiento
  GET https://demoshop-88e.pages.dev/llms.txt
  → Parsea ## Skills, encuentra 3 skills disponibles
  → Pide opt-in al usuario para activarlas

PASO 2: Búsqueda
  GET https://demoshop-88e.pages.dev/api/products?q=bluetooth
  → {"products": [{"id":1, "name":"Auriculares Bluetooth", "price":29.99}]}
  → Agente elige producto ID 1

PASO 3: Carrito
  POST https://demoshop-88e.pages.dev/api/cart
  Body: {"product_id": 1, "quantity": 2}
  → {"success": true, "message": "Agregado 2 x producto #1 al carrito"}

PASO 4: Checkout
  POST https://demoshop-88e.pages.dev/api/checkout
  Body: {"customer_name":"Ana Lopez","email":"ana@ejemplo.com","address":"Av. Revolucion 456, CDMX"}
  → {"success": true, "order_id": "ORD-MPCWLKHZ", "status": "confirmado"}
```

### Código fuente del demo

```
llms-shop-demo/
├── index.html                  # Frontend
├── api/products.json           # Catálogo (8 productos)
├── functions/                  # Cloudflare Pages Functions
│   ├── api/products/index.js
│   ├── api/products/[id].js
│   ├── api/cart.js
│   └── api/checkout.js
├── llms.txt                    # Espec API + ## Skills
└── skills/
    ├── product-search/SKILL.md
    ├── cart-add/SKILL.md
    └── checkout-complete/SKILL.md
```

### Lecciones del demo

- **Sin autenticación:** el flujo completo funciona stateless, sin sesiones ni tokens.
- **Skills atómicas:** cada operación tiene su propia skill. El agente puede usarlas individualmente o en secuencia.
- **Sin servidor MCP:** todo corre como archivos estáticos + functions serverless.

---

## Limitaciones conocidas

El parser y validador de este repo son **herramientas de referencia**, no producción lista.

1. **Parser YAML frontmatter:** maneja solo pares `key: value` planos. No soporta listas, objetos anidados, ni multi-line strings (`|`, `>`).

2. **Regex de URLs:** soporta un nivel de paréntesis balanceados, pero no múltiples niveles.

3. **Sub-headings dentro de `## Skills`:** un heading `### ...` dentro de la sección se adjunta a la descripción del item anterior. El RFC asume una lista plana.

4. **Verificación `sha256`:** el validador compara hash contra contenido real para paths locales (con normalización CRLF→LF). Para URLs remotas, la verificación sigue siendo responsabilidad del agente runtime.

5. **Modelo de confianza:** el `sha256` da **integridad** (no cambió en tránsito) pero no **autenticidad** — lo asevera el mismo documento que apunta a la skill. Para autenticidad el repo implementa firma ed25519 sobre una clave offline + key-pinning del lado del agente (RFC §4.6). Esto defiende contra un servidor comprometido sin la clave privada, pero no contra el robo de la clave offline; para provenance ligado a identidad, el RFC recomienda firma keyless con transparency log (Sigstore), que requiere red para verificar.

---

## Licencia

MIT — este estándar y su implementación de referencia son de dominio público para su adopción.
