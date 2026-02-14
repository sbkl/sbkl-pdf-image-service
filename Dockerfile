FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "node_modules/tsx/dist/cli.mjs", "src/server.ts"]
