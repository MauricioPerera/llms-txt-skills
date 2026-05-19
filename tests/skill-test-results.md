# Resultados de prueba: skill `llms-txt-aware`

Fecha: 2026-05-19
Skill testeada: `llms-txt-aware`
Procedimiento: 6 pasos del SKILL.md aplicados manualmente

---

## Test 1: demoshop-88e.pages.dev (dominio CON llms.txt)

### Paso 1: Extraer origen
- URL objetivo: `https://demoshop-88e.pages.dev/`
- Origen: `https://demoshop-88e.pages.dev`

### Paso 2: HEAD /llms.txt
```
HTTP/1.1 200 OK
Content-Type: text/plain; charset=utf-8
```
- Estado: 200 OK
- Accion: continuar al paso 3

### Paso 3: Leer archivo COMPLETO
- Titulo: "DemoShop API"
- Tagline: "API HTTP para una tienda demo. Todos los endpoints devuelven JSON."
- Base URL: `https://demoshop-88e.pages.dev`
- Endpoints documentados: 5 (3 GET, 2 POST)
- Errores documentados: 400, 404, 405
- Cache: `max-age=300` para estaticos
- Notes for agents: ninguna seccion explicita, pero las constraints estan en el cuerpo

### Paso 4: Aplicar contenido
- El archivo dice "Sin autenticacion requerida" → no enviar Authorization
- Endpoints explicitos: `/api/products`, `/api/cart`, `/api/checkout` → no inventar paths
- Parametros documentados: `q`, `product_id`, `quantity`, `customer_name`, `email`, `address`
- Cache: POST no se cachean → comportamiento idempotente no aplica a escrituras

### Paso 5: Manejar ## Skills
- Skills encontradas: 3
  1. `product-search`: buscar productos por nombre, categoria o descripcion
  2. `cart-add`: agregar productos al carrito
  3. `checkout-complete`: completar un pedido con datos del cliente
- Todas con metadata: `{"version":"1.0.0","license":"MIT"}`
- Sin `sha256` declarado → no requiere verificacion de hash
- URLs same-origin → sin confirmacion extra requerida

### Resultado
✅ llms.txt encontrado y parseado correctamente
✅ 3 skills descubiertas
✅ Procedimiento completo exitoso

---

## Test 2: img.automators.work (dominio CON llms.txt)

### Paso 2: HEAD /llms.txt
```
HTTP/1.1 200 OK
Content-Type: text/plain; charset=utf-8
```

### Paso 3: Leer archivo COMPLETO
- Titulo: "placeholder-img"
- Tagline: "HTTP API that returns SVG placeholder images for UI mockups."
- Endpoint: `GET /{width}x{height}[?bg={hex}]`
- Parametros: `width` (int, max 4000), `height` (int, max 4000), `bg` (hex6, default cccccc)
- Response: `image/svg+xml` con texto centrado
- Cache: `max-age=31536000, immutable` → cache permanente
- Notes for agents:
  - "No rate limit beyond Cloudflare's platform default."
  - "Stateless. Safe to call in loops."
  - "The API has no other paths. Do not attempt authentication, search, or listing endpoints."

### Paso 5: Manejar ## Skills
- Skills encontradas: 1
  - `placeholder`: generate SVG placeholder image URLs for UI mockups via this API.
- Metadata: `{"version":"1.0.0","license":"MIT"}`

### Resultado
✅ llms.txt encontrado y parseado correctamente
✅ 1 skill descubierta
✅ Notes for agents explicitas y claras

---

## Test 3: google.com (dominio SIN llms.txt)

### Paso 2: HEAD /llms.txt
```
HTTP/1.1 404 Not Found
Content-Type: text/html; charset=UTF-8
```

### Accion
- Cachear "no llms.txt" para google.com
- Seguir flujo normal sin skills

### Resultado
✅ Fail open funcionando: el agente no se bloquea, sigue con herramientas locales

---

## Conclusiones

| Dominio | llms.txt | Skills | Resultado |
|---|---|---|---|
| demoshop-88e.pages.dev | 200 OK | 3 | ✅ Descubrimiento exitoso |
| img.automators.work | 200 OK | 1 | ✅ Descubrimiento exitoso |
| google.com | 404 | 0 | ✅ Fail open correcto |

La skill `llms-txt-aware` funciona correctamente cuando se aplica manualmente. El cuello de botella sigue siendo la adopcion por parte de los runtimes: sin esta skill cargada como system prompt o tool, el agente no ejecuta el procedimiento automaticamente.

---

## Observaciones

1. **Link header no aparece en HEAD de llms.txt**: el `Link: </llms.txt>; rel="llms.txt"` solo se envia en responses de API, no en el propio llms.txt. Esto es consistente con el RFC §5.1 Mechanism A (el header es para que el agente lo reciba en requests previos, no en el llms.txt mismo).

2. **Content-Type inconsistente**: demoshop envia `text/plain`, img.automators.work no muestra Content-Type en el body (pero el contenido es markdown). La skill acepta ambos, lo cual es correcto.

3. **Cache headers**: ambos dominios usan Cloudflare. demoshop tiene `max-age=0, must-revalidate` (desarrollo). img.automators.work no muestra cache headers en llms.txt pero los endpoints tienen `immutable`.
