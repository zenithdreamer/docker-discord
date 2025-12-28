import { SlashCommandBuilder } from "discord.js";
import { getProjectChoices } from "./config/index";

export function buildSlashCommands() {
  const projectChoices = getProjectChoices();

  return [
    new SlashCommandBuilder()
      .setName("status")
      .setDescription("Show docker compose status")
      .addStringOption((option) =>
        option
          .setName("project")
          .setDescription("Select project")
          .setRequired(true)
          .addChoices(...projectChoices),
      ),
    new SlashCommandBuilder()
      .setName("pull")
      .setDescription("Pull latest images via docker compose")
      .addStringOption((option) =>
        option
          .setName("project")
          .setDescription("Select project")
          .setRequired(true)
          .addChoices(...projectChoices),
      ),
    new SlashCommandBuilder()
      .setName("up")
      .setDescription("Run docker compose up -d")
      .addStringOption((option) =>
        option
          .setName("project")
          .setDescription("Select project")
          .setRequired(true)
          .addChoices(...projectChoices),
      ),
    new SlashCommandBuilder()
      .setName("down")
      .setDescription("Run docker compose down")
      .addStringOption((option) =>
        option
          .setName("project")
          .setDescription("Select project")
          .setRequired(true)
          .addChoices(...projectChoices),
      ),
    new SlashCommandBuilder()
      .setName("restart")
      .setDescription("Restart docker compose services")
      .addStringOption((option) =>
        option
          .setName("project")
          .setDescription("Select project")
          .setRequired(true)
          .addChoices(...projectChoices),
      ),
    new SlashCommandBuilder()
      .setName("logs")
      .setDescription("Tail logs for a compose service")
      .addStringOption((option) =>
        option
          .setName("project")
          .setDescription("Select project")
          .setRequired(true)
          .addChoices(...projectChoices),
      )
      .addStringOption((option) =>
        option
          .setName("service")
          .setDescription("Service name (optional)")
          .setRequired(false),
      )
      .addIntegerOption((option) =>
        option
          .setName("lines")
          .setDescription("Number of log lines (default 100)")
          .setRequired(false),
      ),
    new SlashCommandBuilder()
      .setName("stats")
      .setDescription("Show Docker and host stats"),
    new SlashCommandBuilder()
      .setName("prune-images")
      .setDescription("Prune unused Docker images")
      .addBooleanOption((option) =>
        option
          .setName("all")
          .setDescription("Remove all unused images (not just dangling)")
          .setRequired(false),
      ),
  ];
}

export function getSlashCommandsJson() {
  return buildSlashCommands().map((builder) => builder.toJSON());
}

export function getGlobalCommandsJson() {
  return [
    new SlashCommandBuilder()
      .setName("regenerate")
      .setDescription("Re-register slash commands for this server")
      .toJSON(),
  ];
}
