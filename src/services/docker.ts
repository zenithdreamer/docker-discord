import { spawn } from "child_process";
import { existsSync } from "fs";
import { config } from "../config/index";
import type { ComposeResult, Project } from "../types/index";

/**
 * Docker Compose CLI Integration
 *
 * This module handles operations that require docker compose CLI.
 * For most Docker operations, prefer using dockerApi.ts which uses dockerode.
 *
 */

function composeArgs(args: string[], project: Project): string[] {
  // Compose CLI supports `docker compose ...`
  const baseArgs = ["compose", "--ansi", "never"];

  // Add project name if specified
  if (project.projectName) {
    baseArgs.push("-p", project.projectName);
  }

  return [...baseArgs, ...args];
}

export async function runCompose(args: string[], project: Project): Promise<ComposeResult> {
  const command = project.composeCommand;
  const fullArgs = composeArgs(args, project);

  try {
    if (!existsSync(project.composePath)) {
      return {
        ok: false,
        code: null,
        stdout: "",
        stderr: `Compose project path not found: ${project.composePath}`,
      };
    }

    return await new Promise<ComposeResult>((resolve) => {
      const child = spawn(command, fullArgs, {
        cwd: project.composePath,
        env: {
          ...process.env,
          DOCKER_HOST: `unix://${config.dockerSocket}`,
        },
      });

      let stdout = "";
      let stderr = "";

      child.on("error", (err) => {
        resolve({
          ok: false,
          code: null,
          stdout: "",
        stderr: err?.message || "Failed to start docker compose process.",
      });
    });

    child.stdout.on("data", (data) => {
        stdout += data.toString();
      });
      child.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      child.on("close", (code) => {
        resolve({
          ok: code === 0,
          code,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        });
      });
    });
  } catch (err: any) {
    // e.g. ENOENT if docker is missing from PATH.
    const message = err?.message || "Failed to run docker compose command.";
    return {
      ok: false,
      code: null,
      stdout: "",
      stderr: message,
    };
  }
}

export async function runComposeJson<T = unknown>(
  args: string[],
  project: Project,
): Promise<{ ok: boolean; data?: T; error?: string }> {
  const result = await runCompose(args, project);
  if (!result.ok) return { ok: false, error: result.stderr || result.stdout };

  try {
    // Docker compose ps --format json outputs newline-delimited JSON (NDJSON)
    // Each line is a separate JSON object
    const lines = result.stdout.trim().split("\n").filter((line) => line.trim());

    if (lines.length === 0) {
      return { ok: true, data: [] as T };
    }

    // If there's only one line, try parsing it as a single object or array
    if (lines.length === 1) {
      const parsed = JSON.parse(lines[0]);
      return { ok: true, data: (Array.isArray(parsed) ? parsed : [parsed]) as T };
    }

    // Multiple lines - parse each as NDJSON
    const data = lines.map((line) => JSON.parse(line));
    return { ok: true, data: data as T };
  } catch (err: any) {
    return {
      ok: false,
      error: `Failed to parse compose JSON output: ${err?.message ?? "unknown error"}`,
    };
  }
}

export async function runComposeStreaming(
  args: string[],
  project: Project,
  onUpdate?: (stdoutChunk: string, stderrChunk: string, stdout: string, stderr: string) => void,
  onStart?: (child: ReturnType<typeof spawn>) => void,
): Promise<ComposeResult> {
  const command = project.composeCommand;
  const fullArgs = composeArgs(args, project);

  if (!existsSync(project.composePath)) {
    return {
      ok: false,
      code: null,
      stdout: "",
      stderr: `Compose project path not found: ${project.composePath}`,
    };
  }

  return new Promise<ComposeResult>((resolve) => {
    const child = spawn(command, fullArgs, {
      cwd: project.composePath,
      env: {
        ...process.env,
        DOCKER_HOST: `unix://${config.dockerSocket}`,
      },
    });

    let stdout = "";
    let stderr = "";

    const safeResolve = (payload: ComposeResult) => {
      try {
        resolve(payload);
      } catch {
        // ignore resolve errors
      }
    };

    onStart?.(child);

    child.on("error", (err) => {
      safeResolve({
        ok: false,
        code: null,
        stdout,
        stderr: err?.message || "Failed to start docker compose process.",
      });
    });

    child.stdout.on("data", (data) => {
      const chunk = data.toString();
      stdout += chunk;
      onUpdate?.(chunk, "", stdout, stderr);
    });

    child.stderr.on("data", (data) => {
      const chunk = data.toString();
      stderr += chunk;
      onUpdate?.("", chunk, stdout, stderr);
    });

    child.on("close", (code) => {
      safeResolve({
        ok: code === 0,
        code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
  });
}
