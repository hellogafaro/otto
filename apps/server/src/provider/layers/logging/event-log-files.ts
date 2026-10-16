import { RotatingFileSink } from "@otto/shared/logging";

import { type PendingRecord } from "./event-log-types.ts";

export async function writeBatchedMessages(
  sink: Pick<RotatingFileSink, "write">,
  records: ReadonlyArray<PendingRecord>,
  maxBytes: number,
): Promise<void> {
  let pendingRecords: Array<PendingRecord> = [];
  let pendingBytes = 0;

  const flush = async () => {
    if (pendingRecords.length === 0) return;
    await sink.write(pendingRecords.map((record) => record.line).join(""));
    pendingRecords = [];
    pendingBytes = 0;
  };

  for (const record of records) {
    if (pendingBytes > 0 && pendingBytes + record.bytes > maxBytes) {
      await flush();
    }

    pendingRecords.push(record);
    pendingBytes += record.bytes;

    if (pendingBytes >= maxBytes) {
      await flush();
    }
  }

  await flush();
}
