# open.blog's hosted functions as one container: notes, views and moderation (engagement), greeting
# cards, and gifts under the tree, over Postgres through PostgREST. For Railway or any Docker host;
# see docs/deploy.md "Railway". Build from the repository root:
#
#   docker build -f service/Dockerfile -t openblog-service .
#
# Needs DATABASE_URL (Postgres) and PGRST_JWT_SECRET (32+ random characters), plus each function's
# own settings (docs/deploy.md lists them). Listens on $PORT.

FROM node:22-bookworm-slim
ARG POSTGREST_VERSION=12.2.3
ARG POSTGREST_SHA256=9f71269e61ac3a940281e93ff415760f5957e430e475ba4c3889f3ede7d5527c
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client ca-certificates curl xz-utils \
    && curl -fsSL -o /tmp/postgrest.tar.xz \
       "https://github.com/PostgREST/postgrest/releases/download/v${POSTGREST_VERSION}/postgrest-v${POSTGREST_VERSION}-linux-static-x64.tar.xz" \
    && echo "${POSTGREST_SHA256}  /tmp/postgrest.tar.xz" | sha256sum -c - \
    && tar -xJf /tmp/postgrest.tar.xz -C /usr/local/bin postgrest \
    && rm /tmp/postgrest.tar.xz \
    && apt-get purge -y xz-utils && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY netlify ./netlify
COPY supabase ./supabase
COPY service ./service
COPY web/components ./web/components
RUN chmod +x service/entrypoint.sh service/migrate.sh && postgrest --version
USER node
ENV PORT=8080 NODE_ENV=production
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
    CMD curl -fsS "http://127.0.0.1:${PORT}/health" > /dev/null || exit 1
ENTRYPOINT ["/app/service/entrypoint.sh"]
