export type EnvSource = Record<string, string | undefined>;

export declare function readEnv(
  name: string,
  source?: EnvSource,
): string | undefined;

export declare function requiredEnv(name: string, source?: EnvSource): string;

export declare function readEnvList(
  name: string,
  source?: EnvSource,
): string[] | undefined;
