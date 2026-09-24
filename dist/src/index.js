// Entry point. Importing this module registers 'GeometryExporterExtension' with the
// viewer, so the viewer script (viewer3D.js) must be loaded first.
import { registerGeometryExporterExtension } from './GeometryExporterExtension.js';
if (typeof Autodesk !== 'undefined' && Autodesk.Viewing?.theExtensionManager) {
    registerGeometryExporterExtension();
}
else {
    console.error('[GeometryExporter] Autodesk.Viewing is not available; load viewer3D.js before this module.');
}
export { EXTENSION_ID, registerGeometryExporterExtension, isSceneApiEnabled } from './GeometryExporterExtension.js';
export { exportModels } from './exportModels.js';
export { extractScene, DEFAULT_EXTRACT_OPTIONS } from './extract/extractScene.js';
export { Diagnostics } from './diagnostics.js';
export { inspectModels } from './inspect.js';
//# sourceMappingURL=index.js.map