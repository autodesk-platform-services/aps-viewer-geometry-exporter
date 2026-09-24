import { type ExportFormat, type ExportProgress, type ExportResult } from './exportModels.ts';
import type { ExtractOptions } from './extract/extractScene.ts';
import { type InspectReport } from './inspect.ts';
export declare const EXTENSION_ID = "GeometryExporterExtension";
export interface ExportCallOptions {
    format: ExportFormat;
    /** Models to export; defaults to all models loaded in the viewer. */
    models?: Autodesk.Viewing.Model[];
    options?: Partial<ExtractOptions>;
    onProgress?: (progress: ExportProgress) => void;
    signal?: AbortSignal;
}
export declare function isSceneApiEnabled(): boolean;
/** Public API of the loaded extension (`viewer.getExtension(EXTENSION_ID)`). */
export interface GeometryExporterExtension extends Autodesk.Viewing.Extension {
    /** Exports the models and returns the file contents without downloading them. */
    export(call: ExportCallOptions): Promise<ExportResult>;
    /** Exports the models and downloads the resulting file. */
    download(call: ExportCallOptions & {
        filename?: string;
    }): Promise<ExportResult>;
    /** Logs the raw Scene API data shapes for a few instances of each model. */
    inspect(sampleCount?: number): Promise<InspectReport[]>;
}
export type GeometryExporterExtensionClass = new (viewer: Autodesk.Viewing.GuiViewer3D, options?: object) => GeometryExporterExtension;
/**
 * Creates the extension class. Defined lazily because the base class only exists
 * once the viewer script has been loaded.
 */
export declare function createGeometryExporterExtensionClass(): GeometryExporterExtensionClass;
/** Registers the extension with the viewer's extension manager (idempotent). */
export declare function registerGeometryExporterExtension(): void;
