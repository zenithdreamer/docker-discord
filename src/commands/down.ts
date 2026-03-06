import { ChatInputCommandInteraction } from "discord.js";
import { COLORS, ICONS } from "../utils/embeds";
import { safeDeferReply } from "../utils/interactions";
import { runStreamingCompose } from "../utils/streamingCommand";
import type { Project } from "../types/index";
import type { ServiceStatus } from "../utils/composeProgress";

const STATUS_MAP: Record<string, { status: string; event: string }> = {
  Stopping: { status: "stopping", event: "Stopping..." },
  Stopped: { status: "stopped", event: "Stopped" },
  Removing: { status: "removing", event: "Removing..." },
  Removed: { status: "removed", event: "Removed" },
};

function statusMapper(status: string) {
  return STATUS_MAP[status] ?? null;
}

function getStatusIcon(status: string): string {
  if (status === "removed") return "✅";
  if (status === "stopped") return ICONS.STOPPED;
  if (status === "stopping") return ICONS.WARNING;
  if (status === "removing") return ICONS.ERROR;
  return ICONS.INFO;
}

function getStatusCounts(services: Map<string, ServiceStatus>) {
  let stopping = 0, stopped = 0, removing = 0, removed = 0;
  for (const svc of services.values()) {
    if (svc.status === "stopping") stopping++;
    else if (svc.status === "stopped") stopped++;
    else if (svc.status === "removing") removing++;
    else if (svc.status === "removed") removed++;
  }
  return [
    { label: `${ICONS.WARNING} **${stopping}** Stopping`, count: stopping },
    { label: `${ICONS.ERROR} **${removing}** Removing`, count: removing },
    { label: `${ICONS.STOPPED} **${stopped}** Stopped`, count: stopped },
    { label: `✅ **${removed}** Removed`, count: removed },
  ];
}

export async function handleDown(interaction: ChatInputCommandInteraction, project: Project) {
  const deferred = await safeDeferReply(interaction);
  if (!deferred) return;

  await runStreamingCompose(interaction, project, {
    composeArgs: ["down"],
    cancelButtonId: "down_cancel",
    cancelButtonLabel: "Abort Down",
    inProgressTitle: "🛑 Stopping Services",
    inProgressColor: COLORS.WARNING,
    cancelledTitle: "🚫 Down Cancelled",
    successTitle: "✅ Compose Down Complete",
    failedTitle: "Compose Down Failed",
    failedDescription: "Failed to stop services with docker compose down",
    statusMapper,
    getStatusIcon,
    getStatusCounts,
  });
}
