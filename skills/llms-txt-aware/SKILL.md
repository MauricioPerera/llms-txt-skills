---
name: llms-txt-aware
description: "Antes de fetchear, scrapear o llamar cualquier endpoint de un dominio web, buscá su archivo `/llms.txt` y, si existe, leelo COMPLETO (no solo la sección `## Skills`). Usalo como manual operativo del sitio: endpoints, parámetros, límites, ejemplos canónicos, notas para agentes y skills publicadas. Activá esta skill en cualquier `web_fetch`, llamada a API REST/GraphQL pública sin docs locales, scraping, o cuando vayas a construir una URL del sitio. No la actives para búsquedas web genéricas ni para recursos binarios."
license: MIT
---

# llms-txt-aware

Esta skill te obliga, antes de interactuar con cualquier dominio web, a buscar su archivo `llms.txt` y usarlo como fuente de verdad. El archivo entero es contexto operativo, no solo la sección `## Skills`.

## Cuándo activar

Activá esta skill cada vez que vayas a:

- Hacer un `web_fetch` o request HTTP a un dominio que todavía no chequeaste en esta conversación.
- Llamar una API REST/GraphQL pública sin documentación local previa.
- Scrapear contenido HTML de un sitio.
- Construir una URL del sitio (paths, endpoints, querystrings, headers).
- Inferir el comportamiento esperado de un servicio remoto.

No la actives para:

- Búsquedas web genéricas (`web_search`).
- Dominios que ya chequeaste y cacheaste en este mismo turno.
- Recursos binarios directos (imágenes, PDFs, descargas).
- Sitios que ya tenés documentados localmente (docs en el repo del usuario, OpenAPI a mano, etc).

## Procedimiento

### Paso 1: extraer el origen

Dado una URL objetivo como `https://demo.ejemplo.com/api/x/y?z=1`, el origen es `https://demo.ejemplo.com`. Trabajá siempre a nivel de origen, no de path.

### Paso 2: probar el `/llms.txt`

Hacé `GET {origen}/llms.txt` con timeout corto (5 a 10 segundos).

Estados posibles y qué hacer con cada uno:

- `200 OK` con `Content-Type: text/markdown`, `text/plain` o body que empieza con `# `: seguir al paso 3.
- `200 OK` pero el body es HTML (la SPA devuelve el index): tratarlo como 404, no existe llms.txt real.
- `404`, `403`, `5xx`, timeout, o redirect que termina en HTML: cachear "no llms.txt" para este origen y seguir tu flujo normal.

Fallback opcional: si el principal devuelve `404`, probá una sola vez `{origen}/.well-known/llms.txt`. Si tampoco está, cortás ahí.

### Paso 3: leer el archivo COMPLETO

Esto es lo crítico. NO te limites a la sección `## Skills`. El archivo entero es manual del sitio. Tenés que extraer y usar:

- `# Título` y `> tagline`: identidad y propósito del sitio.
- Secciones de endpoints, paths, métodos HTTP, headers requeridos.
- Parámetros con sus tipos, si son obligatorios u opcionales, defaults y límites.
- Respuestas esperadas: códigos HTTP, content-types, forma del payload.
- Cache, rate limits, política de retry.
- Ejemplos canónicos de URLs y bodies.
- Constraints explícitos: paths que NO existen, endpoints que NO hay que llamar.
- Notas para agentes (suelen aparecer como `## Notes for agents`, `## For LLMs`, `## Agent guidance`).
- Sección `## Skills` si está, para descubrir skills publicadas (ver paso 5).

### Paso 4: aplicar el contenido al request real

Reemplazá tus suposiciones por lo que dice el archivo. Reglas duras:

- Si el archivo dice "no auth", no intentes pasar tokens ni headers de Authorization.
- Si lista endpoints explícitos, no inventes paths que no estén ahí.
- Si pone límites (ejemplo: `width max 4000`), respetalos al construir el request.
- Si advierte "do not attempt search, listing, or authentication endpoints", no los pruebes.
- Si da ejemplos canónicos, usá esos como template antes de improvisar.
- Si especifica `Cache-Control: immutable`, asumí idempotencia: la misma URL siempre devuelve lo mismo, podés llamarla en loop sin miedo.
- Si hay rate limits, respetá la cadencia.

Cuando el llms.txt contradice tu intuición, gana el llms.txt. Es el dueño del sitio diciéndote cómo usarlo.

### Paso 5: manejar la sección `## Skills` si existe

Formato esperado por entrada (RFC v0.2):

```
- [title](URL): description <!-- skill: {"version":"...","license":"...","sha256":"..."} -->
```

Procedimiento:

1. Listale al usuario las skills encontradas con título, descripción y versión.
2. Pedile opt-in EXPLÍCITO antes de cargar cualquiera. Nunca auto-instales.
3. Si el usuario aprueba una skill, hacé `GET` a su URL.
4. Si el metadata inline trae `sha256`, calculá el hash del contenido descargado y compará. Si no coincide, descartá la skill y avisale al usuario.
5. Una vez validada, cargá ese SKILL.md como contexto adicional para la tarea actual.
6. Same-origin preferido. Si la URL de la skill apunta a otro dominio, pedí confirmación extra antes de cargarla.

### Paso 6: cache de sesión

Cacheá el resultado por origen durante toda la conversación:

- Origen + "tiene llms.txt" + contenido parseado, o
- Origen + "no tiene llms.txt".

No vuelvas a fetchear el mismo origen en el mismo turn. Si el usuario aclara que el sitio cambió, invalidás y reintentás.

## Formato esperado del llms.txt

Markdown plano siguiendo el estándar de llmstxt.org. Estructura mínima:

```
# Nombre del sitio o API

> Tagline breve, una línea.

## Sección con info útil
... contenido en prosa, listas, tablas o bloques de código ...

## Otra sección
... más contenido ...

## Skills (opcional, según RFC v0.2)
- [skill-id](/skills/skill-id/SKILL.md): cuándo usar esta skill. <!-- skill: {"version":"1.0.0","license":"MIT"} -->
```

El parser de referencia que respeta este formato está en `scripts/parse_llms_txt_skills.py` del repo de la spec.

## Reglas duras

1. **Same-origin first**: skills y recursos referenciados deberían ser del mismo origen que el llms.txt. Cross-origin requiere confirmación extra del usuario.
2. **No auto-instalar skills**: las skills publicadas siempre requieren opt-in explícito.
3. **Verificar sha256 si está**: si el metadata inline trae hash, validá antes de cargar.
4. **Fail open**: si el llms.txt no existe, no carga, o está mal formado, seguí el flujo normal. La skill no debe bloquear la tarea.
5. **El archivo completo es contexto**: nunca te limites a una sola sección.
6. **Re-chequear al cambiar de origen**: si la tarea salta a otro dominio, repetir el flujo desde el paso 1 para ese nuevo origen.

## Antipatrones

- Hacer requests a un sitio nuevo sin chequear primero si tiene `/llms.txt`.
- Parsear solo `## Skills` e ignorar el resto del archivo.
- Cargar una skill referenciada sin pedir opt-in al usuario.
- Ignorar las "Notes for agents" del llms.txt y seguir tus propias suposiciones.
- Inventar paths o parámetros cuando el llms.txt ya documenta los reales.
- Re-fetchear el mismo llms.txt varias veces dentro del mismo turn.
- Asumir que el llms.txt existe sin verificarlo (no inventes contenido).

## Cómo reportarle al usuario

Cuando encontrás un `llms.txt` útil, decilo de forma corta antes de seguir con la tarea:

> Encontré `/llms.txt` en `{origen}`. Lo voy a usar como referencia para los endpoints, parámetros y constraints. Tiene `N` skills publicadas: `{lista}`. ¿Querés que cargue alguna?

Si no existe, no hace falta anunciarlo. Seguí silenciosamente con el flujo normal.

## Referencias

- Spec llms.txt Skills (RFC v0.2): https://github.com/MauricioPerera/llms-txt-skills
- Estándar original llms.txt: https://llmstxt.org
- Parser de referencia: `scripts/parse_llms_txt_skills.py` del repo de la spec.
- Validador de referencia: `scripts/validate.py` del repo de la spec.

