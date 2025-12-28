FROM oven/bun:1.1.21-alpine

WORKDIR /app

# Install Docker CLI + compose plugin so the bot can shell out to `docker compose`.
RUN apk add --no-cache docker-cli docker-cli-compose

COPY package.json bun.lockb* tsconfig.json ./
COPY src ./src

RUN bun install --ci --frozen-lockfile || bun install

ENV NODE_ENV=production

CMD ["bun", "start"]
