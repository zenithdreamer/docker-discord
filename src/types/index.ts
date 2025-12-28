export interface ComposeResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface PullProgress {
  services: Map<string, ServicePullStatus>;
  summary: string;
  totalServices: number;
  pulledCount: number;
  upToDateCount: number;
}

export interface ServicePullStatus {
  status: "pulling" | "pulled" | "up-to-date" | "waiting" | "interrupted";
  layers: Map<string, LayerProgress>;
  currentLayer?: string;
  finalSize?: number;
}

export interface LayerProgress {
  id: string;
  action: "Downloading" | "Extracting" | "Waiting" | "Pull complete" | "Already exists";
  current: number;
  total: number;
  percentage: number;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  composePath: string;
  composeCommand: string;
  projectName?: string;
}

export interface ProjectsConfig {
  projects: Project[];
  docker: {
    socketPath: string;
  };
}

export interface Config {
  token: string;
  appId: string;
  guildAllowList: string[];
  dockerSocket: string;
  projects: Map<string, Project>;
}
