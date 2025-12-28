import { ChatInputCommandInteraction } from "discord.js";
import { runComposeStreaming } from "../services/docker";
import { createErrorEmbed, COLORS, ICONS } from "../utils/embeds";
import { safeDeferReply } from "../utils/interactions";
import {
  createEmptyProgress,
  updateProgressFromJsonLine,
  buildProgressEmbed,
  type ComposeProgress,
} from "../utils/composeProgress";
import type { Project } from "../types/index";

function statusMapper(status: string): { status: string; event: string } | null {
  if (status === "Stopping") {
    return { status: "stopping", event: "Stopping..." };
  } else if (status === "Stopped") {
    return { status: "stopped", event: "Stopped" };
  } else if (status === "Removing") {
    return { status: "removing", event: "Removing..." };
  } else if (status === "Removed") {
    return { status: "removed", event: "Removed" };
  }
  return null;
}

function getStatusIcon(status: string): string {
  if (status === "removed") return "✅";
  if (status === "stopped") return ICONS.STOPPED;
  if (status === "stopping") return ICONS.WARNING;
  if (status === "removing") return ICONS.ERROR;
  return ICONS.INFO;
}

function getStatusCounts(services: Map<string, any>) {
  let stoppingCount = 0;
  let stoppedCount = 0;
  let removingCount = 0;
  let removedCount = 0;

  for (const service of services.values()) {
    if (service.status === "stopping") stoppingCount++;
    else if (service.status === "stopped") stoppedCount++;
    else if (service.status === "removing") removingCount++;
    else if (service.status === "removed") removedCount++;
  }

  return [
    { label: `${ICONS.WARNING} **${stoppingCount}** Stopping`, count: stoppingCount },
    { label: `${ICONS.ERROR} **${removingCount}** Removing`, count: removingCount },
    { label: `${ICONS.STOPPED} **${stoppedCount}** Stopped`, count: stoppedCount },
    { label: `✅ **${removedCount}** Removed`, count: removedCount },
  ];
}

export async function handleDown(interaction: ChatInputCommandInteraction, project: Project) {
  const deferred = await safeDeferReply(interaction);
  if (!deferred) return;

  let updateCount = 0;
  let buffer = "";
  const progress: ComposeProgress = createEmptyProgress();
  let aborted = false;
  let childRef: any;

  const initialEmbed = buildProgressEmbed(progress, updateCount, {
    title: "🛑 Stopping Services",
    color: COLORS.WARNING,
    heading: "Live Progress",
    footerText: `Update #${updateCount}`,
    getStatusIcon,
    getStatusCounts,
  });
  await interaction.editReply({ embeds: [initialEmbed], components: [buildControlsRow(true)] });
  const message = await interaction.fetchReply();

  const collector = message.createMessageComponentCollector({
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

    if (componentInteraction.customId === "down_cancel") {
      aborted = true;
      await componentInteraction.deferUpdate().catch(() => {});
      collector.stop("aborted");

      // Send SIGTERM first for graceful shutdown
      if (childRef?.kill) {
        childRef.kill("SIGTERM");

        // If process doesn't exit within 5 seconds, force kill
        setTimeout(() => {
          if (childRef?.killed === false) {
            childRef.kill("SIGKILL");
          }
        }, 5000);
      }
    }
  });

  collector.on("end", async (_c, reason) => {
    if (reason === "aborted") return;
    try {
      await interaction.editReply({ components: [] });
    } catch {
      // ignore
    }
  });

  // Fixed interval polling for updates (every 2 seconds)
  let pendingUpdate = false;
  const updateInterval = setInterval(async () => {
    if (aborted || !pendingUpdate) return;
    pendingUpdate = false;
    updateCount++;

    const progressEmbed = buildProgressEmbed(progress, updateCount, {
      title: "🛑 Stopping Services",
      color: COLORS.WARNING,
      heading: "Live Progress",
      footerText: `Update #${updateCount}`,
      getStatusIcon,
      getStatusCounts,
    });
    try {
      await interaction.editReply({ embeds: [progressEmbed], components: [buildControlsRow(true)] });
    } catch {
      // best-effort
    }
  }, 2000);

  const result = await runComposeStreaming(
    ["--progress", "json", "down"],
    project,
    async (stdoutChunk, stderrChunk) => {
      const chunk = stdoutChunk || stderrChunk || "";
      if (!chunk) return;

      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        updateProgressFromJsonLine(line, progress, statusMapper);
      }

      pendingUpdate = true;
    },
    (child) => {
      childRef = child;
    }
  );

  // Stop the update interval
  clearInterval(updateInterval);

  // Parse any remaining buffered lines
  const finalLines = [buffer, result.stdout, result.stderr].join("\n").split("\n");
  for (const line of finalLines) {
    updateProgressFromJsonLine(line, progress, statusMapper);
  }

  // Show final result
  let finalTitle = "🛑 Stopping Services";
  let finalColor: number = COLORS.WARNING;
  let finalHeading = "Summary";
  let finalFooter = "Completed";

  if (aborted) {
    finalTitle = "🚫 Down Cancelled";
    finalColor = COLORS.WARNING;
    finalFooter = "Cancelled";
  } else if (progress.errorMessage) {
    const embed = createErrorEmbed("Compose Down Failed", progress.errorMessage);
    await interaction.editReply({ embeds: [embed], components: [] });
    return;
  } else if (result.ok) {
    finalTitle = "✅ Compose Down Complete";
    finalColor = COLORS.SUCCESS;
  } else {
    const embed = createErrorEmbed(
      "Compose Down Failed",
      "Failed to stop services with docker compose down",
      result.stderr,
    );
    await interaction.editReply({ embeds: [embed], components: [] });
    return;
  }

  const finalEmbed = buildProgressEmbed(progress, updateCount, {
    title: finalTitle,
    color: finalColor,
    heading: finalHeading,
    footerText: finalFooter,
    getStatusIcon,
    getStatusCounts,
  });
  await interaction.editReply({ embeds: [finalEmbed], components: [] });
}

function buildControlsRow(active: boolean) {
  return {
    type: 1,
    components: [
      {
        type: 2,
        style: 4,
        custom_id: "down_cancel",
        label: "Abort Down",
        disabled: !active,
      },
    ],
  };
}
