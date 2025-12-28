import { REST, Routes } from "discord.js";
import { config } from "./config/index";
import { getSlashCommandsJson } from "./slashCommands";

async function register() {
  const rest = new REST({ version: "10" }).setToken(config.token);

  for (const guildId of config.guildAllowList) {
    console.log(`Registering commands for guild ${guildId}...`);
    await rest.put(
      Routes.applicationGuildCommands(config.appId, guildId),
      {
        body: getSlashCommandsJson(),
      },
    );
  }

  console.log("Done.");
}

register().catch((err) => {
  console.error("Failed to register commands", err);
  process.exit(1);
});
