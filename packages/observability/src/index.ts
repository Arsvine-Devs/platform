export type LogLevel = "info" | "warn" | "error";

export function log(
  level: LogLevel,
  fields: {
    service: string;
    operation: string;
    requestId?: string;
    releaseId?: string;
    jobId?: string;
    message?: string;
  },
) {
  process.stdout.write(
    `${JSON.stringify({ timestamp: new Date().toISOString(), level, ...fields })}\n`,
  );
}
