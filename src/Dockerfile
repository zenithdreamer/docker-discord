# syntax=docker/dockerfile:1.7

FROM oven/bun:1.3-debian

WORKDIR /app

# Create Docker config directory
RUN mkdir -p /root/.docker

# Install system dependencies and Docker
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && \
    apt-get install -y ca-certificates curl pass gnupg2 && \
    install -m 0755 -d /etc/apt/keyrings && \
    curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc && \
    chmod a+r /etc/apt/keyrings/docker.asc && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" > /etc/apt/sources.list.d/docker.list && \
    apt-get update && \
    apt-get install -y docker-ce-cli docker-compose-plugin docker-buildx-plugin

# Install docker-credential-pass
RUN curl -fsSL https://github.com/docker/docker-credential-helpers/releases/download/v0.8.0/docker-credential-pass-v0.8.0.linux-amd64 -o /usr/local/bin/docker-credential-pass && \
    chmod +x /usr/local/bin/docker-credential-pass

COPY package.json bun.lockb* tsconfig.json ./
RUN --mount=type=cache,target=/root/.cache/bun bun install --ci --frozen-lockfile || bun install

COPY src ./src

ENV NODE_ENV=production

CMD ["bun", "start"]
