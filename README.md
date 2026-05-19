# llms.txt Skills Specification

> Draft v0.2 — Especificación para publicar Agent Skills a través de `llms.txt`.

---

## TL;DR — ¿Qué es esto?

Una propuesta para que cualquier sitio web pueda **anunciar skills descargables** para agentes de IA, simplemente añadiendo una sección `## Skills` a su archivo `llms.txt`. No requiere servidor, proceso persistente, ni autenticación. Solo archivos estáticos.

---

## El problema

Hoy, si eres desarrollador de un sitio web y quieres que los agentes de IA sepan cómo interactuar contigo, tus opciones son:

### Opción A: MCP (Model Context Protocol)

Necesitas correr un proceso persistente (un servidor MCP) con transporte (stdio, SSE, HTTP), autenticación, y mantenimiento. Esto es correcto para integraciones complejas y stateful, pero excesivo para:

- Un blog en GitHub Pages que quiere enseñar al agente cómo citar sus artículos.
- Una API REST que solo quiere que el agente sepa qué endpoints llamar.
- Un sitio estático en Cloudflare Pages que genera imágenes placeholder.

### Opción B: `/.well-known/skills/`

La convención propuesta por Cloudflare/Mintlify funciona para sitios con **una sola skill**. Pero no permite:

- Anunciar múltiples skills (ej: una para lectura, otra para escritura autenticada).
- Descubrimiento co-ubicado: el agente debe hacer un segundo request a un path conocido.
- Contexto: no hay descripción de cuándo usar cada skill.

### Opción C: Nada

El agente lee `llms.txt`, entiende qué es tu sitio, pero **no sabe que existe una skill** para trabajar contigo. El usuario tiene que descubrirla por su cuenta.

---

## La solución

Añadir una sección `## Skills` dentro de `llms.txt`. Una sola línea de markdown por skill:

```markdown
## Skills

- [placeholder](/skills/placeholder/SKILL.md): generate SVG placeholder image URLs for UI mockups. <!-- skill: {"version":"1.0.0","license":"MIT"} -->
```

Eso es todo. El agente que ya leyó `llms.txt` ahora sabe que existe una skill, dónde encontrarla, y si confiar en ella (vía metadatos inline).

---

## ¿Por qué usar esto?

### Para los que publican sitios (developers)

| Antes | Después |
|---|---|
| "Mi sitio tiene una API, pero los agentes no saben cómo usarla" | "Añadí 3 líneas a mi `llms.txt` y ahora cualquier agente compatible puede descubrir la skill" |
| "Necesito mantener un servidor MCP" | "No necesito nada, es un sitio estático" |
| "La skill vive en un marketplace externo, se desincroniza" | "La skill vive en mi repo, se despliega con mi API" |
| "Solo puedo publicar una skill" | "Puedo publicar tantas como necesite" |

### Para los agentes (runtimes)

| Antes | Después |
|---|---|
| Leen `llms.txt` pero no encuentran skills | Leen `llms.txt` y descubren skills en el mismo documento |
| Tienen que sondar `/.well-known/skills/` por separado | Un solo fetch descubre todo |
| No saben qué versión de la skill usar | Metadatos inline indican versión, licencia, hash |
| Sin contexto de cuándo usar la skill | La descripción del item de lista lo dice |

### Para los usuarios

| Antes | Después |
|---|---|
| "¿Cómo hago que el agente use esta API?" | El agente detecta automáticamente la skill disponible y te la sugiere |
| Instalar skills manualmente desde marketplaces | Skills descubiertas y validadas en el momento |

---

## Comparación con soluciones actuales

| Característica | MCP | A2A | `/.well-known/skills/` | **`## Skills` en `llms.txt`** |
|---|---|---|---|---|
| Requiere servidor corriendo | Sí | Sí | **No** | **No** |
| Funciona en sitios estáticos | No | No | **Sí** | **Sí** |
| Múltiples skills por dominio | Sí | Sí | **No** (solo una) | **Sí** |
| Descubrimiento co-ubicado con `llms.txt` | No | No | No | **Sí** |
| Sin infraestructura extra | No | No | Sí | **Sí** |
| Complejidad de implementación | Alta | Alta | Baja | **Baja** |
| Adecuado para | Integraciones complejas y stateful | Agent-to-agent communication | Sitios con una sola skill | **Cualquier sitio estático o API** |

**Este estándar NO reemplaza MCP ni A2A.** Es la capa de descubrimiento para el caso simple: "mi sitio tiene una API, aquí está la skill para usarla".

---

## Implementación de referencia

Este repo contiene una implementación viva del estándar. Puedes desplegarla en cualquier host estático.

### Estructura del repo

```
llms-txt-skills/
├── llms.txt                          # Especificación del API + sección ## Skills
├── README.md                         # Este archivo
├── .gitignore
├── docs/
│   └── rfc-skills-in-llms-txt.md     # RFC completo (v0.2)
├── scripts/
│   ├── parse_llms_txt_skills.py      # Parser de referencia
│   └── validate.py                   # Validador de llms.txt y skills
├── schema/
│   └── llms-txt-skills.schema.json   # Schema JSON para validación
├── .github/
│   └── workflows/
│       └── validate.yml              # CI: valida en cada push
├── .well-known/
│   └── skills/
│       ├── README.md
│       └── default/
│           └── SKILL.md              # Alias de compatibilidad well-known
└── skills/
    ├── placeholder/
    │   └── SKILL.md                  # Skill de ejemplo: generador de imágenes
    └── api-client/
        └── SKILL.md                  # Skill de ejemplo: cliente HTTP
```

---

## Cómo adoptar el estándar en 3 pasos

### Paso 1: Crea tu `llms.txt`

```markdown
# Mi API

> Descripción compacta de lo que hace tu sitio.

## Endpoint

`GET https://ejemplo.com/api/recurso`

## Skills

- [mi-skill](/skills/mi-skill/SKILL.md): descripción de cuándo usar esta skill. <!-- skill: {"version":"1.0.0","license":"MIT"} -->
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

Sube ambos archivos a cualquier host estático (GitHub Pages, Cloudflare Pages, Netlify, Vercel, S3, etc.). No necesitas servidor, proceso persistente, ni autenticación.

---

## Reglas del estándar

1. El heading de la sección debe ser exactamente `## Skills` (case-insensitive).
2. Cada entrada sigue el formato de link estándar de `llms.txt`: `- [title](URL): description`.
3. La URL debe resolver a:
   - Un `SKILL.md` raw (`text/markdown`), o
   - Un archivo `.zip` o `.tar.gz` que contenga `SKILL.md` en la raíz.
4. La skill debe ser un Agent Skill válido (YAML frontmatter + cuerpo markdown).
5. Preferentemente same-origin. Cross-origin requiere confirmación extra del usuario.
6. Metadatos inline opcionales en HTML comment JSON.

---

## Parser de referencia

Incluimos [`scripts/parse_llms_txt_skills.py`](scripts/parse_llms_txt_skills.py), un parser de referencia en Python que:

- Extrae la sección `## Skills` de cualquier `llms.txt` (URL o archivo local).
- Parsea títulos, URLs, descripciones y metadatos inline.
- Resuelve URLs relativas a absolutas.
- Devuelve JSON estructurado.

### Uso

```bash
# Desde URL
python scripts/parse_llms_txt_skills.py https://img.automators.work/llms.txt --resolve

# Desde archivo local
python scripts/parse_llms_txt_skills.py ./llms.txt --resolve
```

### Salida de ejemplo

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
        "license": "MIT"
      }
    }
  ],
  "count": 1
}
```

---

## Validador

Incluimos [`scripts/validate.py`](scripts/validate.py) que valida:

- Que `llms.txt` tenga una sección `## Skills` bien formada.
- Que cada skill referenciada exista y tenga YAML frontmatter válido.
- Que los metadatos inline sean JSON válido.
- Que las URLs resuelvan correctamente (mismo dominio).

```bash
python scripts/validate.py ./llms.txt
```

---

## Flujo de descubrimiento

```
1. Agente encuentra el dominio (URL o instrucción del usuario)
2. Busca https://dominio/llms.txt
3. Parsea la sección ## Skills
4. Muestra skills disponibles al usuario
5. El usuario aprueba explícitamente
6. Agente descarga SKILL.md (verifica sha256 si existe)
7. Carga y cachea según HTTP cache semantics
```

**Paso 5 obligatorio:** los agentes NO deben auto-instalar skills sin aprobación explícita del usuario.

---

## Compatibilidad con `.well-known/skills/`

Este repo también implementa la convención `/.well-known/skills/default/SKILL.md` propuesta por Cloudflare/Mintlify como alias de compatibilidad.

- Si tu dominio tiene **una sola skill**, implementa ambas convenciones.
- Si tu dominio tiene **múltiples skills**, `llms.txt` con `## Skills` es la única opción estándar.

Ver [`.well-known/skills/README.md`](.well-known/skills/README.md) para más detalles.

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

---

## Licencia

MIT — este estándar y su implementación de referencia son de dominio público para su adopción.
