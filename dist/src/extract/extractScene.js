import * as THREE from 'three';
import { convertGeometry } from './convertGeometry.js';
import { MaterialConverter } from './convertMaterial.js';
export const DEFAULT_EXTRACT_OPTIONS = {
    yUp: true,
    toMeters: true,
    recenter: false,
    includeTextures: true,
};
/** Maximum time spent processing before yielding to the event loop. */
const TIME_SLICE_MS = 30;
function createMatrixTarget() {
    const Matrix4 = globalThis.Autodesk?.Viewing?.Math?.Matrix4;
    return typeof Matrix4 === 'function' ? new Matrix4() : { elements: new Float32Array(16) };
}
const yieldToEventLoop = () => new Promise(resolve => setTimeout(resolve, 0));
export function describeModel(model, index) {
    try {
        const node = model.getDocumentNode?.();
        const name = node?.getModelName?.() || node?.name?.();
        if (name) {
            return name;
        }
        const urn = model.getData?.()?.urn;
        if (urn) {
            return urn;
        }
    }
    catch {
        // ignore; fall through to a generic name
    }
    return `model_${model.id ?? index}`;
}
/**
 * Reads all instances of the given models through the Scene API and builds an
 * equivalent THREE.Scene. Geometries, materials and textures shared between instances
 * stay shared in the result.
 */
export async function extractScene(params) {
    const { models, diagnostics, onProgress, signal } = params;
    const options = { ...DEFAULT_EXTRACT_OPTIONS, ...params.options };
    const materials = new MaterialConverter(diagnostics, { includeTextures: options.includeTextures });
    const geometries = new Map();
    const stats = {
        models: models.length, instances: 0, exportedObjects: 0, skippedInstances: 0,
        uniqueGeometries: 0, uniqueMaterials: 0, uniqueTextures: 0, triangles: 0, vertices: 0,
    };
    const scene = new THREE.Scene();
    const root = new THREE.Group();
    root.name = 'root';
    root.matrixAutoUpdate = false;
    scene.add(root);
    const matrixTarget = createMatrixTarget();
    let sliceStart = performance.now();
    const dispose = () => {
        materials.dispose();
        for (const byMode of geometries.values()) {
            for (const g of byMode.values()) {
                g?.dispose();
            }
        }
    };
    try {
        for (let m = 0; m < models.length; m++) {
            const model = models[m];
            const modelName = describeModel(model, m);
            const modelContext = { model: modelName };
            const group = new THREE.Group();
            group.name = modelName;
            group.matrixAutoUpdate = false;
            if (options.toMeters) {
                const unitScale = diagnostics.guard(modelContext, 'Model.getUnitScale', () => model.getUnitScale(), 1);
                if (typeof unitScale === 'number' && Number.isFinite(unitScale) && unitScale > 0) {
                    group.matrix.makeScale(unitScale, unitScale, unitScale);
                }
                else {
                    diagnostics.report('unexpected-scalar-value', modelContext, { what: 'Model.getUnitScale', value: unitScale, note: 'scale 1 used' });
                }
            }
            root.add(group);
            const instances = diagnostics.guard(modelContext, 'Model.getInstances', () => model.getInstances(), null);
            if (!instances) {
                diagnostics.report('exception', modelContext, { what: 'Model.getInstances returned nothing; is the SceneAPI feature flag enabled?' });
                continue;
            }
            let objectTree = null;
            try {
                objectTree = await model.getObjectTreeAsync();
            }
            catch (err) {
                // Models built in code have no object tree; only loaded models are expected to have one.
                const isLoaded = diagnostics.guard(modelContext, 'Model.getDocumentNode', () => !!model.getDocumentNode?.(), false);
                if (isLoaded) {
                    diagnostics.report('object-tree-unavailable', modelContext, { error: err, note: 'instances named by id only' });
                }
            }
            const count = diagnostics.guard(modelContext, 'InstanceCollection3D.getCount', () => instances.getCount(), 0);
            if (!Number.isInteger(count) || count < 0) {
                diagnostics.report('unexpected-scalar-value', modelContext, { what: 'InstanceCollection3D.getCount', value: count, raw: instances });
                continue;
            }
            for (let id = 0; id < count; id++) {
                if (performance.now() - sliceStart > TIME_SLICE_MS) {
                    onProgress?.({ model: m, models: models.length, instance: id, instances: count });
                    await yieldToEventLoop();
                    signal?.throwIfAborted();
                    sliceStart = performance.now();
                }
                stats.instances++;
                const object = extractInstance(id, instances, objectTree, modelName, matrixTarget, materials, geometries, diagnostics);
                if (object) {
                    group.add(object);
                    stats.exportedObjects++;
                    accumulateGeometryStats(object, stats);
                }
                else {
                    stats.skippedInstances++;
                }
            }
            onProgress?.({ model: m, models: models.length, instance: count, instances: count });
        }
        if (options.yUp) {
            root.matrix.makeRotationX(-Math.PI / 2);
        }
        if (options.recenter) {
            scene.updateMatrixWorld(true);
            const box = new THREE.Box3().setFromObject(root);
            if (!box.isEmpty()) {
                const center = box.getCenter(new THREE.Vector3());
                root.matrix.premultiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z));
            }
        }
        root.matrixWorldNeedsUpdate = true;
        scene.updateMatrixWorld(true);
    }
    catch (err) {
        dispose();
        throw err;
    }
    for (const byMode of geometries.values()) {
        for (const g of byMode.values()) {
            if (g)
                stats.uniqueGeometries++;
        }
    }
    stats.uniqueMaterials = materials.materials.size;
    stats.uniqueTextures = [...materials.textures.values()].filter(Boolean).length;
    return { scene, stats, dispose };
}
function extractInstance(id, instances, objectTree, modelName, matrixTarget, materials, geometries, diagnostics) {
    const context = { model: modelName, instanceId: id };
    const dbId = diagnostics.guard(context, 'InstanceCollection3D.getDbId', () => instances.getDbId(id), undefined);
    context.dbId = dbId;
    let name = `instance_${id}`;
    if (objectTree && typeof dbId === 'number') {
        const nodeName = diagnostics.guard(context, 'ObjectTree.getNodeName', () => objectTree.getNodeName(dbId), '');
        if (nodeName) {
            name = nodeName;
        }
    }
    context.name = name;
    const sceneGeometry = diagnostics.guard(context, 'InstanceCollection3D.getGeometry', () => instances.getGeometry(id), null);
    if (!sceneGeometry) {
        diagnostics.report('no-geometry', context, { value: sceneGeometry });
        return null;
    }
    const sceneMaterial = diagnostics.guard(context, 'InstanceCollection3D.getMaterial', () => instances.getMaterial(id), null);
    const { material, mode } = materials.convert(sceneMaterial, context);
    let byMode = geometries.get(sceneGeometry);
    if (!byMode) {
        byMode = new Map();
        geometries.set(sceneGeometry, byMode);
    }
    let geometry = byMode.get(mode);
    if (geometry === undefined) {
        geometry = diagnostics.guard(context, 'convertGeometry', () => convertGeometry(sceneGeometry, mode, diagnostics, context), null);
        byMode.set(mode, geometry);
    }
    if (!geometry) {
        return null;
    }
    const transform = diagnostics.guard(context, 'InstanceCollection3D.getTransformWorld', () => instances.getTransformWorld(id, matrixTarget), null);
    const elements = transform?.elements;
    if (!elements || elements.length !== 16 || !Array.prototype.every.call(elements, Number.isFinite)) {
        diagnostics.report('non-finite-matrix', context, {
            elements: elements ? Array.from(elements) : elements, note: 'instance skipped', raw: transform,
        });
        return null;
    }
    const object = mode === 'lines'
        ? new THREE.LineSegments(geometry, material)
        : mode === 'points'
            ? new THREE.Points(geometry, material)
            : new THREE.Mesh(geometry, material);
    object.name = typeof dbId === 'number' ? `${name} [${dbId}]` : name;
    object.userData = { dbId, instanceId: id };
    object.matrixAutoUpdate = false;
    object.matrix.fromArray(elements);
    return object;
}
function accumulateGeometryStats(object, stats) {
    const geometry = object.geometry;
    const vertexCount = geometry.getAttribute('position').count;
    stats.vertices += vertexCount;
    if (object.isMesh) {
        const count = geometry.index ? geometry.index.count : Math.min(vertexCount, geometry.drawRange.count);
        stats.triangles += Math.floor(count / 3);
    }
}
//# sourceMappingURL=extractScene.js.map