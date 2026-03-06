import { ICONS } from "./embeds";

export function formatDuration(seconds: number): string {
  const units: [number, string][] = [
    [86400, "d"],
    [3600, "h"],
    [60, "m"],
  ];
  let remaining = Math.floor(seconds);
  const parts: string[] = [];
  for (const [unitSeconds, label] of units) {
    if (remaining >= unitSeconds) {
      const value = Math.floor(remaining / unitSeconds);
      remaining -= value * unitSeconds;
      parts.push(`${value}${label}`);
    }
  }
  parts.push(`${remaining}s`);
  return parts.join(" ");
}

export function getServiceStateIcon(state: string): string {
  const lowerState = state.toLowerCase();
  if (lowerState.includes("up") || lowerState.includes("running")) {
    return ICONS.RUNNING;
  }
  if (lowerState.includes("paused")) {
    return ICONS.PAUSED;
  }
  return ICONS.STOPPED;
}

export function formatPorts(ports: string): string {
  if (!ports || ports.trim() === "") return "";

  // Split by comma and clean up
  const portList = ports.split(",").map((p) => p.trim());

  // Extract only the published ports (host side)
  const simplifiedPorts = portList.map((port) => {
    // Match patterns like "0.0.0.0:8080->80/tcp" or "[::]:8080->80/tcp"
    const match = port.match(/(?:0\.0\.0\.0|::):(\d+)->/);
    if (match) {
      return match[1];
    }
    // Match patterns like "8080/tcp" (exposed but not published)
    const exposedMatch = port.match(/(\d+)\/\w+/);
    if (exposedMatch) {
      return `${exposedMatch[1]} (internal)`;
    }
    return port;
  });

  // Remove duplicates (IPv4 and IPv6 might show same port twice)
  const uniquePorts = [...new Set(simplifiedPorts)];

  // If there are many ports, show a condensed version
  if (uniquePorts.length > 3) {
    return `${uniquePorts.slice(0, 3).join(", ")} +${uniquePorts.length - 3}`;
  }

  return uniquePorts.join(", ");
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}
