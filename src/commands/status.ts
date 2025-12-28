import { ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { listContainers } from "../services/dockerApi";
import { runCompose } from "../services/docker";
import { createEmbed, createErrorEmbed, COLORS, ICONS } from "../utils/embeds";
import { getServiceStateIcon, formatPorts } from "../utils/formatting";
import { safeDeferReply } from "../utils/interactions";
import type { Project } from "../types/index";

export async function handleStatus(interaction: ChatInputCommandInteraction, project: Project) {
  const deferred = await safeDeferReply(interaction);
  if (!deferred) return;
  const result = await listContainers(project, true);

  if (result.ok && Array.isArray(result.data) && result.data.length > 0) {
    // Group services by running vs stopped
    const running = result.data.filter((container: any) => {
      return container.State === "running";
    });
    const stopped = result.data.filter((container: any) => {
      return container.State !== "running";
    });

    // Count service statuses
    const runningCount = running.length;
    const stoppedCount = stopped.length;
    const totalCount = result.data.length;

    // Build summary
    const summaryParts: string[] = [];
    if (runningCount > 0) summaryParts.push(`${ICONS.RUNNING} **${runningCount}** Running`);
    if (stoppedCount > 0) summaryParts.push(`${ICONS.STOPPED} **${stoppedCount}** Stopped`);

    const summary = summaryParts.length > 0
      ? summaryParts.join("  •  ")
      : `${ICONS.INFO} No services`;

    const statusEmbed = new EmbedBuilder()
      .setTitle("🐳 Docker Compose Status")
      .setColor(running.length > 0 ? COLORS.SUCCESS : COLORS.WARNING)
      .setDescription(`**Services Overview**\n\n${summary}`)
      .setTimestamp()
      .setFooter({ text: `${totalCount} total services` });

    // Add individual service status
    result.data.forEach((container: any) => {
      // Extract service name from container names array or labels
      const serviceName = container.Labels?.['com.docker.compose.service'] ||
                        container.Names?.[0]?.replace(/^\//, '') ||
                        "unknown";

      const status = container.Status || "";
      const state = container.State || "";

      // Determine icon based on state
      let statusIcon: string = ICONS.INFO;
      if (state === "running") {
        statusIcon = "🟢";
      } else if (state === "exited") {
        statusIcon = "🔴";
      } else if (state === "restarting") {
        statusIcon = "🚀";
      } else if (state === "paused") {
        statusIcon = "⚠️";
      }

      // Build service info
      const lines: string[] = [];

      // Add status/uptime
      if (status) {
        lines.push(status);
      }

      // Add health if available
      if (container.Labels?.['com.docker.compose.health']) {
        const health = container.Labels['com.docker.compose.health'];
        const healthIcon = health.toLowerCase().includes("healthy") ? "💚" : "💛";
        lines.push(`${healthIcon} Health: ${health}`);
      }

      // Format ports
      if (container.Ports && container.Ports.length > 0) {
        const portMappings = container.Ports
          .filter((p: any) => p.PublicPort)
          .map((p: any) => p.PublicPort)
          .filter((p: any, i: number, arr: any[]) => arr.indexOf(p) === i); // unique

        if (portMappings.length > 0) {
          lines.push(`📡 Ports: ${portMappings.join(", ")}`);
        }
      }

      statusEmbed.addFields({
        name: `${statusIcon} ${serviceName}`,
        value: lines.length > 0 ? lines.join("\n") : state,
        inline: true,
      });
    });

    await interaction.editReply({ embeds: [statusEmbed] });
  } else if (result.ok && Array.isArray(result.data) && result.data.length === 0) {
    const embed = createEmbed("🐳 Docker Compose Status", {
      description: "No services found in compose project",
      color: COLORS.INFO,
      timestamp: true,
    });
    await interaction.editReply({ embeds: [embed] });
  } else {
    const fallback = await runCompose(["ps"], project);
    if (!fallback.ok) {
      const embed = createErrorEmbed(
        "Failed to get status",
        "Could not retrieve compose status",
        fallback.stderr,
      );
      await interaction.editReply({ embeds: [embed] });
    } else {
      const embed = createEmbed("🐳 Docker Compose Status", {
        description: fallback.stdout || "No services running",
        color: COLORS.INFO,
        timestamp: true,
      });
      await interaction.editReply({ embeds: [embed] });
    }
  }
}
