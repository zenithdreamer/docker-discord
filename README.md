# docker-discord

A Discord bot for managing Docker Compose deployments. Control and monitor your Docker environments directly from Discord with real-time progress tracking and live output streaming.

## Features

- Start, stop, restart, and pull Docker Compose projects with live progress
- Tail container logs with service selection and refresh controls
- View Docker and host system statistics
- Prune unused images
- Abort long-running operations mid-flight
- Guild whitelist for access control
- Supports multiple projects per bot instance

## Requirements

- [Bun](https://bun.sh) runtime
- Docker with the Compose plugin (`docker compose`)
- A Discord application with a bot token

## Setup

**1. Clone and install dependencies**

```sh
git clone <repo-url>
cd docker-discord
bun install
```

**2. Configure environment variables**

```sh
DISCORD_TOKEN=        # Discord bot token
DISCORD_APP_ID=       # Discord application ID
GUILD_WHITELIST=      # Comma-separated list of authorized guild IDs
PROJECTS_CONFIG=      # Path to projects config file (default: ./projects.json)
```

**3. Create a projects config**

Copy `projects.example.json` to `projects.json` and edit it:

```json
{
  "projects": [
    {
      "id": "production",
      "name": "Production",
      "description": "Production environment",
      "composePath": "/path/to/compose/directory",
      "composeCommand": "docker",
      "projectName": "production"
    }
  ],
  "docker": {
    "socketPath": "/var/run/docker.sock"
  }
}
```

| Field | Required | Description |
|---|---|---|
| `id` | Yes | Unique identifier used in commands |
| `name` | Yes | Display name shown in Discord dropdowns |
| `description` | Yes | Short description (informational) |
| `composePath` | Yes | Path to the directory containing `docker-compose.yml` |
| `composeCommand` | Yes | Command to invoke (typically `docker`) |
| `projectName` | No | Overrides the Compose project name (`-p` flag) |

**4. Register slash commands**

```sh
bun run register-commands
```

**5. Start the bot**

```sh
bun run start
```

## Commands

| Command | Description |
|---|---|
| `/status <project>` | Show container states, uptime, health, and ports |
| `/pull <project>` | Pull latest images with layer-level progress |
| `/up <project>` | Run `docker compose up -d` with live output |
| `/down <project>` | Run `docker compose down` with live output |
| `/restart <project>` | Restart services with live output |
| `/logs <project> [service] [lines]` | Tail container logs |
| `/stats` | Show Docker engine and host system stats |
| `/prune-images [all]` | Remove unused Docker images |
| `/regenerate` | Re-register slash commands for the current guild |

## Docker

A Dockerfile is provided at `src/Dockerfile`. The container requires access to the Docker socket and your projects config:

```sh
docker run \
  -e DISCORD_TOKEN=<token> \
  -e DISCORD_APP_ID=<app-id> \
  -e GUILD_WHITELIST=<guild-ids> \
  -e PROJECTS_CONFIG=/app/projects.json \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /path/to/projects.json:/app/projects.json \
  your-registry/docker-discord:latest
```

A `docker-compose.yml` is also included for convenience.

## Development

```sh
bun run dev          # Start with hot reload
bun run typecheck    # Run TypeScript type checking
```
