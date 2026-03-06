import {
  ChatInputCommandInteraction,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  ActivityType,
  REST,
  CommandInteractionOption,
} from "discord.js";
import os from "node:os";
import { config, isGuildAllowed, getProject } from "./config/index";
import { formatDuration } from "./utils/formatting";
import { registerCommandsForAllGuilds, clearAndRegisterCommandsForGuild, registerGlobalCommands } from "./services/discord";
import { createErrorEmbed, createSuccessEmbed } from "./utils/embeds";
import { handleStatus } from "./commands/status";
import { handlePull } from "./commands/pull";
import { handleUp } from "./commands/up";
import { handleDown } from "./commands/down";
import { handleRestart } from "./commands/restart";
import { handleLogs } from "./commands/logs";
import { handlePruneImages } from "./commands/pruneImages";
import { handleStats } from "./commands/stats";

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

declare global {
  // Used to prevent duplicate Discord clients during hot reload
  // eslint-disable-next-line no-var
  var __DISCORD_CLIENT: Client | undefined;
}

// Destroy any previous client instance when hot reloading
if (globalThis.__DISCORD_CLIENT) {
  try {
    globalThis.__DISCORD_CLIENT.destroy();
  } catch {
    // ignore teardown errors
  }
}
globalThis.__DISCORD_CLIENT = client;

const shouldRegisterOnStartup = process.argv.includes("--register");
let isRegenerating = false;
let presenceInterval: NodeJS.Timeout | undefined;

function withEphemeral<T extends { flags?: number; ephemeral?: boolean }>(options: T): Omit<T, "ephemeral"> {
  const { ephemeral, ...rest } = options;
  if (ephemeral) {
    return { ...rest, flags: MessageFlags.Ephemeral };
  }
  return rest;
}

function formatOptionValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "[complex]";
}

function flattenOptions(options: readonly CommandInteractionOption[], parentPath?: string): string[] {
  const parts: string[] = [];

  for (const option of options) {
    const key = parentPath ? `${parentPath}.${option.name}` : option.name;
    if (option.options && option.options.length > 0) {
      parts.push(...flattenOptions(option.options, key));
      continue;
    }

    if (typeof option.value !== "undefined") {
      parts.push(`${key}=${formatOptionValue(option.value)}`);
    } else {
      parts.push(key);
    }
  }

  return parts;
}

function logCommandInvocation(interaction: ChatInputCommandInteraction) {
  const userLabel = `${interaction.user.tag} (${interaction.user.id})`;
  const guildLabel = interaction.guild
    ? `${interaction.guild.name} (${interaction.guildId})`
    : "Direct Message";
  const options = flattenOptions(interaction.options.data);
  const optionsSuffix = options.length > 0 ? ` with options: ${options.join(", ")}` : "";

  console.log(`[Slash Command] ${userLabel} invoked /${interaction.commandName} in ${guildLabel}${optionsSuffix}`);
}

function attachCleanupHandlers(botClient: Client) {
  const cleanup = async () => {
    if (presenceInterval) {
      clearInterval(presenceInterval);
      presenceInterval = undefined;
    }
    try {
      await botClient.destroy();
    } catch {
      // ignore
    }
    process.exit(0);
  };

  // Bun hot reload sends SIGUSR2; also handle SIGINT/SIGTERM for manual stops
  ["SIGINT", "SIGTERM", "SIGUSR2"].forEach((signal) => {
    process.once(signal, cleanup);
  });
}

function startPresenceUpdates(botClient: Client) {
  const updatePresence = () => {
    if (!botClient.user) return;
    const botUptime = formatDuration(process.uptime());
    const hostUptime = formatDuration(os.uptime());
    botClient.user.setPresence({
      activities: [
        {
          type: ActivityType.Watching,
          name: `bot ${botUptime} • host ${hostUptime}`,
        },
      ],
      status: "online",
    });
  };

  updatePresence();
  presenceInterval = setInterval(updatePresence, 60_000);
}

client.on(Events.ClientReady, async (c) => {
  console.log(`Bot logged in as ${c.user.tag}`);
  if (shouldRegisterOnStartup) {
    await registerGlobalCommands();
    await registerCommandsForAllGuilds(client);
  } else {
    console.log("Skipping command registration (run with --register to publish commands).");
  }
  startPresenceUpdates(client);
});
attachCleanupHandlers(client);

client.on(Events.GuildCreate, async (guild) => {
  if (!shouldRegisterOnStartup) {
    console.log(`Joined guild ${guild.name} but not registering commands (use /regenerate).`);
    return;
  }
  const rest = new REST({ version: "10" }).setToken(config.token);
  await clearAndRegisterCommandsForGuild(guild.id, rest, guild.name);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  logCommandInvocation(interaction);

  if (!isGuildAllowed(interaction.guildId)) {
    const embed = createErrorEmbed(
      "Unauthorized",
      "This guild is not authorized for deployments",
    );
    await safeReply(interaction, { embeds: [embed] });
    return;
  }

  try {
    switch (interaction.commandName) {
      case "regenerate": {
        if (!interaction.guildId) {
          const embed = createErrorEmbed("Regenerate Failed", "This command must be used in a guild.");
          await safeReply(interaction, { embeds: [embed] });
          return;
        }

        if (isRegenerating) {
          await safeReply(interaction, withEphemeral({
            embeds: [createErrorEmbed("Regenerate In Progress", "Please wait for the current regeneration to finish.")],
            ephemeral: true,
          }));
          return;
        }

        isRegenerating = true;
        await safeReply(interaction, withEphemeral({
          embeds: [createSuccessEmbed("Regeneration Started", "Re-registering commands for this server...")],
          ephemeral: true,
        }));

        (async () => {
          try {
            const rest = new REST({ version: "10" }).setToken(config.token);
            const guildName = interaction.guild?.name ?? undefined;
            await clearAndRegisterCommandsForGuild(interaction.guildId ?? "", rest, guildName);
            await interaction.followUp(withEphemeral({
              embeds: [createSuccessEmbed("Regeneration Complete", "Commands re-registered for this server")],
              ephemeral: true,
            }));
          } catch (err) {
            console.error("Failed to regenerate commands", err);
            await interaction.followUp(withEphemeral({
              embeds: [createErrorEmbed("Regeneration Failed", "Could not refresh commands", err instanceof Error ? err.message : String(err))],
              ephemeral: true,
            }));
          } finally {
            isRegenerating = false;
          }
        })();
        return;
      }
    }

    const requiresProject = ["status", "pull", "up", "down", "logs", "restart"].includes(interaction.commandName);
    let project = undefined;
    if (requiresProject) {
      const projectId = interaction.options.getString("project");
      if (!projectId) {
        const embed = createErrorEmbed("Missing Project", "Please select a project");
        await safeReply(interaction, { embeds: [embed] });
        return;
      }

      project = getProject(projectId);
      if (!project) {
        const embed = createErrorEmbed(
          "Invalid Project",
          `Project "${projectId}" not found in configuration`,
        );
        await safeReply(interaction, { embeds: [embed] });
        return;
      }
    }

    switch (interaction.commandName) {
      case "status":
        await handleStatus(interaction, project!);
        break;
      case "pull":
        await handlePull(interaction, project!);
        break;
      case "up":
        await handleUp(interaction, project!);
        break;
      case "down":
        await handleDown(interaction, project!);
        break;
      case "restart":
        await handleRestart(interaction, project!);
        break;
      case "logs":
        await handleLogs(interaction, project!);
        break;
      case "prune-images":
        await handlePruneImages(interaction);
        break;
      case "stats":
        await handleStats(interaction);
        break;
      default:
        const unknownEmbed = createErrorEmbed("Unknown Command", "This command is not recognized");
        await safeReply(interaction, { embeds: [unknownEmbed] });
    }
  } catch (err) {
    console.error("Command error", err);
    const errorEmbed = createErrorEmbed(
      "Command Error",
      "An unexpected error occurred while running the command",
      err instanceof Error ? err.message : String(err),
    );
    await safeEditReply(interaction, { embeds: [errorEmbed] });
  }
});

async function safeReply(
  interaction: ChatInputCommandInteraction,
  options: { content?: string; embeds?: any[]; components?: any[]; flags?: number },
) {
  try {
    await interaction.reply(options);
  } catch (err) {
    console.error("Failed to reply", err);
  }
}

async function safeEditReply(
  interaction: ChatInputCommandInteraction,
  options: { content?: string; embeds?: any[] },
) {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(options);
    } else {
      await interaction.reply(options);
    }
  } catch (err) {
    console.error("Failed to edit reply", err);
  }
}

await client.login(config.token);
