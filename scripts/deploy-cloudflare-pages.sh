#!/usr/bin/env bash
# deploy-cloudflare-pages.sh
# Script de despliegue rapido para Cloudflare Pages.
# Asume que tienes wrangler instalado y autenticado.

set -euo pipefail

PROJECT_NAME="${1:-llms-txt-skills}"
BRANCH="${2:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)}"

echo "🚀 Desplegando a Cloudflare Pages..."
echo "   Proyecto: $PROJECT_NAME"
echo "   Rama: $BRANCH"

# Verificar que wrangler existe
if ! command -v wrangler &> /dev/null; then
    echo "❌ wrangler no encontrado. Instala con: npm install -g wrangler"
    exit 1
fi

# Verificar autenticacion
if ! wrangler whoami &> /dev/null; then
    echo "❌ No autenticado con wrangler. Ejecuta: wrangler login"
    exit 1
fi

# Desplegar directorio actual como sitio estatico
wrangler pages deploy . \
    --project-name="$PROJECT_NAME" \
    --branch="$BRANCH" \
    --commit-hash="$(git rev-parse HEAD 2>/dev/null || echo 'unknown')" \
    --commit-message="$(git log -1 --pretty=%B 2>/dev/null || echo 'manual deploy')"

echo "✅ Despliegue completado."
echo "   URL: https://$PROJECT_NAME.pages.dev"
