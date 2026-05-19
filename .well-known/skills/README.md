# .well-known/skills/ Convention

Este directorio implementa la convención `/.well-known/skills/` propuesta por Cloudflare y adoptada por Mintlify para descubrimiento de skills.

## Convención

Un agente puede probar la ruta conocida:

```
GET https://{dominio}/.well-known/skills/default/SKILL.md
```

Si existe, el agente asume que ese es el skill por defecto del dominio.

## Limitaciones

- Solo permite **un** skill por dominio (la ruta es fija).
- No permite múltiples skills ni descripciones de casos de uso.
- Requiere un probe adicional si el agente ya leyó `llms.txt`.

## Por qué coexistimos

Este repo implementa **ambas** convenciones:

1. `/.well-known/skills/default/SKILL.md` — para agentes configurados para sondear paths conocidos.
2. `## Skills` en `llms.txt` — para descubrimiento co-ubicado, multi-skill, y sin probes adicionales.

## Recomendación

Si tu dominio tiene **una sola skill**, implementa ambas.
Si tu dominio tiene **múltiples skills**, `llms.txt` con `## Skills` es la única opción estándar.
