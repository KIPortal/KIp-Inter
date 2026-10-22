# Imagen del portal KIp. La misma imagen sirve para pruebas (Railway, Fly.io) y para el servidor de la empresa.
FROM node:20-bookworm-slim

# Prisma necesita OpenSSL para hablar con PostgreSQL
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

COPY . .
RUN npx prisma generate && npm run build:assets && npm prune --omit=dev

# Archivos que deben sobrevivir a un redespliegue: montar un volumen en /datos
ENV NODE_ENV=production \
    PORT=3000 \
    FOTOS_DIR=/datos/fotos-perfil \
    REGISTROS_DIR=/datos/registros/jornadas \
    GRAPH_SESION_ARCHIVO=/datos/.graph-sesion.json \
    GRAPH_ESTADO_ARCHIVO=/datos/.graph-estado.json
RUN mkdir -p /datos && chown node:node /datos
VOLUME /datos

USER node
EXPOSE 3000
CMD ["node", "server.js"]
