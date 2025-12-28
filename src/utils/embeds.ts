import { EmbedBuilder } from "discord.js";

export const COLORS = {
  SUCCESS: 0x00ff00,
  ERROR: 0xff0000,
  INFO: 0x3498db,
  WARNING: 0xffa500,
  IN_PROGRESS: 0xffff00,
} as const;

export const ICONS = {
  SUCCESS: "✅",
  ERROR: "❌",
  WARNING: "⚠️",
  INFO: "ℹ️",
  RUNNING: "🟢",
  STOPPED: "🔴",
  PAUSED: "🟡",
  PULLING: "⬇️",
  BUILDING: "🔨",
  STARTING: "🚀",
  LOADING: "⏳",
} as const;

export function createEmbed(
  title: string,
  options: {
    description?: string;
    color?: number;
    fields?: { name: string; value: string; inline?: boolean }[];
    footer?: string;
    timestamp?: boolean;
  } = {},
): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle(title).setColor(options.color ?? COLORS.INFO);

  if (options.description) {
    embed.setDescription(options.description);
  }

  if (options.fields && options.fields.length > 0) {
    embed.addFields(options.fields);
  }

  if (options.footer) {
    embed.setFooter({ text: options.footer });
  }

  if (options.timestamp) {
    embed.setTimestamp();
  }

  return embed;
}

export function createSuccessEmbed(title: string, description?: string): EmbedBuilder {
  return createEmbed(`${ICONS.SUCCESS} ${title}`, {
    description,
    color: COLORS.SUCCESS,
    timestamp: true,
  });
}

export function createErrorEmbed(
  title: string,
  error: string,
  details?: string,
): EmbedBuilder {
  const embed = createEmbed(`${ICONS.ERROR} ${title}`, {
    description: error,
    color: COLORS.ERROR,
    timestamp: true,
  });

  if (details) {
    // Account for code block markers (```\n and \n```) = 8 characters
    const maxLength = 1024 - 8;
    const truncated = truncateText(details, maxLength);
    embed.addFields({ name: "Details", value: `\`\`\`\n${truncated}\n\`\`\`` });
  }

  return embed;
}

export function truncateText(text: string, maxLength = 1024): string {
  if (text.length <= maxLength) return text;
  const truncateMsg = "\n... (truncated)";
  return text.slice(0, maxLength - truncateMsg.length) + truncateMsg;
}
