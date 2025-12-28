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
  if (status === "Creating") {
    return { status: "creating", event: "Creating container..." };
  } else if (status === "Created") {
    return { status: "created", event: "Container created" };
  } else if (status === "Starting") {
    return { status: "starting", event: "Starting..." };
  } else if (status === "Started") {
    return { status: "started", event: "Started" };
  } else if (status === "Running") {
    return { status: "running", event: "Already running" };
  } else if (status === "Done") {
    return { status: "done", event: "Running" };
  } else if (status === "Recreate") {
    return { status: "recreating", event: "Recreating..." };
  } else if (status === "Recreated") {
    return { status: "recreated", event: "Recreated" };
  } else if (status === "Healthy") {
    return { status: "healthy", event: "Health check passed" };
  }
  return null;
}

function getStatusIcon(status: string): string {
  if (status === "healthy") return "💚";
  if (status === "started" || status === "running" || status === "done") return ICONS.RUNNING;
  if (status === "starting") return ICONS.STARTING;
  if (status === "creating") return ICONS.BUILDING;
  if (status === "recreating" || status === "recreated") return ICONS.WARNING;
  return ICONS.INFO;
}

function getStatusCounts(services: Map<string, any>) {
  let creatingCount = 0;
  let startingCount = 0;
  let runningCount = 0;
  let healthyCount = 0;
  let recreatedCount = 0;

  for (const service of services.values()) {
    if (service.status === "creating") creatingCount++;
    else if (service.status === "starting") startingCount++;
    else if (service.status === "started" || service.status === "running" || service.status === "done") runningCount++;
    else if (service.status === "healthy") healthyCount++;
    else if (service.status === "recreated" || service.status === "recreating") recreatedCount++;
  }

  return [
    { label: `${ICONS.BUILDING} **${creatingCount}** Creating`, count: creatingCount },
    { label: `${ICONS.STARTING} **${startingCount}** Starting`, count: startingCount },
    { label: `${ICONS.RUNNING} **${runningCount}** Running`, count: runningCount },
    { label: `💚 **${healthyCount}** Healthy`, count: healthyCount },
    { label: `${ICONS.WARNING} **${recreatedCount}** Recreated`, count: recreatedCount },
  ];
}

export async function handleUp(interaction: ChatInputCommandInteraction, project: Project) {
  const deferred = await safeDeferReply(interaction);
  if (!deferred) return;

  let updateCount = 0;
  let buffer = "";
  const progress: ComposeProgress = createEmptyProgress();
  let aborted = false;
  let childRef: any;

  const initialEmbed = buildProgressEmbed(progress, updateCount, {
    title: "🚀 Starting Services",
    color: COLORS.IN_PROGRESS,
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

    if (componentInteraction.customId === "up_cancel") {
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
      title: "🚀 Starting Services",
      color: COLORS.IN_PROGRESS,
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
    ["--progress", "json", "up", "-d"],
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
  let finalTitle = "🚀 Starting Services";
  let finalColor: number = COLORS.IN_PROGRESS;
  let finalHeading = "Summary";
  let finalFooter = "Completed";

  if (aborted) {
    finalTitle = "🚫 Up Cancelled";
    finalColor = COLORS.WARNING;
    finalFooter = "Cancelled";
  } else if (progress.errorMessage) {
    const embed = createErrorEmbed("Compose Up Failed", progress.errorMessage);
    await interaction.editReply({ embeds: [embed], components: [] });
    return;
  } else if (result.ok) {
    finalTitle = "✅ Compose Up Complete";
    finalColor = COLORS.SUCCESS;
  } else {
    const embed = createErrorEmbed(
      "Compose Up Failed",
      "Failed to start services with docker compose up -d",
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
        custom_id: "up_cancel",
        label: "Abort Up",
        disabled: !active,
      },
    ],
  };
}
