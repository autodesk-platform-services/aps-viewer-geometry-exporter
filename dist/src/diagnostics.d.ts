/**
 * Collects reports about unexpected data returned by the Scene API.
 *
 * Every report is recorded, but only the first few of each category are printed
 * to the console (with the raw Scene API object attached so it can be inspected).
 * A summary table is printed at the end of each export.
 */
export type DiagnosticCategory = 'no-geometry' | 'no-material' | 'no-position-reader' | 'vertex-count-zero' | 'non-finite-position' | 'non-finite-normal' | 'non-finite-matrix' | 'missing-normals' | 'no-normal-reader' | 'index-out-of-range' | 'index-count-not-multiple' | 'vertex-count-not-multiple' | 'unknown-material-type' | 'legacy-material' | 'unsupported-material-feature' | 'unexpected-color-value' | 'unexpected-scalar-value' | 'uv-undecodable' | 'color-undecodable' | 'unexpected-attribute-layout' | 'unknown-texture-image-type' | 'texture-draw-failed' | 'unexpected-side-value' | 'unexpected-wrap-value' | 'object-tree-unavailable' | 'unsupported-in-format' | 'exception';
export interface DiagnosticContext {
    model?: string;
    instanceId?: number;
    dbId?: number;
    name?: string;
}
export interface DiagnosticEntry {
    category: DiagnosticCategory;
    context: DiagnosticContext;
    details: Record<string, unknown>;
}
export interface ExportStats {
    models: number;
    instances: number;
    exportedObjects: number;
    skippedInstances: number;
    uniqueGeometries: number;
    uniqueMaterials: number;
    uniqueTextures: number;
    triangles: number;
    vertices: number;
}
export declare class Diagnostics {
    readonly entries: DiagnosticEntry[];
    readonly counts: Map<DiagnosticCategory, number>;
    readonly maxLoggedPerCategory: number;
    readonly silent: boolean;
    constructor(options?: {
        maxLoggedPerCategory?: number;
        silent?: boolean;
    });
    /**
     * Records an unexpected-data case.
     * @param details Any extra information; `raw` should hold the offending Scene API object.
     */
    report(category: DiagnosticCategory, context: DiagnosticContext, details?: Record<string, unknown>): void;
    /** Runs a Scene API getter and reports (instead of throwing) if it throws. */
    guard<T>(context: DiagnosticContext, what: string, fn: () => T, fallback: T): T;
    get total(): number;
    byCategory(category: DiagnosticCategory): DiagnosticEntry[];
    printSummary(stats: ExportStats, format: string, elapsedMs: number): void;
}
