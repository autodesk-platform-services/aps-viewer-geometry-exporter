import { Diagnostics, type ExportStats } from './diagnostics.ts';
import { type ExtractOptions, type ExtractProgress } from './extract/extractScene.ts';
export type ExportFormat = 'glb' | 'usdz';
export interface ExportRequest {
    models: Autodesk.Viewing.Model[];
    format: ExportFormat;
    options?: Partial<ExtractOptions>;
    onProgress?: (progress: ExportProgress) => void;
    signal?: AbortSignal;
    /** Reuse an existing collector, e.g. to inspect the entries afterwards. */
    diagnostics?: Diagnostics;
}
export type ExportProgress = ({
    phase: 'extract';
} & ExtractProgress) | {
    phase: 'write';
};
export interface ExportResult {
    blob: Blob;
    stats: ExportStats;
    diagnostics: Diagnostics;
}
/** Extracts the given models through the Scene API and serializes them. */
export declare function exportModels(request: ExportRequest): Promise<ExportResult>;
