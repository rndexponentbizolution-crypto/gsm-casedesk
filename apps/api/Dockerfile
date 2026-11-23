# Build from the repository root: docker build -f apps/api/Dockerfile .
# The container applies pending migrations on start, then runs the API.

FROM node:22-bookworm-slim AS base
# Prisma's query engine needs OpenSSL.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
# npm ci checks the lockfile against every workspace, so copy all their manifests.
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
# Create the workspace's own node_modules so later COPY steps never miss it.
RUN mkdir -p apps/api/node_modules

FROM base AS build
RUN npm ci --workspace=@gsm-casedesk/api --include-workspace-root=false
COPY apps/api apps/api
RUN npm run build --workspace=@gsm-casedesk/api

FROM base AS prod-deps
RUN npm ci --workspace=@gsm-casedesk/api --include-workspace-root=false --omit=dev
COPY apps/api/prisma apps/api/prisma
COPY apps/api/prisma.config.ts apps/api/
COPY apps/api/src/load-env.ts apps/api/src/
RUN cd apps/api && npx prisma generate

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules node_modules
COPY --from=prod-deps /app/apps/api/node_modules apps/api/node_modules
COPY --from=build /app/apps/api/dist apps/api/dist
COPY apps/api/prisma apps/api/prisma
COPY apps/api/prisma.config.ts apps/api/
COPY apps/api/src/load-env.ts apps/api/src/
WORKDIR /app/apps/api
USER node
EXPOSE 3001
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
