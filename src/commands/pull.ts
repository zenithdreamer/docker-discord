import { ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { runComposeStreaming } from "../services/docker";
import { createErrorEmbed, COLORS, ICONS } from "../utils/embeds";
import { createEmptyPullProgress, updatePullProgressFromJsonLine } from "../utils/parsers";
import { formatBytes } from "../utils/formatting";
import { safeDeferReply, safeDeferUpdate } from "../utils/interactions";
import type { Project, PullProgress, ServicePullStatus } from "../types/index";

export async function handlePull(interaction: ChatInputCommandInteraction, project: Project) {
  const deferred = await safeDeferReply(interaction);
  if (!deferred) return;
  let updateCount = 0;
  let buffer = "";
  const progress = createEmptyPullProgress();
  let aborted = false;
  let childRef: any;
  let pendingUpdate = true;

  const initialEmbed = buildProgressEmbed(progress, updateCount);
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

    if (componentInteraction.customId === "pull_cancel") {
      aborted = true;
      const deferredUpdate = await safeDeferUpdate(componentInteraction);
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

      if (!deferredUpdate) return;
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

  // Fixed interval polling for updates (every 2.5 seconds to avoid rate limits)
  const updateInterval = setInterval(async () => {
    if (aborted) return;

    // Only update if we have pending changes or it's been a while (show we're still alive)
    const shouldUpdate = pendingUpdate || updateCount === 0;
    if (!shouldUpdate) return;

    pendingUpdate = false;
    updateCount++;

    const progressEmbed = buildProgressEmbed(progress, updateCount);
    try {
      await interaction.editReply({ embeds: [progressEmbed], components: [buildControlsRow(true)] });
    } catch (err) {
      // Rate limiting or other Discord API errors - ignore
    }
  }, 2500);

  const result = await runComposeStreaming(
    ["--progress", "json", "pull"],
    project,
    async (stdoutChunk, stderrChunk) => {
      const chunk = stdoutChunk || stderrChunk || "";
      if (!chunk) return;

      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        updatePullProgressFromJsonLine(line, progress);
      }

      // Mark that we have updates to show
      pendingUpdate = true;
    },
    (child) => {
      childRef = child;
    }
  );

  // Stop the update interval
  clearInterval(updateInterval);

  // Parse any remaining buffered lines plus final outputs
  const finalLines = [buffer, result.stdout, result.stderr].join("\n").split("\n");
  for (const line of finalLines) {
    updatePullProgressFromJsonLine(line, progress);
  }

  // Final update showing the current state (whether completed, cancelled, or failed)
  let finalTitle = "⬇️ Pulling Docker Images";
  let finalColor: number = COLORS.IN_PROGRESS;
  let finalFooter = "Completed";

  if (aborted) {
    finalTitle = "🚫 Pull Cancelled";
    finalColor = COLORS.WARNING;
    finalFooter = "Cancelled";
  } else if (result.ok) {
    finalTitle = "✅ Pull Complete";
    finalColor = COLORS.SUCCESS;
    finalFooter = "Completed";
  } else {
    // Combine stderr and stdout for better error context
    const errorOutput = (result.stderr || result.stdout || "Unknown error").trim();

    // Try to extract more helpful error messages
    let errorDetail = errorOutput;
    if (errorOutput.includes("denied") || errorOutput.includes("unauthorized")) {
      errorDetail = "Docker registry authentication failed. Check your Docker credentials.\n\n" + errorOutput;
    } else if (errorOutput.includes("Received one or more errors")) {
      // Parse out actual errors from the generic message
      const lines = errorOutput.split("\n");
      const errorLines = lines.filter(line =>
        line.includes("error") ||
        line.includes("Error") ||
        line.includes("denied") ||
        line.includes("unauthorized") ||
        line.includes("failed")
      );
      if (errorLines.length > 0) {
        errorDetail = errorLines.join("\n");
      }
    }

    const embed = createErrorEmbed(
      "Pull Failed",
      "Failed to pull Docker images",
      errorDetail,
    );
    await interaction.editReply({ embeds: [embed], components: [] });
    return;
  }

  const finalEmbed = buildProgressEmbed(progress, updateCount, {
    title: finalTitle,
    color: finalColor,
    heading: "Summary",
    footerText: finalFooter,
  });
  await interaction.editReply({ embeds: [finalEmbed], components: [] });
}

function buildProgressEmbed(
  progress: PullProgress,
  updateCount: number,
  options?: {
    title?: string;
    color?: number;
    heading?: string;
    footerText?: string;
  },
): EmbedBuilder {
  const progressEmbed = new EmbedBuilder()
    .setTitle(options?.title ?? "⬇️ Pulling Docker Images")
    .setColor(options?.color ?? COLORS.IN_PROGRESS)
    .setDescription(`**${options?.heading ?? "Live Progress"}**\n\n${progress.summary}`)
    .setTimestamp()
    .setFooter({ text: options?.footerText ?? `Update #${updateCount}` });

  if (progress.services.size === 0) {
    progressEmbed.addFields({
      name: "Status",
      value: `${ICONS.LOADING} Waiting for pull output...`,
      inline: false,
    });
    return progressEmbed;
  }

  for (const [serviceName, serviceStatus] of progress.services.entries()) {
    let statusIcon: string = ICONS.INFO;
    let statusText = "Waiting";
    let percentText = "";
    let sizeSuffix = "";

    // Check if we have active layer progress to display
    const hasActiveProgress = serviceStatus.layers.size > 0;

    if (serviceStatus.status === "pulled") {
      statusIcon = ICONS.SUCCESS;
      statusText = "Pulled";
      // Show final size if available
      if (serviceStatus.finalSize && serviceStatus.finalSize > 0) {
        sizeSuffix = ` • ${formatBytes(serviceStatus.finalSize)}`;
      }
    } else if (serviceStatus.status === "up-to-date") {
      statusIcon = ICONS.INFO;
      statusText = "Already up to date";
    } else if (serviceStatus.status === "interrupted") {
      statusIcon = ICONS.WARNING;
      statusText = "Interrupted";
    } else if (hasActiveProgress || serviceStatus.status === "pulling") {
      // Show pulling status if we have layers OR status is explicitly pulling
      statusIcon = ICONS.PULLING;
      statusText = "Pulling";
      sizeSuffix = formatSizeSuffix(serviceStatus);
    }

    // Show layer progress detail if we have any layers (regardless of status)
    if (hasActiveProgress) {
      const layers = Array.from(serviceStatus.layers.values());

      // Find an active layer (not completed or already exists)
      let mainLayer = layers.find((l) =>
        l.id === serviceStatus.currentLayer &&
        l.action !== "Pull complete" &&
        l.action !== "Already exists"
      );

      if (!mainLayer) {
        // Find any active downloading/extracting layer
        mainLayer = layers.find((l) =>
          l.action === "Downloading" || l.action === "Extracting"
        );
      }

      if (!mainLayer) {
        // Fall back to waiting layers
        mainLayer = layers.find((l) => l.action === "Waiting");
      }

      // Only show progress if we have an active layer with valid data
      if (mainLayer && mainLayer.total > 0) {
        const current = mainLayer.current ? formatBytes(mainLayer.current) : "0B";
        const total = formatBytes(mainLayer.total);
        percentText = ` (${mainLayer.percentage}%)`;

        // Emoji indicators for different stages
        let actionPrefix = "📥"; // Default: Downloading
        if (mainLayer.action === "Extracting") {
          actionPrefix = "📦";
        } else if (mainLayer.action === "Waiting") {
          actionPrefix = "⏳";
        }

        statusText = `${actionPrefix} ${current} / ${total}`;
      }
    }

    progressEmbed.addFields({
      name: `${statusIcon} ${serviceName}`,
      value: `${statusText}${percentText}${sizeSuffix}`,
      inline: true,
    });
  }

  return progressEmbed;
}

function buildControlsRow(active: boolean) {
  return {
    type: 1,
    components: [
      {
        type: 2,
        style: 4,
        custom_id: "pull_cancel",
        label: active ? "Abort Pull" : "Abort Pull",
        disabled: !active,
      },
    ],
  };
}

function formatSizeSuffix(serviceStatus: ServicePullStatus): string {
  const totals = Array.from(serviceStatus.layers.values()).map((l) => l.total || 0);
  const totalBytes = totals.reduce((acc, val) => acc + (Number.isFinite(val) ? val : 0), 0);
  if (!totalBytes) return "";
  return ` • ~${formatBytes(totalBytes)}`;
}
