import fs from "node:fs";
import readline from "node:readline";
import type { ModelMonitorRecord, ModelMonitorSession } from "../model-monitor";

export type Group = { session: ModelMonitorSession; records: ModelMonitorRecord[] };
export const text = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 && v.length <= 256 ? v : undefined;
export const tokens = (v: unknown): number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : 0;
export async function stamp(file: string): Promise<string> {
  try {
    const s = await fs.promises.stat(file);
    return `${s.mtimeMs}:${s.size}`;
  } catch {
    return "missing";
  }
}
export const exists = (file: string) =>
  fs.promises.access(file).then(
    () => true,
    () => false,
  );
export async function lines(file: string, read: (row: any) => void): Promise<void> {
  const stream = fs.createReadStream(file, { encoding: "utf8" });
  const input = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of input) {
      let row: any;
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      if (row && typeof row === "object") read(row);
    }
  } finally {
    input.close();
    stream.destroy();
  }
}
