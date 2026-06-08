# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@11.3.0 --activate

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/api/package.json packages/api/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

COPY packages/api packages/api
COPY packages/db/src packages/db/src
COPY packages/shared/src packages/shared/src

RUN pnpm --filter @tra/api build
RUN pnpm --filter @tra/api deploy --legacy --prod /prod/api

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=8080
ENV STORAGE_ADAPTER=local
ENV STORAGE_LOCAL_PATH=/app/uploads

WORKDIR /app

COPY --from=build --chown=node:node /prod/api ./
RUN mkdir -p /app/uploads && chown node:node /app/uploads

USER node

EXPOSE 8080

CMD ["node", "dist/index.cjs"]
