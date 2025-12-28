FROM oven/bun:1.3-debian

WORKDIR /app

# Create Docker config directory
RUN mkdir -p /root/.docker

# Install Docker CLI and Compose plugin
RUN apt-get update && \
    apt-get install -y ca-certificates curl && \
    install -m 0755 -d /etc/apt/keyrings && \
    curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc && \
    chmod a+r /etc/apt/keyrings/docker.asc && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" > /etc/apt/sources.list.d/docker.list && \
    apt-get update && \
    apt-get install -y docker-ce-cli docker-compose-plugin && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

COPY package.json bun.lockb* tsconfig.json ./
COPY src ./src

RUN bun install --ci --frozen-lockfile || bun install

ENV NODE_ENV=production

CMD ["bun", "start"]
