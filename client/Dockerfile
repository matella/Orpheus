# ---- Build stage: Flutter web ----
FROM ghcr.io/cirruslabs/flutter:stable AS builder

# Flutter warns when run as root. Build as an unprivileged user so the SDK
# cache and the build output are not root-owned.
RUN useradd -m -u 1001 builder \
    && FLUTTER_ROOT="$(dirname "$(dirname "$(command -v flutter)")")" \
    && mkdir -p /app \
    && chown -R builder:builder "$FLUTTER_ROOT" /app

USER builder
ENV PUB_CACHE=/home/builder/.pub-cache
WORKDIR /app

COPY --chown=builder:builder pubspec.yaml pubspec.lock ./
RUN flutter pub get

COPY --chown=builder:builder . .
RUN flutter build web --release \
    --dart-define=API_BASE_URL=/api \
    --dart-define=WS_BASE_URL=/ws

# ---- Production stage: nginx ----
FROM nginx:1.27-alpine

COPY --from=builder /app/build/web /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
