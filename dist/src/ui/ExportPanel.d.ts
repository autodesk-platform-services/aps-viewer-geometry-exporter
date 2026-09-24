import type { ExportFormat } from '../exportModels.ts';
import type { ExtractOptions } from '../extract/extractScene.ts';
export interface ExportPanelHandlers {
    /** Called whenever the panel is shown or hidden (including via its close button). */
    onVisibilityChange?(visible: boolean): void;
    onExport(format: ExportFormat, options: ExtractOptions, signal: AbortSignal, onProgress: (fraction: number, label: string) => void): Promise<string>;
}
export declare function injectStyles(): void;
export type ExportPanelClass = new (viewer: Autodesk.Viewing.GuiViewer3D, handlers: ExportPanelHandlers) => Autodesk.Viewing.UI.DockingPanel;
/**
 * Creates the DockingPanel subclass. Defined lazily because the base class only exists
 * once the viewer script has been loaded.
 */
export declare function createExportPanelClass(): ExportPanelClass;
