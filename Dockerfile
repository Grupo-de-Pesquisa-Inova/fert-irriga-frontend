# ── Estágio 1: build do SPA com Bun ───────────────────────────
FROM oven/bun:1 AS builder

WORKDIR /app

# Instala dependências a partir do lockfile (camada cacheável)
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copia o restante e gera o build de produção em /app/dist
COPY . .
RUN bun run build

# ── Estágio 2: runtime com nginx ──────────────────────────────
FROM nginx:1.27-alpine

# A imagem nginx processa /etc/nginx/templates/*.template com envsubst no boot,
# substituindo apenas variáveis de ambiente definidas (ex.: ${BACKEND_URL}).
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

# Artefatos estáticos do build
COPY --from=builder /app/dist /usr/share/nginx/html

# BACKEND_URL é injetado em runtime (ex.: http://fertirriga-backend:8080)
ENV BACKEND_URL=http://fertirriga-backend:8080
# Restringe o envsubst para substituir apenas BACKEND_URL no template
ENV NGINX_ENVSUBST_FILTER=BACKEND_URL

EXPOSE 80
