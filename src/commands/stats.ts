import os from "node:os";
import { ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import {
  listContainers,
  getDockerInfo,
  getDockerDiskUsage,
} from "../services/dockerApi";
import { COLORS, ICONS, createErrorEmbed } from "../utils/embeds";
import { formatBytes } from "../utils/formatting";
import { safeDeferReply } from "../utils/interactions";

function formatDuration(seconds: number): string {
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

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export async function handleStats(interaction: ChatInputCommandInteraction) {
  const deferred = await safeDeferReply(interaction);
  if (!deferred) return;

  const [containersResult, infoResult, dfResult] = await Promise.all([
    listContainers(undefined, true),
    getDockerInfo(),
    getDockerDiskUsage(),
  ]);

  if (!containersResult.ok) {
    const embed = createErrorEmbed(
      "Stats Failed",
      "Unable to list containers",
      containersResult.error
    );
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (!infoResult.ok) {
    const embed = createErrorEmbed(
      "Stats Failed",
      "Unable to get Docker info",
      infoResult.error
    );
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (!dfResult.ok) {
    const embed = createErrorEmbed(
      "Stats Failed",
      "Unable to get Docker disk usage",
      dfResult.error
    );
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const containers = containersResult.data ?? [];
  const info = infoResult.data as any;
  const df = dfResult.data as any;

  // Container statistics
  const running = containers.filter((c: any) => c.State === "running").length;
  const paused = containers.filter((c: any) => c.State === "paused").length;
  const stopped = containers.filter((c: any) => c.State === "exited").length;
  const restarting = containers.filter(
    (c: any) => c.State === "restarting"
  ).length;
  const unhealthy = containers.filter(
    (c: any) => c.State === "running" && c.Status?.includes("unhealthy")
  ).length;

  // Resource counts
  const imagesCount = Array.isArray(df.Images) ? df.Images.length : 0;
  const volumesCount = Array.isArray(df.Volumes) ? df.Volumes.length : 0;
  const networksCount = info.Networks ?? 0;

  // Disk usage breakdown
  const imageSpace =
    df.Images?.reduce((acc: number, img: any) => acc + (img.Size ?? 0), 0) ?? 0;
  const containerSpace =
    df.Containers?.reduce((acc: number, c: any) => acc + (c.SizeRw ?? 0), 0) ??
    0;
  const volumeSpace =
    df.Volumes?.reduce(
      (acc: number, v: any) => acc + (v.UsageData?.Size ?? 0),
      0
    ) ?? 0;
  const buildCacheSpace =
    df.BuildCache?.reduce((acc: number, bc: any) => acc + (bc.Size ?? 0), 0) ??
    0;
  const totalDiskUsage =
    imageSpace + containerSpace + volumeSpace + buildCacheSpace;
  const reclaimableSpace = df.LayersSize ?? 0;

  // Host system resources
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const memUsagePercent = (usedMem / totalMem) * 100;

  const loadAvg = os.loadavg();
  const cpuCount = os.cpus().length;

  // Docker daemon info
  const dockerVersion = info.ServerVersion ?? "unknown";
  const dockerApiVersion = info.ApiVersion ?? "unknown";
  const storageDriver = info.Driver ?? "unknown";
  const loggingDriver = info.LoggingDriver ?? "unknown";
  const cgroupDriver = info.CgroupDriver ?? "unknown";
  const cgroupVersion = info.CgroupVersion ?? "unknown";
  const kernelVersion = info.KernelVersion ?? "unknown";
  const osArch = `${info.OperatingSystem ?? "unknown"} / ${
    info.Architecture ?? "?"
  }`;

  // Warnings and limits
  const warnings: string[] = [];
  if (unhealthy > 0)
    warnings.push(
      `${unhealthy} unhealthy container${unhealthy > 1 ? "s" : ""}`
    );
  if (restarting > 0) warnings.push(`${restarting} restarting`);
  if (memUsagePercent > 90) warnings.push("High memory usage (>90%)");
  if (loadAvg[0] > cpuCount * 2) warnings.push("High system load");
  if (reclaimableSpace > 10 * 1024 * 1024 * 1024)
    warnings.push(`${formatBytes(reclaimableSpace)} reclaimable`);

  const embed = new EmbedBuilder()
    .setTitle("📊 Docker Engine Statistics")
    .setColor(warnings.length > 0 ? COLORS.WARNING : COLORS.SUCCESS)
    .setTimestamp();

  // Container summary with health info
  const containerLines: string[] = [];
  containerLines.push(
    `${ICONS.RUNNING} Running: **${running}**${
      unhealthy > 0 ? ` (${unhealthy} unhealthy)` : ""
    }`
  );
  if (paused > 0) containerLines.push(`⏸️ Paused: **${paused}**`);
  if (restarting > 0) containerLines.push(`🔄 Restarting: **${restarting}**`);
  containerLines.push(`${ICONS.STOPPED} Stopped: **${stopped}**`);
  containerLines.push(`Total: **${containers.length}**`);

  embed.addFields({
    name: "Containers",
    value: containerLines.join("\n"),
    inline: true,
  });

  // Resource inventory
  embed.addFields({
    name: "Resources",
    value: [
      `📦 Images: **${imagesCount}**`,
      `💾 Volumes: **${volumesCount}**`,
      `🌐 Networks: **${networksCount}**`,
    ].join("\n"),
    inline: true,
  });

  // Disk usage breakdown
  embed.addFields({
    name: "Disk Usage",
    value: [
      `Total: **${formatBytes(totalDiskUsage)}**`,
      `  ├─ Images: ${formatBytes(imageSpace)}`,
      `  ├─ Containers: ${formatBytes(containerSpace)}`,
      `  ├─ Volumes: ${formatBytes(volumeSpace)}`,
      `  └─ Build Cache: ${formatBytes(buildCacheSpace)}`,
      reclaimableSpace > 0
        ? `\n🗑️ Reclaimable: **${formatBytes(reclaimableSpace)}**`
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
    inline: false,
  });

  // Host system metrics
  embed.addFields({
    name: "Host System",
    value: [
      `⏱️ Uptime: **${formatDuration(os.uptime())}**`,
      `🧠 Memory: **${formatBytes(usedMem)}** / **${formatBytes(
        totalMem
      )}** (${formatPercent(memUsagePercent)})`,
      `⚡ CPU Load: **${loadAvg[0].toFixed(2)}** / **${loadAvg[1].toFixed(
        2
      )}** / **${loadAvg[2].toFixed(2)}** (${cpuCount} cores)`,
      `💻 Kernel: ${kernelVersion}`,
    ].join("\n"),
    inline: true,
  });

  // Docker daemon details
  embed.addFields({
    name: "Docker Engine",
    value: [
      `Version: **${dockerVersion}**`,
      `API: **${dockerApiVersion}**`,
      `Storage: **${storageDriver}**`,
      `Logging: **${loggingDriver}**`,
      `Cgroup: **${cgroupDriver}** (v${cgroupVersion})`,
    ].join("\n"),
    inline: true,
  });

  // Platform info
  embed.addFields({
    name: "Platform",
    value: [
      `OS: **${osArch}**`,
      `Hostname: **${os.hostname()}**`,
      `Arch: **${os.arch()}**`,
    ].join("\n"),
    inline: false,
  });

  // Warnings section if any
  if (warnings.length > 0) {
    embed.addFields({
      name: "⚠️ Warnings",
      value: warnings.map((w) => `• ${w}`).join("\n"),
      inline: false,
    });
  }

  embed.setFooter({
    text:
      warnings.length > 0
        ? `${warnings.length} warning${warnings.length > 1 ? "s" : ""} detected`
        : "All systems operational",
  });

  await interaction.editReply({ embeds: [embed] });
}
