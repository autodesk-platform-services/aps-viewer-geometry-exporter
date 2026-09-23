import type { ExportFormat } from '../exportModels.ts';
import type { ExtractOptions } from '../extract/extractScene.ts';
import { DEFAULT_EXTRACT_OPTIONS } from '../extract/extractScene.ts';

export interface ExportPanelHandlers {
    /** Called whenever the panel is shown or hidden (including via its close button). */
    onVisibilityChange?(visible: boolean): void;
    onExport(format: ExportFormat, options: ExtractOptions, signal: AbortSignal, onProgress: (fraction: number, label: string) => void): Promise<string>;
}

const OPTION_LABELS: Record<keyof ExtractOptions, string> = {
    yUp: 'Convert to Y-up',
    toMeters: 'Convert units to meters',
    recenter: 'Center at origin',
    includeTextures: 'Include textures',
};

const STYLE_ID = 'geometry-exporter-styles';
const STYLES = `
.geometry-exporter-panel { width: 280px; height: auto; min-height: 0; left: 10px; top: 10px; resize: none; }
.geometry-exporter-panel .ge-body { padding: 12px; display: flex; flex-direction: column; gap: 10px; font-size: 13px; }
.geometry-exporter-panel fieldset { border: 1px solid rgba(128,128,128,0.4); border-radius: 4px; padding: 6px 10px; margin: 0; }
.geometry-exporter-panel legend { padding: 0 4px; opacity: 0.8; }
.geometry-exporter-panel label { display: block; margin: 3px 0; cursor: pointer; }
.geometry-exporter-panel .ge-buttons { display: flex; gap: 8px; }
.geometry-exporter-panel button { flex: 1; padding: 6px; cursor: pointer; }
.geometry-exporter-panel progress { width: 100%; }
.geometry-exporter-panel .ge-status { min-height: 1.2em; opacity: 0.85; word-break: break-word; }
.geometry-exporter-button .adsk-button-icon::before {
  content: ''; display: inline-block; width: 24px; height: 24px; background: currentColor;
  -webkit-mask: var(--ge-icon) center / 20px no-repeat; mask: var(--ge-icon) center / 20px no-repeat;
}
.geometry-exporter-button { --ge-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 2 3 7v10l9 5 9-5V7l-9-5zm0 2.3L18.7 8 12 11.7 5.3 8 12 4.3zM5 9.7l6 3.3v6.7l-6-3.3V9.7zm8 10V13l6-3.3v6.7l-6 3.3z'/%3E%3C/svg%3E"); }
`;

export function injectStyles(): void {
    if (document.getElementById(STYLE_ID)) {
        return;
    }
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLES;
    document.head.appendChild(style);
}

export type ExportPanelClass = new (viewer: Autodesk.Viewing.GuiViewer3D, handlers: ExportPanelHandlers) => Autodesk.Viewing.UI.DockingPanel;

/**
 * Creates the DockingPanel subclass. Defined lazily because the base class only exists
 * once the viewer script has been loaded.
 */
export function createExportPanelClass(): ExportPanelClass {
    return class ExportPanel extends Autodesk.Viewing.UI.DockingPanel {
        private readonly handlers: ExportPanelHandlers;
        private readonly formatInputs: HTMLInputElement[] = [];
        private readonly optionInputs = new Map<keyof ExtractOptions, HTMLInputElement>();
        private readonly exportButton: HTMLButtonElement;
        private readonly cancelButton: HTMLButtonElement;
        private readonly progress: HTMLProgressElement;
        private readonly status: HTMLDivElement;
        private abortController: AbortController | null = null;

        constructor(viewer: Autodesk.Viewing.GuiViewer3D, handlers: ExportPanelHandlers) {
            super(viewer.container, 'geometry-exporter-panel', 'Export Geometry', { addFooter: false });
            this.handlers = handlers;
            this.container.classList.add('geometry-exporter-panel');

            const body = document.createElement('div');
            // The docking panel itself is transparent; the viewer themes (dark/light) style this container class.
            body.className = 'ge-body docking-panel-container-solid-color-a';

            const formatSet = document.createElement('fieldset');
            formatSet.innerHTML = '<legend>Format</legend>';
            for (const [value, label] of [['glb', 'GLB (glTF binary)'], ['usdz', 'USDZ']] as const) {
                const input = document.createElement('input');
                input.type = 'radio';
                input.name = 'geometry-exporter-format';
                input.value = value;
                input.checked = value === 'glb';
                this.formatInputs.push(input);
                formatSet.appendChild(labelled(input, label));
            }
            body.appendChild(formatSet);

            const optionSet = document.createElement('fieldset');
            optionSet.innerHTML = '<legend>Options</legend>';
            for (const key of Object.keys(OPTION_LABELS) as (keyof ExtractOptions)[]) {
                const input = document.createElement('input');
                input.type = 'checkbox';
                input.checked = DEFAULT_EXTRACT_OPTIONS[key];
                this.optionInputs.set(key, input);
                optionSet.appendChild(labelled(input, OPTION_LABELS[key]));
            }
            body.appendChild(optionSet);

            const buttons = document.createElement('div');
            buttons.className = 'ge-buttons';
            this.exportButton = document.createElement('button');
            this.exportButton.textContent = 'Export';
            this.exportButton.onclick = () => this.runExport();
            this.cancelButton = document.createElement('button');
            this.cancelButton.textContent = 'Cancel';
            this.cancelButton.disabled = true;
            this.cancelButton.onclick = () => this.abortController?.abort();
            buttons.append(this.exportButton, this.cancelButton);
            body.appendChild(buttons);

            this.progress = document.createElement('progress');
            this.progress.max = 1;
            this.progress.value = 0;
            this.progress.hidden = true;
            body.appendChild(this.progress);

            this.status = document.createElement('div');
            this.status.className = 'ge-status';
            body.appendChild(this.status);

            this.container.appendChild(body);
        }

        setVisible(show: boolean): void {
            super.setVisible(show);
            this.handlers?.onVisibilityChange?.(show);
        }

        private async runExport(): Promise<void> {
            const format = (this.formatInputs.find(i => i.checked)?.value ?? 'glb') as ExportFormat;
            const options = { ...DEFAULT_EXTRACT_OPTIONS };
            for (const [key, input] of this.optionInputs) {
                options[key] = input.checked;
            }
            this.abortController = new AbortController();
            this.setBusy(true);
            this.status.textContent = 'Exporting…';
            try {
                const message = await this.handlers.onExport(format, options, this.abortController.signal, (fraction, label) => {
                    this.progress.value = fraction;
                    this.status.textContent = label;
                });
                this.status.textContent = message;
            } catch (err) {
                const aborted = (err as Error)?.name === 'AbortError';
                this.status.textContent = aborted ? 'Export cancelled.' : `Export failed: ${(err as Error)?.message ?? err}`;
                if (!aborted) {
                    console.error('[GeometryExporter] export failed', err);
                }
            } finally {
                this.setBusy(false);
                this.abortController = null;
            }
        }

        private setBusy(busy: boolean): void {
            this.exportButton.disabled = busy;
            this.cancelButton.disabled = !busy;
            this.progress.hidden = !busy;
            this.progress.value = 0;
        }
    };
}

function labelled(input: HTMLInputElement, text: string): HTMLLabelElement {
    const label = document.createElement('label');
    label.append(input, ` ${text}`);
    return label;
}
