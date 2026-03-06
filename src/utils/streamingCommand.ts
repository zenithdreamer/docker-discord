import { ChatInputCommandInteraction } from "discord.js";
import { runComposeStreaming } from "../services/docker";
import { createErrorEmbed, COLORS } from "./embeds";
import {
  createEmptyProgress,
  updateProgressFromJsonLine,
  buildProgressEmbed,
  type ComposeProgress,
  type ServiceStatus,
} from "./composeProgress";
import type { Project } from "../types/index";

export interface StreamingComposeConfig {
  composeArgs: string[];
  cancelButtonId: string;
  cancelButtonLabel: string;
  inProgressTitle: string;
  inProgressColor: number;
  cancelledTitle: string;
  successTitle: string;
  failedTitle: string;
  failedDescription: string;
  statusMapper: (status: string) => { status: string; event: string } | null;
  getStatusIcon: (status: string) => string;
  getStatusCounts: (services: Map<string, ServiceStatus>) => Array<{ label: string; count: number }>;
}

export async function runStreamingCompose(
  interaction: ChatInputCommandInteraction,
  project: Project,
  cfg: StreamingComposeConfig,
): Promise<void> {
  let updateCount = 0;
  let buffer = "";
  const progress: ComposeProgress = createEmptyProgress();
  let aborted = false;
  let childRef: any;
  let pendingUpdate = false;
  let lastUpdateTime = Date.now();

  const makeEmbed = (opts?: {
    title?: string;
    color?: number;
    heading?: string;
    footerText?: string;
    isComplete?: boolean;
  }) =>
    buildProgressEmbed(progress, updateCount, {
      title: opts?.title ?? cfg.inProgressTitle,
      color: opts?.color ?? cfg.inProgressColor,
      heading: opts?.heading ?? "Live Progress",
      footerText: opts?.footerText ?? `Update #${updateCount}`,
      getStatusIcon: cfg.getStatusIcon,
      getStatusCounts: cfg.getStatusCounts,
      isComplete: opts?.isComplete,
    });

  const buildCancelRow = (active: boolean) => ({
    type: 1,
    components: [{ type: 2, style: 4, custom_id: cfg.cancelButtonId, label: cfg.cancelButtonLabel, disabled: !active }],
  });

  await interaction.editReply({ embeds: [makeEmbed()], components: [buildCancelRow(true)] });
  const message = await interaction.fetchReply();

  const collector = message.createMessageComponentCollector({ time: 300_000 });

  collector.on("collect", async (ci) => {
    if (ci.user.id !== interaction.user.id) {
      await ci.reply({ content: "These controls aren't for you!", flags: 64 });
      return;
    }
    if (ci.customId === cfg.cancelButtonId) {
      aborted = true;
      await ci.deferUpdate().catch(() => {});
      collector.stop("aborted");
      if (childRef?.kill) {
        childRef.kill("SIGTERM");
        setTimeout(() => { if (childRef?.killed === false) childRef.kill("SIGKILL"); }, 5000);
      }
    }
  });

  collector.on("end", async (_c, reason) => {
    if (reason === "aborted") return;
    try { await interaction.editReply({ components: [] }); } catch { /* ignore */ }
  });

  // Poll for updates every 2s; also send a heartbeat if 4s passes with no update
  const updateInterval = setInterval(async () => {
    if (aborted) return;
    const timeSinceLastUpdate = Date.now() - lastUpdateTime;
    if (!pendingUpdate && timeSinceLastUpdate < 4000) return;
    pendingUpdate = false;
    lastUpdateTime = Date.now();
    updateCount++;
    try {
      await interaction.editReply({ embeds: [makeEmbed()], components: [buildCancelRow(true)] });
    } catch { /* best-effort, ignore rate limits */ }
  }, 2000);

  const result = await runComposeStreaming(
    ["--progress", "json", ...cfg.composeArgs],
    project,
    (stdoutChunk, stderrChunk) => {
      const chunk = stdoutChunk || stderrChunk;
      if (!chunk) return;
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) updateProgressFromJsonLine(line, progress, cfg.statusMapper);
      pendingUpdate = true;
    },
    (child) => { childRef = child; },
  );

  clearInterval(updateInterval);

  // Flush any remaining buffered output
  const finalLines = [buffer, result.stdout, result.stderr].join("\n").split("\n");
  for (const line of finalLines) updateProgressFromJsonLine(line, progress, cfg.statusMapper);

  if (aborted) {
    await interaction.editReply({
      embeds: [makeEmbed({ title: cfg.cancelledTitle, color: COLORS.WARNING, heading: "Summary", footerText: "Cancelled" })],
      components: [],
    });
    return;
  }

  if (progress.errorMessage) {
    await interaction.editReply({ embeds: [createErrorEmbed(cfg.failedTitle, progress.errorMessage)], components: [] });
    return;
  }

  if (!result.ok) {
    await interaction.editReply({
      embeds: [createErrorEmbed(cfg.failedTitle, cfg.failedDescription, result.stderr)],
      components: [],
    });
    return;
  }

  await interaction.editReply({
    embeds: [makeEmbed({ title: cfg.successTitle, color: COLORS.SUCCESS, heading: "Summary", footerText: "Completed", isComplete: true })],
    components: [],
  });
}
