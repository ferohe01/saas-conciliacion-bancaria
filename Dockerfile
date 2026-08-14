# syntax=docker/dockerfile:1

# ─── 1. Dependencias ──────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ─── 2. Build ─────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

# Las NEXT_PUBLIC_* se incrustan en el bundle del navegador DURANTE el
# build: hay que pasarlas como build args, no basta con ponerlas como
# variables de entorno del contenedor.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ─── 3. Runtime ───────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
# Opcional: el commit desplegado, para que /api/health pueda decirlo. Si el
# orquestador no lo pasa, /api/health responde con el BUILD_ID, que ya distingue
# un redespliegue real de uno que no reconstruyó nada.
ARG GIT_SHA=""

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    GIT_SHA=$GIT_SHA

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# Salida `standalone`: incluye solo las deps que el server realmente usa.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# (si más adelante se añade una carpeta `public/`, copiarla también aquí)

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
