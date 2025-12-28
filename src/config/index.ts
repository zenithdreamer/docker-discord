import { z } from "zod";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import type { Config, Project, ProjectsConfig } from "../types/index";

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1, "DISCORD_TOKEN is required"),
  DISCORD_APP_ID: z.string().min(1, "DISCORD_APP_ID is required"),
  GUILD_WHITELIST: z.string().min(1, "GUILD_WHITELIST must list at least one guild id"),
  PROJECTS_CONFIG: z.string().default("./projects.json"),
});

const projectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  composePath: z.string().min(1),
  composeCommand: z.string().default("docker"),
});

const projectsConfigSchema = z.object({
  projects: z.array(projectSchema),
  docker: z.object({
    socketPath: z.string().default("/var/run/docker.sock"),
  }),
});

function loadProjectsConfig(configPath: string): ProjectsConfig {
  const resolvedPath = resolve(configPath);

  if (!existsSync(resolvedPath)) {
    throw new Error(
      `Projects config file not found: ${resolvedPath}\n` +
      `Please create it based on projects.example.json`,
    );
  }

  const fileContent = readFileSync(resolvedPath, "utf-8");
  const parsed = JSON.parse(fileContent);
  return projectsConfigSchema.parse(parsed);
}

const rawEnv = envSchema.parse(process.env);
const guildAllowList = rawEnv.GUILD_WHITELIST.split(",")
  .map((g) => g.trim())
  .filter(Boolean);

const projectsConfig = loadProjectsConfig(rawEnv.PROJECTS_CONFIG);

// Convert projects array to Map for easy lookup
const projectsMap = new Map<string, Project>();
for (const project of projectsConfig.projects) {
  projectsMap.set(project.id, project);
}

export const config: Config = {
  token: rawEnv.DISCORD_TOKEN,
  appId: rawEnv.DISCORD_APP_ID,
  guildAllowList,
  dockerSocket: projectsConfig.docker.socketPath,
  projects: projectsMap,
};

export function isGuildAllowed(guildId: string | null): boolean {
  if (!guildId) return false;
  return config.guildAllowList.includes(guildId);
}

export function getProject(projectId: string): Project | undefined {
  return config.projects.get(projectId);
}

export function getAllProjects(): Project[] {
  return Array.from(config.projects.values());
}

export function getProjectChoices() {
  return getAllProjects().map((p) => ({
    name: `${p.name} (${p.id})`,
    value: p.id,
  }));
}
