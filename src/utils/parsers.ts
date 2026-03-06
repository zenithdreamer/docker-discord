import { ICONS } from "./embeds";
import { isLayerId, resolveServiceName, normalizeAction } from "./composeProgress";
import type { PullProgress, ServicePullStatus, LayerProgress } from "../types/index";

export function createEmptyPullProgress(): PullProgress {
  return {
    services: new Map(),
    summary: `${ICONS.INFO} Pull operation in progress...`,
    totalServices: 0,
    pulledCount: 0,
    upToDateCount: 0,
  };
}

export function updatePullProgressFromJsonLine(line: string, state: PullProgress): void {
  const trimmed = line.trim();
  if (!trimmed) return;

  let event: any;
  try {
    event = JSON.parse(trimmed);
  } catch {
    return; // ignore malformed line
  }

  const serviceName = resolveServiceName(event);
  if (!serviceName) return;

  const service = state.services.get(serviceName) ?? {
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
    // Handle interrupted/cancelled status from docker compose
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

  state.services.set(serviceName, service);
  recomputeSummary(state);
}

function recomputeSummary(state: PullProgress) {
  let pulled = 0;
  let upToDate = 0;

  for (const svc of state.services.values()) {
    if (svc.status === "pulled") pulled++;
    if (svc.status === "up-to-date") upToDate++;
  }

  state.pulledCount = pulled;
  state.upToDateCount = upToDate;
  state.totalServices = state.services.size;

  if (pulled > 0 && upToDate > 0) {
    state.summary = `${ICONS.SUCCESS} Pulled **${pulled}** new image(s)\n${ICONS.INFO} **${upToDate}** image(s) already up to date`;
  } else if (pulled > 0) {
    state.summary = `${ICONS.SUCCESS} Successfully pulled **${pulled}** image(s)`;
  } else if (upToDate > 0) {
    state.summary = `${ICONS.INFO} All images are up to date (**${upToDate}** checked)`;
  } else if (state.services.size > 0) {
    state.summary = `${ICONS.INFO} Pull operation in progress...`;
  } else {
    state.summary = `${ICONS.INFO} Waiting for pull output...`;
  }
}
