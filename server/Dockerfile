# ---- Build stage ----
FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# ---- Production stage ----
FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

RUN mkdir -p data && \
    addgroup -g 1001 -S orpheus && \
    adduser -u 1001 -S orpheus -G orpheus && \
    chown -R orpheus:orpheus /app

USER orpheus

EXPOSE 3000

CMD ["node", "--experimental-sqlite", "dist/index.js"]
