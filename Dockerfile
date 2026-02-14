FROM oven/bun:1.3 AS deps

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM node:20-bookworm-slim

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules

COPY . .

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "node_modules/tsx/dist/cli.mjs", "src/server.ts"]
