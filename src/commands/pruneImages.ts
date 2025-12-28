import { ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { pruneImages } from "../services/dockerApi";
import { COLORS, ICONS, createErrorEmbed } from "../utils/embeds";
import { formatBytes } from "../utils/formatting";
import { safeDeferReply } from "../utils/interactions";

export async function handlePruneImages(
  interaction: ChatInputCommandInteraction,
) {
  const deferred = await safeDeferReply(interaction);
  if (!deferred) return;

  const removeAll = interaction.options.getBoolean("all") ?? false;

  const working = new EmbedBuilder()
    .setTitle("🧹 Pruning Docker Images")
    .setColor(COLORS.IN_PROGRESS)
    .setDescription(
      removeAll
        ? "Removing all unused images (not just dangling)..."
        : "Removing dangling images...",
    )
    .setTimestamp();
  await interaction.editReply({ embeds: [working] });

  const result = await pruneImages(removeAll);

  if (!result.ok) {
    const embed = createErrorEmbed(
      "Image Prune Failed",
      "Could not prune Docker images",
      result.error,
    );
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const deleted = result.data?.ImagesDeleted ?? [];
  const reclaimedBytes = result.data?.SpaceReclaimed ?? 0;

  const summary = new EmbedBuilder()
    .setTitle("🧹 Image Prune Complete")
    .setColor(COLORS.SUCCESS)
    .setDescription(
      removeAll
        ? `${ICONS.SUCCESS} Removed unused images (dangling + untagged).`
        : `${ICONS.SUCCESS} Removed dangling images.`,
    )
    .setTimestamp()
    .addFields({
      name: "Space Reclaimed",
      value: formatBytes(reclaimedBytes),
      inline: true,
    });

  const deletedCount = deleted.length;
  if (deletedCount > 0) {
    const listed = deleted
      .map((d: any) => d.Deleted || d.Untagged)
      .filter(Boolean)
      .slice(0, 10);
    summary.addFields({
      name: `Images Removed (${deletedCount})`,
      value:
        listed.join("\n") +
        (deletedCount > listed.length
          ? `\n...and ${deletedCount - listed.length} more`
          : ""),
      inline: false,
    });
  } else {
    summary.addFields({
      name: "Images Removed",
      value: "None (nothing to prune)",
      inline: false,
    });
  }

  await interaction.editReply({ embeds: [summary] });
}
