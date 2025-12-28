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
  if (status === "Restarting") {
    return { status: "restarting", event: "Restarting..." };
  } else if (status === "Started") {
    return { status: "started", event: "Restarted successfully" };
  } else if (status === "Running") {
    return { status: "running", event: "Already running" };
  }
  return null;
}

function getStatusIcon(status: string): string {
  if (status === "started") return ICONS.RUNNING;
  if (status === "restarting") return ICONS.WARNING;
  if (status === "running") return ICONS.INFO;
  return ICONS.INFO;
}

function getStatusCounts(services: Map<string, any>) {
  let restartingCount = 0;
  let startedCount = 0;
  let runningCount = 0;

  for (const service of services.values()) {
    if (service.status === "restarting") restartingCount++;
    else if (service.status === "started") startedCount++;
    else if (service.status === "running") runningCount++;
  }

  return [
    { label: `${ICONS.WARNING} **${restartingCount}** Restarting`, count: restartingCount },
    { label: `${ICONS.RUNNING} **${startedCount}** Restarted`, count: startedCount },
    { label: `${ICONS.INFO} **${runningCount}** Running`, count: runningCount },
  ];
}

export async function handleRestart(interaction: ChatInputCommandInteraction, project: Project) {
  const deferred = await safeDeferReply(interaction);
  if (!deferred) return;

  let updateCount = 0;
  let buffer = "";
  const progress: ComposeProgress = createEmptyProgress();
  let aborted = false;
  let childRef: any;

  const initialEmbed = buildProgressEmbed(progress, updateCount, {
    title: "🔄 Restarting Services",
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

    if (componentInteraction.customId === "restart_cancel") {
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
  let lastUpdateTime = Date.now();
  const updateInterval = setInterval(async () => {
    if (aborted) return;

    // Send update if we have pending changes OR if 4 seconds passed (heartbeat)
    const timeSinceLastUpdate = Date.now() - lastUpdateTime;
    const shouldUpdate = pendingUpdate || timeSinceLastUpdate >= 4000;

    if (!shouldUpdate) return;

    pendingUpdate = false;
    lastUpdateTime = Date.now();
    updateCount++;

    const progressEmbed = buildProgressEmbed(progress, updateCount, {
      title: "🔄 Restarting Services",
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
    ["--progress", "json", "restart"],
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
  let finalTitle = "🔄 Restarting Services";
  let finalColor: number = COLORS.WARNING;
  let finalHeading = "Summary";
  let finalFooter = "Completed";

  if (aborted) {
    finalTitle = "🚫 Restart Cancelled";
    finalColor = COLORS.WARNING;
    finalFooter = "Cancelled";
  } else if (progress.errorMessage) {
    const embed = createErrorEmbed("Compose Restart Failed", progress.errorMessage);
    await interaction.editReply({ embeds: [embed], components: [] });
    return;
  } else if (result.ok) {
    finalTitle = "✅ Restart Complete";
    finalColor = COLORS.SUCCESS;
  } else {
    const embed = createErrorEmbed(
      "Compose Restart Failed",
      "Failed to restart services with docker compose restart",
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
    isComplete: true,
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
        custom_id: "restart_cancel",
        label: "Abort Restart",
        disabled: !active,
      },
    ],
  };
}
