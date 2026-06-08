FROM node:22-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV ASTRO_TELEMETRY_DISABLED=1

RUN corepack enable && corepack prepare pnpm@11.3.0 --activate

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/admin/package.json packages/admin/package.json

RUN pnpm install --frozen-lockfile --filter @tra/admin...

COPY packages/admin packages/admin

RUN pnpm --filter @tra/admin build \
  && pnpm --filter @tra/admin deploy --legacy --prod /prod/admin

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080

WORKDIR /app

COPY --from=build --chown=node:node /prod/admin ./

USER node

EXPOSE 8080

CMD ["node", "scripts/start.mjs"]
