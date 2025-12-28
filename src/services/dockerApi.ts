import Docker from "dockerode";
import { config } from "../config/index";
import type { Project } from "../types/index";

/**
 * Docker API Integration using dockerode
 *
 * This module provides direct Docker API access via dockerode library.
 * Prefer using these functions over CLI where possible for better performance
 * and structured data
 *
 */

export function getDockerClient(): Docker {
  return new Docker({
    socketPath: config.dockerSocket,
  });
}

export async function listContainers(project?: Project, all: boolean = true) {
  const docker = getDockerClient();

  try {
    const filters = project
      ? {
          label: [`com.docker.compose.project=${getProjectLabel(project)}`],
        }
      : undefined;

    const containers = await docker.listContainers({
      all,
      filters,
    });

    return { ok: true, data: containers };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function getContainerLogs(
  containerId: string,
  tail: number = 100,
) {
  const docker = getDockerClient();

  try {
    const container = docker.getContainer(containerId);
    const logs = await container.logs({
      stdout: true,
      stderr: true,
      tail,
      timestamps: false,
    });

    return { ok: true, data: logs.toString('utf-8') };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function pruneImages(removeAllUnused: boolean = false) {
  const docker = getDockerClient();

  try {
    // When removeAllUnused=false (default): only prune dangling images (no filter needed, dockerode default)
    // When removeAllUnused=true: prune ALL unused images by setting dangling=["false"] filter
    // This matches `docker image prune -a` behavior
    const options = removeAllUnused
      ? { filters: { dangling: ["false"] } }
      : undefined;

    const result = await docker.pruneImages(options);

    return { ok: true, data: result };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function getDockerInfo() {
  const docker = getDockerClient();

  try {
    const info = await docker.info();
    return { ok: true, data: info };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function getDockerDiskUsage() {
  const docker = getDockerClient();

  try {
    const df = await docker.df();
    return { ok: true, data: df };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

// Helper to get project label from compose path
function getProjectLabel(project: Project): string {
  // Docker Compose uses the directory name as project name by default
  const pathParts = project.composePath.split('/');
  return pathParts[pathParts.length - 1].toLowerCase();
}
