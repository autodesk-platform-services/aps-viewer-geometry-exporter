import { exportModels, type ExportFormat, type ExportProgress, type ExportResult } from './exportModels.ts';
import type { ExtractOptions } from './extract/extractScene.ts';
import { describeModel } from './extract/extractScene.ts';
import { inspectModels, type InspectReport } from './inspect.ts';
import { createExportPanelClass, injectStyles } from './ui/ExportPanel.ts';
import { downloadBlob, sanitizeFileName } from './util/download.ts';

export const EXTENSION_ID = 'GeometryExporterExtension';

export interface ExportCallOptions {
    format: ExportFormat;
    /** Models to export; defaults to all models loaded in the viewer. */
    models?: Autodesk.Viewing.Model[];
    options?: Partial<ExtractOptions>;
    onProgress?: (progress: ExportProgress) => void;
    signal?: AbortSignal;
}

export function isSceneApiEnabled(): boolean {
    const av = Autodesk.Viewing;
    const flag = av.PublicFeatureFlags?.SceneAPI;
    return !!flag && av.FeatureFlags?.isEnabled(flag) === true;
}

/** Public API of the loaded extension (`viewer.getExtension(EXTENSION_ID)`). */
export interface GeometryExporterExtension extends Autodesk.Viewing.Extension {
    /** Exports the models and returns the file contents without downloading them. */
    export(call: ExportCallOptions): Promise<ExportResult>;
    /** Exports the models and downloads the resulting file. */
    download(call: ExportCallOptions & { filename?: string }): Promise<ExportResult>;
    /** Logs the raw Scene API data shapes for a few instances of each model. */
    inspect(sampleCount?: number): Promise<InspectReport[]>;
}

export type GeometryExporterExtensionClass = new (viewer: Autodesk.Viewing.GuiViewer3D, options?: object) => GeometryExporterExtension;

/**
 * Creates the extension class. Defined lazily because the base class only exists
 * once the viewer script has been loaded.
 */
export function createGeometryExporterExtensionClass(): GeometryExporterExtensionClass {
    const ExportPanel = createExportPanelClass();

    return class GeometryExporterExtension extends Autodesk.Viewing.Extension {
        private panel: Autodesk.Viewing.UI.DockingPanel | null = null;
        private group: Autodesk.Viewing.UI.ControlGroup | null = null;
        private button: Autodesk.Viewing.UI.Button | null = null;

        load(): boolean {
            if (!isSceneApiEnabled()) {
                console.error(
                    `[GeometryExporter] The Scene API is not enabled. Call ` +
                    `Autodesk.Viewing.FeatureFlags.set(Autodesk.Viewing.PublicFeatureFlags.SceneAPI, true) ` +
                    `before Autodesk.Viewing.Initializer. Exports will not work.`
                );
            }
            injectStyles();
            if (this.viewer.toolbar) {
                this.onToolbarCreated(this.viewer.toolbar);
            }
            return true;
        }

        unload(): boolean {
            if (this.group && this.button) {
                this.group.removeControl(this.button);
                this.viewer.toolbar?.removeControl(this.group);
            }
            this.group = this.button = null;
            if (this.panel) {
                this.panel.setVisible(false);
                this.panel.uninitialize();
                this.panel = null;
            }
            return true;
        }

        onToolbarCreated(toolbar: Autodesk.Viewing.UI.ToolBar): void {
            if (this.button) {
                return;
            }
            this.group = new Autodesk.Viewing.UI.ControlGroup('geometry-exporter-toolbar-group');
            this.button = new Autodesk.Viewing.UI.Button('geometry-exporter-button');
            this.button.setToolTip('Export geometry (GLB / USDZ)');
            this.button.addClass('geometry-exporter-button');
            this.button.onClick = () => this.togglePanel();
            this.group.addControl(this.button);
            toolbar.addControl(this.group);
        }

        private togglePanel(): void {
            if (!this.panel) {
                this.panel = new ExportPanel(this.viewer, {
                    onVisibilityChange: visible => this.updateButtonState(visible),
                    onExport: (format, options, signal, onProgress) => this.exportFromPanel(format, options, signal, onProgress),
                });
            }
            this.panel.setVisible(!this.panel.isVisible());
        }

        private updateButtonState(panelVisible: boolean): void {
            const { ACTIVE, INACTIVE } = Autodesk.Viewing.UI.Button.State;
            this.button?.setState(panelVisible ? ACTIVE : INACTIVE);
        }

        private async exportFromPanel(
            format: ExportFormat,
            options: ExtractOptions,
            signal: AbortSignal,
            onProgress: (fraction: number, label: string) => void
        ): Promise<string> {
            const models = this.viewer.getAllModels();
            if (models.length === 0) {
                throw new Error('no models are loaded');
            }
            const result = await this.download({
                format, options, models, signal,
                onProgress: p => {
                    if (p.phase === 'write') {
                        onProgress(1, `Writing ${format.toUpperCase()}…`);
                    } else {
                        const fraction = (p.model + (p.instances ? p.instance / p.instances : 1)) / p.models;
                        onProgress(fraction, `Reading model ${p.model + 1}/${p.models}: ${p.instance}/${p.instances} instances`);
                    }
                },
            });
            const { stats, diagnostics } = result;
            const size = (result.blob.size / (1024 * 1024)).toFixed(1);
            const warnings = diagnostics.total > 0 ? ` ${diagnostics.total} warning(s), see console.` : '';
            return `Exported ${stats.exportedObjects} objects (${stats.triangles.toLocaleString()} triangles, ${size} MB).${warnings}`;
        }

        /** Exports the models and returns the file contents without downloading them. */
        async export(call: ExportCallOptions): Promise<ExportResult> {
            return exportModels({
                models: call.models ?? this.viewer.getAllModels(),
                format: call.format,
                options: call.options,
                onProgress: call.onProgress,
                signal: call.signal,
            });
        }

        /** Exports the models and downloads the resulting file. */
        async download(call: ExportCallOptions & { filename?: string }): Promise<ExportResult> {
            const models = call.models ?? this.viewer.getAllModels();
            const result = await this.export({ ...call, models });
            const stem = models.length === 1 ? sanitizeFileName(describeModel(models[0], 0)) : 'models';
            downloadBlob(result.blob, call.filename ?? `${stem}.${call.format}`);
            return result;
        }

        /** Logs the raw Scene API data shapes for a few instances of each model. */
        inspect(sampleCount = 10): Promise<InspectReport[]> {
            return inspectModels(this.viewer.getAllModels(), sampleCount);
        }
    };
}

/** Registers the extension with the viewer's extension manager (idempotent). */
export function registerGeometryExporterExtension(): void {
    const registry = registerGeometryExporterExtension as { done?: boolean };
    if (registry.done) {
        return;
    }
    Autodesk.Viewing.theExtensionManager.registerExtension(EXTENSION_ID, createGeometryExporterExtensionClass());
    registry.done = true;
}
