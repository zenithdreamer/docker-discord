import { Client, REST, Routes } from "discord.js";
import { config } from "../config/index";
import { getSlashCommandsJson, getGlobalCommandsJson } from "../slashCommands";

export async function clearAndRegisterCommandsForGuild(
  guildId: string,
  rest: REST,
  guildName?: string,
) {
  try {
    // Clear existing guild commands
    console.log(`Clearing old commands for ${guildName ? `${guildName} ` : ""}(${guildId})...`);
    await rest.put(Routes.applicationGuildCommands(config.appId, guildId), {
      body: [],
    });

    // Register new commands (dynamically generated from config)
    const commands = getSlashCommandsJson();
    await rest.put(Routes.applicationGuildCommands(config.appId, guildId), {
      body: commands,
    });
    console.log(
      `Registered ${commands.length} slash commands for ${guildName ? `${guildName} ` : ""}(${guildId})`,
    );
  } catch (err) {
    console.error(`Failed to register commands for guild ${guildId}`, err);
  }
}

export async function registerCommandsForAllGuilds(client: Client) {
  const rest = new REST({ version: "10" }).setToken(config.token);
  const guilds = await client.guilds.fetch();
  console.log(`Registering slash commands for ${guilds.size} guild(s)...`);
  for (const [guildId, guild] of guilds) {
    await clearAndRegisterCommandsForGuild(guildId, rest, guild.name);
  }
  console.log("Slash command registration complete.");
}

export async function registerGlobalCommands() {
  const rest = new REST({ version: "10" }).setToken(config.token);
  const commands = getGlobalCommandsJson();
  console.log(`Registering ${commands.length} global command(s)...`);
  await rest.put(Routes.applicationCommands(config.appId), { body: commands });
  console.log("Global command registration complete.");
}
