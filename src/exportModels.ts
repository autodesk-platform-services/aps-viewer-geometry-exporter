import { Diagnostics, type ExportStats } from './diagnostics.ts';
import { extractScene, type ExtractOptions, type ExtractProgress } from './extract/extractScene.ts';
import { writeGlb } from './writers/glb.ts';
import { writeUsdz } from './writers/usdz.ts';

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

export type ExportProgress =
    | ({ phase: 'extract' } & ExtractProgress)
    | { phase: 'write' };

export interface ExportResult {
    blob: Blob;
    stats: ExportStats;
    diagnostics: Diagnostics;
}

/** Extracts the given models through the Scene API and serializes them. */
export async function exportModels(request: ExportRequest): Promise<ExportResult> {
    const { models, format, options, onProgress, signal } = request;
    const diagnostics = request.diagnostics ?? new Diagnostics();
    const start = performance.now();

    const extracted = await extractScene({
        models,
        options,
        diagnostics,
        signal,
        onProgress: p => onProgress?.({ phase: 'extract', ...p }),
    });
    try {
        signal?.throwIfAborted();
        onProgress?.({ phase: 'write' });
        const blob = format === 'glb'
            ? await writeGlb(extracted.scene)
            : await writeUsdz(extracted.scene, diagnostics);
        diagnostics.printSummary(extracted.stats, format, performance.now() - start);
        return { blob, stats: extracted.stats, diagnostics };
    } finally {
        extracted.dispose();
    }
}
