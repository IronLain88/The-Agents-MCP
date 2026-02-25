import { formatBreadcrumb, applyBreadcrumb, applyNote } from "./station-log.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
interface StationLoggerDeps {
  enabled: boolean;
  loadProperty: () => Promise<any>;
  saveProperty: (property: any) => Promise<void>;
}

export function createStationLogger(deps: StationLoggerDeps) {
  let previousState: string | null = null;
  let previousStationId: string | null = null;
  let writeQueue = Promise.resolve();

  async function appendToLog(stationId: string, entry: string, isNote: boolean): Promise<void> {
    const property = await deps.loadProperty();
    const asset = (property.assets || []).find((a: any) => a.id === stationId);
    if (!asset) return;

    const log = asset.log || "";
    asset.log = isNote
      ? applyNote(log, entry)
      : applyBreadcrumb(log, formatBreadcrumb(entry));

    await deps.saveProperty(property);
  }

  return {
    async onStateUpdate(state: string, detail: string, note?: string): Promise<void> {
      if (!deps.enabled) return;

      try {
        if (previousState && previousState !== state && note && previousStationId) {
          writeQueue = writeQueue.then(() => appendToLog(previousStationId!, note, true));
          await writeQueue;
        }

        const property = await deps.loadProperty();
        const station = (property.assets || []).find((a: any) => a.station === state);
        const stationId = station?.id || null;

        if (stationId) {
          writeQueue = writeQueue.then(() => appendToLog(stationId, detail, false));
          await writeQueue;
        }

        previousState = state;
        previousStationId = stationId;
      } catch (err) {
        console.error("[station-logger] Write failed:", err);
      }
    },
  };
}
