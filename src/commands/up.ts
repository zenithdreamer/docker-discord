import { ChatInputCommandInteraction } from "discord.js";
import { COLORS, ICONS } from "../utils/embeds";
import { safeDeferReply } from "../utils/interactions";
import { runStreamingCompose } from "../utils/streamingCommand";
import type { Project } from "../types/index";
import type { ServiceStatus } from "../utils/composeProgress";

const STATUS_MAP: Record<string, { status: string; event: string }> = {
  Creating: { status: "creating", event: "Creating container..." },
  Created: { status: "created", event: "Container created" },
  Starting: { status: "starting", event: "Starting..." },
  Started: { status: "started", event: "Started" },
  Running: { status: "running", event: "Already running" },
  Done: { status: "done", event: "Running" },
  Recreate: { status: "recreating", event: "Recreating..." },
  Recreated: { status: "recreated", event: "Recreated" },
  Healthy: { status: "healthy", event: "Health check passed" },
};

function statusMapper(status: string) {
  return STATUS_MAP[status] ?? null;
}

function getStatusIcon(status: string): string {
  if (status === "healthy") return "💚";
  if (status === "started" || status === "running" || status === "done") return ICONS.RUNNING;
  if (status === "starting") return ICONS.STARTING;
  if (status === "creating") return ICONS.BUILDING;
  if (status === "recreating" || status === "recreated") return ICONS.WARNING;
  return ICONS.INFO;
}

function getStatusCounts(services: Map<string, ServiceStatus>) {
  let creating = 0, starting = 0, running = 0, healthy = 0, recreated = 0;
  for (const svc of services.values()) {
    if (svc.status === "creating") creating++;
    else if (svc.status === "starting") starting++;
    else if (svc.status === "started" || svc.status === "running" || svc.status === "done") running++;
    else if (svc.status === "healthy") healthy++;
    else if (svc.status === "recreated" || svc.status === "recreating") recreated++;
  }
  return [
    { label: `${ICONS.BUILDING} **${creating}** Creating`, count: creating },
    { label: `${ICONS.STARTING} **${starting}** Starting`, count: starting },
    { label: `${ICONS.RUNNING} **${running}** Running`, count: running },
    { label: `💚 **${healthy}** Healthy`, count: healthy },
    { label: `${ICONS.WARNING} **${recreated}** Recreated`, count: recreated },
  ];
}

export async function handleUp(interaction: ChatInputCommandInteraction, project: Project) {
  const deferred = await safeDeferReply(interaction);
  if (!deferred) return;

  await runStreamingCompose(interaction, project, {
    composeArgs: ["up", "-d"],
    cancelButtonId: "up_cancel",
    cancelButtonLabel: "Abort Up",
    inProgressTitle: "🚀 Starting Services",
    inProgressColor: COLORS.IN_PROGRESS,
    cancelledTitle: "🚫 Up Cancelled",
    successTitle: "✅ Compose Up Complete",
    failedTitle: "Compose Up Failed",
    failedDescription: "Failed to start services with docker compose up -d",
    statusMapper,
    getStatusIcon,
    getStatusCounts,
  });
}
