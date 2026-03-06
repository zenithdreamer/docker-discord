import { EmbedBuilder } from "discord.js";
import { COLORS, ICONS } from "./embeds";
import { formatBytes } from "./formatting";
import type { ServicePullStatus, LayerProgress } from "../types/index";

export interface ServiceStatus {
  name: string;
  status: string;
  latestEvent: string;
}

export interface ComposeProgress {
  networks: Map<string, string>;
  services: Map<string, ServiceStatus>;
  errorMessage: string;
  pullServices: Map<string, ServicePullStatus>;
  isPulling: boolean;
}

export function createEmptyProgress(): ComposeProgress {
  return {
    networks: new Map(),
    services: new Map(),
    errorMessage: "",
    pullServices: new Map(),
    isPulling: false,
  };
}

export function updateProgressFromJsonLine(
  line: string,
  progress: ComposeProgress,
  statusMapper: (status: string) => { status: string; event: string } | null
): void {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith("{")) return;

  try {
    const event = JSON.parse(trimmed);

    // Handle errors
    if (event.error === true && event.message) {
      progress.errorMessage = event.message;
      return;
    }

    const id = event.id || "";
    const status = event.status || "";
    const text: string = event.text || status || "";

    // Handle pull events
    const serviceName = resolveServiceName(event);
    if (serviceName && isPullEvent(text)) {
      progress.isPulling = true;
      handlePullEvent(event, serviceName, progress);
      return;
    }

    // Extract name from id
    let name = id;
    if (id.startsWith("Container ")) {
      name = id.replace("Container ", "");
    } else if (id.startsWith("Network ")) {
      name = id.replace("Network ", "");
    }

    // Parse container/service events
    if (id.startsWith("Container")) {
      // If we were pulling, mark pulling as complete when containers start being created
      if (progress.isPulling) {
        progress.isPulling = false;
      }

      const service = progress.services.get(name) || {
        name,
        status: "",
        latestEvent: "",
      };

      const mapped = statusMapper(status);
      if (mapped) {
        service.status = mapped.status;
        service.latestEvent = mapped.event;
        progress.services.set(name, service);
      }
    }

    // Parse network events
    if (id.startsWith("Network")) {
      progress.networks.set(name, status);
    }
  } catch (err) {
    // Skip invalid JSON
  }
}

function isPullEvent(text: string): boolean {
  return /Pulling|Pulled|Downloading|Extracting|Waiting|Pull complete|Already exists|Verifying/i.test(text);
}

export function resolveServiceName(event: any): string | undefined {
  if (event.parent_id) return String(event.parent_id);
  const id = event.id;
  if (typeof id !== "string") return undefined;
  if (!isLayerId(id) || id.length < 10) return id;
  return undefined;
}

export function isLayerId(id: any): id is string {
  return typeof id === "string" && /^[a-f0-9]{6,64}$/.test(id);
}

export function normalizeAction(text: string): LayerProgress["action"] {
  if (/Extracting/i.test(text)) return "Extracting";
  if (/Pull complete/i.test(text) || /Pulled/i.test(text)) return "Pull complete";
  if (/Already exists/i.test(text)) return "Already exists";
  if (/Waiting/i.test(text)) return "Waiting";
  return "Downloading";
}

function handlePullEvent(event: any, serviceName: string, progress: ComposeProgress): void {
  const service = progress.pullServices.get(serviceName) ?? {
    status: "pulling",
    layers: new Map(),
  };

  const text: string = event.text || event.status || "";
  const current = Number(event.current ?? 0);
  const total = Number(event.total ?? 0);
  const percent = Number.isFinite(event.percent) ? Math.round(event.percent) : total > 0 ? Math.round((current / total) * 100) : 0;

  if (/Pulled/i.test(text) || /Pull complete/i.test(text)) {
    service.status = "pulled";
    // Calculate final size from all layers
    const totals = Array.from(service.layers.values()).map((l) => l.total || 0);
    (service as ServicePullStatus).finalSize = totals.reduce((acc, val) => acc + (Number.isFinite(val) ? val : 0), 0);
  } else if (/Already exists/i.test(text)) {
    service.status = "up-to-date";
  } else if (/Pulling/i.test(text)) {
    service.status = "pulling";
  } else if (/Waiting/i.test(text)) {
    service.status = "waiting";
  } else if (/interrupted/i.test(text) || /cancelled/i.test(text)) {
    service.status = "interrupted";
  }

  // Layer updates (when ID looks like a layer hash)
  if (isLayerId(event.id)) {
    const layer: LayerProgress = {
      id: event.id,
      action: normalizeAction(text),
      current,
      total,
      percentage: percent,
    };
    service.layers.set(layer.id, layer);
    if (layer.action === "Downloading" || layer.action === "Extracting") {
      (service as ServicePullStatus).currentLayer = layer.id;
    }
  }

  progress.pullServices.set(serviceName, service);
}

export function buildProgressEmbed(
  progress: ComposeProgress,
  updateCount: number,
  config: {
    title: string;
    color: number;
    heading: string;
    footerText: string;
    getStatusIcon: (status: string) => string;
    getStatusCounts: (services: Map<string, ServiceStatus>) => Array<{ label: string; count: number }>;
    isComplete?: boolean;
  }
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(config.title)
    .setColor(config.color)
    .setTimestamp()
    .setFooter({ text: config.footerText });

  const { networks, services, pullServices, isPulling } = progress;

  // If we're pulling images, show pull progress instead of container status
  if (isPulling && pullServices.size > 0) {
    const pullSummary = buildPullSummary(pullServices);
    embed.setDescription(`**⬇️ Pulling Images**\n\n${pullSummary}`);

    // Show pull progress for each service
    for (const [serviceName, serviceStatus] of pullServices.entries()) {
      let statusIcon: string = ICONS.INFO;
      let statusText = "Waiting";
      let percentText = "";
      let sizeSuffix = "";

      const hasActiveProgress = serviceStatus.layers.size > 0;

      if (serviceStatus.status === "pulled") {
        statusIcon = ICONS.SUCCESS;
        statusText = "Pulled";
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
        statusIcon = ICONS.PULLING;
        statusText = "Pulling";
        sizeSuffix = formatSizeSuffix(serviceStatus);
      }

      if (hasActiveProgress) {
        const layers = Array.from(serviceStatus.layers.values());

        let mainLayer = layers.find((l) =>
          l.id === serviceStatus.currentLayer &&
          l.action !== "Pull complete" &&
          l.action !== "Already exists"
        );

        if (!mainLayer) {
          mainLayer = layers.find((l) =>
            l.action === "Downloading" || l.action === "Extracting"
          );
        }

        if (!mainLayer) {
          mainLayer = layers.find((l) => l.action === "Waiting");
        }

        if (mainLayer && mainLayer.total > 0) {
          const current = mainLayer.current ? formatBytes(mainLayer.current) : "0B";
          const total = formatBytes(mainLayer.total);
          percentText = ` (${mainLayer.percentage}%)`;

          let actionPrefix = "📥";
          if (mainLayer.action === "Extracting") {
            actionPrefix = "📦";
          } else if (mainLayer.action === "Waiting") {
            actionPrefix = "⏳";
          }

          statusText = `${actionPrefix} ${current} / ${total}`;
        }
      }

      embed.addFields({
        name: `${statusIcon} ${serviceName}`,
        value: `${statusText}${percentText}${sizeSuffix}`,
        inline: true,
      });
    }

    return embed;
  }

  // Otherwise show container/service status
  const statusCounts = config.getStatusCounts(services);

  const summaryParts = statusCounts
    .filter(s => s.count > 0)
    .map(s => s.label);

  let summary: string;
  if (summaryParts.length > 0) {
    summary = summaryParts.join("  •  ");
  } else if (config.isComplete) {
    // When complete but no service data, show network count or generic success
    if (networks.size > 0) {
      summary = `${ICONS.SUCCESS} ${networks.size} network(s) configured`;
    } else {
      summary = `${ICONS.SUCCESS} Operation completed successfully`;
    }
  } else {
    summary = `${ICONS.INFO} Initializing...`;
  }

  embed.setDescription(`**${config.heading}**\n\n${summary}`);

  if (networks.size > 0) {
    const networkList = Array.from(networks.entries())
      .map(([name, status]) => {
        const icon = status === "Removed" ? "✅" : status === "Created" ? ICONS.SUCCESS : ICONS.INFO;
        return `${icon} ${name}${status !== "Created" && status !== "Removed" ? ` - ${status}` : ""}`;
      })
      .join("\n");

    embed.addFields({
      name: "🌐 Networks",
      value: networkList,
      inline: false,
    });
  }

  if (services.size === 0 && !config.isComplete) {
    embed.addFields({
      name: "Status",
      value: `${ICONS.LOADING} Waiting for services...`,
      inline: false,
    });
  } else if (services.size > 0) {
    for (const [serviceName, service] of services.entries()) {
      const statusIcon = config.getStatusIcon(service.status);
      const statusText = service.latestEvent;

      embed.addFields({
        name: `${statusIcon} ${serviceName}`,
        value: statusText,
        inline: true,
      });
    }
  }

  return embed;
}

function buildPullSummary(pullServices: Map<string, ServicePullStatus>): string {
  let pulled = 0;
  let upToDate = 0;
  let pulling = 0;

  for (const svc of pullServices.values()) {
    if (svc.status === "pulled") pulled++;
    else if (svc.status === "up-to-date") upToDate++;
    else if (svc.status === "pulling") pulling++;
  }

  const parts: string[] = [];
  if (pulling > 0) parts.push(`${ICONS.PULLING} **${pulling}** Pulling`);
  if (pulled > 0) parts.push(`${ICONS.SUCCESS} **${pulled}** Pulled`);
  if (upToDate > 0) parts.push(`${ICONS.INFO} **${upToDate}** Up to date`);

  return parts.length > 0 ? parts.join("  •  ") : `${ICONS.INFO} Initializing pull...`;
}

function formatSizeSuffix(serviceStatus: ServicePullStatus): string {
  const totals = Array.from(serviceStatus.layers.values()).map((l) => l.total || 0);
  const totalBytes = totals.reduce((acc, val) => acc + (Number.isFinite(val) ? val : 0), 0);
  if (!totalBytes) return "";
  return ` • ~${formatBytes(totalBytes)}`;
}
