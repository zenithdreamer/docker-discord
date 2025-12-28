import {
  DiscordAPIError,
  InteractionDeferReplyOptions,
  MessageComponentInteraction,
  RepliableInteraction,
} from "discord.js";

const ACK_ERROR_CODES = new Set([10062, 40060]);

function isAckError(err: unknown): err is DiscordAPIError {
  return err instanceof DiscordAPIError && ACK_ERROR_CODES.has(err.code as number);
}

export async function safeDeferReply(
  interaction: RepliableInteraction,
  options?: InteractionDeferReplyOptions,
): Promise<boolean> {
  if (interaction.deferred || interaction.replied) return true;

  try {
    await interaction.deferReply(options);
    return true;
  } catch (err) {
    if (isAckError(err)) {
      console.warn("Interaction already acknowledged or expired. Skipping deferReply.");
      return false;
    }
    console.error("Failed to defer reply", err);
    return false;
  }
}

export async function safeDeferUpdate(interaction: MessageComponentInteraction): Promise<boolean> {
  if (interaction.deferred || interaction.replied) return true;

  try {
    await interaction.deferUpdate();
    return true;
  } catch (err) {
    if (isAckError(err)) {
      console.warn("Component interaction already acknowledged or expired. Skipping deferUpdate.");
      return false;
    }
    console.error("Failed to defer component interaction", err);
    return false;
  }
}
