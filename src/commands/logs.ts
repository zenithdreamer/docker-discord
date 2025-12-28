import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ButtonInteraction,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
} from "discord.js";
import { listContainers, getContainerLogs } from "../services/dockerApi";
import { createErrorEmbed, COLORS, ICONS } from "../utils/embeds";
import { safeDeferReply, safeDeferUpdate } from "../utils/interactions";
import type { Project } from "../types/index";

export async function handleLogs(interaction: ChatInputCommandInteraction, project: Project) {
  const deferred = await safeDeferReply(interaction);
  if (!deferred) return;

  const requestedService = interaction.options.getString("service") ?? undefined;
  const lines = Math.max(interaction.options.getInteger("lines") ?? 50, 1);

  // Get all containers using Docker API
  const containersResult = await listContainers(project, true);

  if (!containersResult.ok) {
    const embed = createErrorEmbed(
      "Failed to list containers",
      "Could not retrieve containers from Docker API",
      containersResult.error,
    );
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const containers = containersResult.data;

  if (!containers || containers.length === 0) {
    const embed = new EmbedBuilder()
      .setTitle("📋 Container Logs")
      .setColor(COLORS.WARNING)
      .setDescription("No containers found for this project")
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // If a specific service was requested, show it first
  let currentIndex = 0;
  if (requestedService) {
    const index = containers.findIndex((c: any) =>
      c.Labels?.["com.docker.compose.service"] === requestedService
    );
    if (index !== -1) {
      currentIndex = index;
    }
  }

  await displayContainerLogs(interaction, project, containers, currentIndex, lines);
}

async function displayContainerLogs(
  interaction: ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction,
  project: Project,
  containers: import('dockerode').ContainerInfo[],
  currentIndex: number,
  lines: number,
) {
  const indexToUse = Number.isFinite(currentIndex) ? currentIndex : 0;
  const safeIndex = Math.min(Math.max(indexToUse, 0), containers.length - 1);
  const container = containers[safeIndex];
  const serviceName = container.Labels?.["com.docker.compose.service"] ||
                      container.Names?.[0]?.replace(/^\//, '') ||
                      "unknown";

  const state = container.State || "unknown";
  const stateIcon = state === "running" ? ICONS.RUNNING : ICONS.STOPPED;

  // Fetch logs using Docker API
  const logsResult = await getContainerLogs(container.Id, lines);

  const embed = new EmbedBuilder()
    .setTitle(`📋 Container Logs Browser`)
    .setColor(state === "running" ? COLORS.SUCCESS : COLORS.WARNING)
    .setDescription(`**Service:** ${serviceName}\n**State:** ${stateIcon} ${state}`)
    .setTimestamp()
    .setFooter({ text: `Container ${safeIndex + 1} of ${containers.length} • Last ${lines} lines` });

  if (logsResult.ok) {
    const rawLogs = logsResult.data || "No logs available";
    const logLines = rawLogs.split("\n");
    const recentLogs = logLines.slice(-lines);

    // Clean ANSI codes and control characters
    const cleanedLogs = recentLogs
      .map((line: string) => line.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "").replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F]/g, ""))
      .filter((line: string) => line.trim())
      .join("\n");

    // Split into chunks if too long
    // Account for ```\n and \n``` wrappers (8 chars total)
    const maxLength = 1024 - 8;
    if (cleanedLogs.length > maxLength) {
      const chunks = [];
      let remaining = cleanedLogs;

      while (remaining.length > 0) {
        chunks.push(remaining.slice(0, maxLength));
        remaining = remaining.slice(maxLength);
      }

      chunks.slice(0, 3).forEach((chunk, i) => {
        embed.addFields({
          name: i === 0 ? "Logs" : `Logs (continued ${i + 1})`,
          value: `\`\`\`\n${chunk}\n\`\`\``,
          inline: false,
        });
      });

      if (chunks.length > 3) {
        embed.addFields({
          name: "Note",
          value: `... ${chunks.length - 3} more chunks not shown (output too long)`,
          inline: false,
        });
      }
    } else {
      embed.addFields({
        name: "Logs",
        value: `\`\`\`\n${cleanedLogs || "(no recent logs)"}\n\`\`\``,
        inline: false,
      });
    }
  } else {
    embed.addFields({
      name: "Error",
      value: `Failed to retrieve logs: ${logsResult.error}`,
      inline: false,
    });
  }

  const optionsLimit = 25;
  const selectOptions = containers.slice(0, optionsLimit).map((c, i) => {
    const name = c.Labels?.["com.docker.compose.service"] ||
                 c.Names?.[0]?.replace(/^\//, '') ||
                 `Container ${i + 1}`;
    const stateLabel = c.State || "unknown";
    const stateIconOption = stateLabel === "running" ? ICONS.RUNNING : ICONS.STOPPED;
    return {
      label: name.slice(0, 90),
      value: String(i),
      description: `${stateIconOption} ${stateLabel}`.slice(0, 100),
      default: i === safeIndex,
    };
  });

  const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("logs_select")
      .setPlaceholder("Select a container to view logs")
      .addOptions(selectOptions),
  );

  const controlsRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("logs_refresh")
      .setLabel("🔄 Refresh")
      .setStyle(ButtonStyle.Secondary),
  );

  const response = await interaction.editReply({
    embeds: [embed],
    components: [selectRow, controlsRow],
  });

  const collector = response.createMessageComponentCollector({
    time: 300000, // 5 minutes
  });

  collector.on("collect", async (componentInteraction) => {
    if (componentInteraction.user.id !== interaction.user.id) {
      await componentInteraction.reply({
        content: "These controls aren't for you!",
        flags: 64,
      });
      return;
    }

    const componentDeferred = await safeDeferUpdate(componentInteraction);
    if (!componentDeferred) {
      collector.stop("navigate");
      return;
    }
    collector.stop("navigate");

    if (componentInteraction.isStringSelectMenu() && componentInteraction.customId === "logs_select") {
      const index = parseInt(componentInteraction.values[0] ?? "0", 10);
      await displayContainerLogs(componentInteraction, project, containers, index, lines);
    } else if (componentInteraction.isButton() && componentInteraction.customId === "logs_refresh") {
      await displayContainerLogs(componentInteraction, project, containers, safeIndex, lines);
    }
  });

  collector.on("end", async (_collected, reason) => {
    if (reason === "navigate") return;
    const disabledSelectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      StringSelectMenuBuilder.from(selectRow.components[0]).setDisabled(true),
    );
    const disabledControlsRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      ButtonBuilder.from(controlsRow.components[0]).setDisabled(true),
    );

    try {
      await interaction.editReply({ components: [disabledSelectRow, disabledControlsRow] });
    } catch {
      // Ignore errors if message was deleted
    }
  });
}
