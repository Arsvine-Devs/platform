export type LoadProjectEnvOptions = {
  cwd?: string;
  mode?: string;
};

export declare function loadProjectEnv(options?: LoadProjectEnvOptions): {
  loaded: string[];
};
