import { Diagnostics } from './diagnostics.js';
import { extractScene } from './extract/extractScene.js';
import { writeGlb } from './writers/glb.js';
import { writeUsdz } from './writers/usdz.js';
/** Extracts the given models through the Scene API and serializes them. */
export async function exportModels(request) {
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
    }
    finally {
        extracted.dispose();
    }
}
//# sourceMappingURL=exportModels.js.map