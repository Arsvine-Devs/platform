FROM node:24-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@12.4.1 --activate

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/console/package.json apps/console/package.json

RUN pnpm install --frozen-lockfile

COPY apps/console apps/console

RUN pnpm --filter arsvine-admin build
RUN pnpm --filter arsvine-admin deploy --prod /out
RUN cp -a apps/console/.next /out/.next

FROM node:24-bookworm-slim AS runner

ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

COPY --from=build /out ./

EXPOSE 3000

CMD ["node", "node_modules/next/dist/bin/next", "start"]
