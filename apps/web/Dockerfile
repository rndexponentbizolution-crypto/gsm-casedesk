# Build from the repository root: docker build -f apps/web/Dockerfile .
# NEXT_PUBLIC_* values are compiled into the browser bundle, so they are build
# arguments; changing them means rebuilding the image.

FROM node:22-bookworm-slim AS base
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
# npm ci checks the lockfile against every workspace, so copy all their manifests.
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
# Create the workspace's own node_modules so later COPY steps never miss it.
RUN mkdir -p apps/web/node_modules

FROM base AS build
# Root optionalDependencies pin the Linux native CSS binaries Tailwind needs.
RUN npm ci --workspace=@gsm-casedesk/web --include-workspace-root
COPY apps/web apps/web
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ARG NEXT_PUBLIC_AUTH_MODE=keycloak
ARG NEXT_PUBLIC_KEYCLOAK_URL=http://localhost:8080
ARG NEXT_PUBLIC_KEYCLOAK_REALM=gsm-casedesk
ARG NEXT_PUBLIC_KEYCLOAK_CLIENT_ID=gsm-casedesk-web
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_AUTH_MODE=$NEXT_PUBLIC_AUTH_MODE \
    NEXT_PUBLIC_KEYCLOAK_URL=$NEXT_PUBLIC_KEYCLOAK_URL \
    NEXT_PUBLIC_KEYCLOAK_REALM=$NEXT_PUBLIC_KEYCLOAK_REALM \
    NEXT_PUBLIC_KEYCLOAK_CLIENT_ID=$NEXT_PUBLIC_KEYCLOAK_CLIENT_ID \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build --workspace=@gsm-casedesk/web

FROM base AS prod-deps
RUN npm ci --workspace=@gsm-casedesk/web --include-workspace-root=false --omit=dev

FROM base AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=prod-deps /app/node_modules node_modules
COPY --from=prod-deps /app/apps/web/node_modules apps/web/node_modules
COPY --from=build /app/apps/web/.next apps/web/.next
COPY apps/web/public apps/web/public
COPY apps/web/next.config.ts apps/web/
WORKDIR /app/apps/web
USER node
EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000"]
