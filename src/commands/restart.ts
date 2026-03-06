import { ChatInputCommandInteraction } from "discord.js";
import { COLORS, ICONS } from "../utils/embeds";
import { safeDeferReply } from "../utils/interactions";
import { runStreamingCompose } from "../utils/streamingCommand";
import type { Project } from "../types/index";
import type { ServiceStatus } from "../utils/composeProgress";

const STATUS_MAP: Record<string, { status: string; event: string }> = {
  Restarting: { status: "restarting", event: "Restarting..." },
  Started: { status: "started", event: "Restarted successfully" },
  Running: { status: "running", event: "Already running" },
};

function statusMapper(status: string) {
  return STATUS_MAP[status] ?? null;
}

function getStatusIcon(status: string): string {
  if (status === "started") return ICONS.RUNNING;
  if (status === "restarting") return ICONS.WARNING;
  return ICONS.INFO;
}

function getStatusCounts(services: Map<string, ServiceStatus>) {
  let restarting = 0, started = 0, running = 0;
  for (const svc of services.values()) {
    if (svc.status === "restarting") restarting++;
    else if (svc.status === "started") started++;
    else if (svc.status === "running") running++;
  }
  return [
    { label: `${ICONS.WARNING} **${restarting}** Restarting`, count: restarting },
    { label: `${ICONS.RUNNING} **${started}** Restarted`, count: started },
    { label: `${ICONS.INFO} **${running}** Running`, count: running },
  ];
}

export async function handleRestart(interaction: ChatInputCommandInteraction, project: Project) {
  const deferred = await safeDeferReply(interaction);
  if (!deferred) return;

  await runStreamingCompose(interaction, project, {
    composeArgs: ["restart"],
    cancelButtonId: "restart_cancel",
    cancelButtonLabel: "Abort Restart",
    inProgressTitle: "🔄 Restarting Services",
    inProgressColor: COLORS.WARNING,
    cancelledTitle: "🚫 Restart Cancelled",
    successTitle: "✅ Restart Complete",
    failedTitle: "Compose Restart Failed",
    failedDescription: "Failed to restart services with docker compose restart",
    statusMapper,
    getStatusIcon,
    getStatusCounts,
  });
}
