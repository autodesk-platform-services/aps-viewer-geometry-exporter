import { exportModels } from './exportModels.js';
import { describeModel } from './extract/extractScene.js';
import { inspectModels } from './inspect.js';
import { createExportPanelClass, injectStyles } from './ui/ExportPanel.js';
import { downloadBlob, sanitizeFileName } from './util/download.js';
export const EXTENSION_ID = 'GeometryExporterExtension';
export function isSceneApiEnabled() {
    const av = Autodesk.Viewing;
    const flag = av.PublicFeatureFlags?.SceneAPI;
    return !!flag && av.FeatureFlags?.isEnabled(flag) === true;
}
/**
 * Creates the extension class. Defined lazily because the base class only exists
 * once the viewer script has been loaded.
 */
export function createGeometryExporterExtensionClass() {
    const ExportPanel = createExportPanelClass();
    return class GeometryExporterExtension extends Autodesk.Viewing.Extension {
        panel = null;
        group = null;
        button = null;
        load() {
            if (!isSceneApiEnabled()) {
                console.error(`[GeometryExporter] The Scene API is not enabled. Call ` +
                    `Autodesk.Viewing.FeatureFlags.set(Autodesk.Viewing.PublicFeatureFlags.SceneAPI, true) ` +
                    `before Autodesk.Viewing.Initializer. Exports will not work.`);
            }
            injectStyles();
            if (this.viewer.toolbar) {
                this.onToolbarCreated(this.viewer.toolbar);
            }
            return true;
        }
        unload() {
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
        onToolbarCreated(toolbar) {
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
        togglePanel() {
            if (!this.panel) {
                this.panel = new ExportPanel(this.viewer, {
                    onVisibilityChange: visible => this.updateButtonState(visible),
                    onExport: (format, options, signal, onProgress) => this.exportFromPanel(format, options, signal, onProgress),
                });
            }
            this.panel.setVisible(!this.panel.isVisible());
        }
        updateButtonState(panelVisible) {
            const { ACTIVE, INACTIVE } = Autodesk.Viewing.UI.Button.State;
            this.button?.setState(panelVisible ? ACTIVE : INACTIVE);
        }
        async exportFromPanel(format, options, signal, onProgress) {
            const models = this.viewer.getAllModels();
            if (models.length === 0) {
                throw new Error('no models are loaded');
            }
            const result = await this.download({
                format, options, models, signal,
                onProgress: p => {
                    if (p.phase === 'write') {
                        onProgress(1, `Writing ${format.toUpperCase()}…`);
                    }
                    else {
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
        async export(call) {
            return exportModels({
                models: call.models ?? this.viewer.getAllModels(),
                format: call.format,
                options: call.options,
                onProgress: call.onProgress,
                signal: call.signal,
            });
        }
        /** Exports the models and downloads the resulting file. */
        async download(call) {
            const models = call.models ?? this.viewer.getAllModels();
            const result = await this.export({ ...call, models });
            const stem = models.length === 1 ? sanitizeFileName(describeModel(models[0], 0)) : 'models';
            downloadBlob(result.blob, call.filename ?? `${stem}.${call.format}`);
            return result;
        }
        /** Logs the raw Scene API data shapes for a few instances of each model. */
        inspect(sampleCount = 10) {
            return inspectModels(this.viewer.getAllModels(), sampleCount);
        }
    };
}
/** Registers the extension with the viewer's extension manager (idempotent). */
export function registerGeometryExporterExtension() {
    const registry = registerGeometryExporterExtension;
    if (registry.done) {
        return;
    }
    Autodesk.Viewing.theExtensionManager.registerExtension(EXTENSION_ID, createGeometryExporterExtensionClass());
    registry.done = true;
}
//# sourceMappingURL=GeometryExporterExtension.js.map