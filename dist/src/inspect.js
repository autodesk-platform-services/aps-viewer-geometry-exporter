import { describeAttribute } from './extract/convertGeometry.js';
import { classifyMaterial } from './extract/convertMaterial.js';
import { describeModel } from './extract/extractScene.js';
/**
 * Logs the raw shape of the data the Scene API returns for the first few instances of
 * each model: attribute layouts, material classes, texture image types, transforms.
 * Meant for troubleshooting and for sharing with the Scene API team.
 */
export async function inspectModels(models, sampleCount = 10) {
    const reports = [];
    for (let m = 0; m < models.length; m++) {
        const model = models[m];
        const report = { model: describeModel(model, m), instanceCount: undefined, samples: [] };
        const safe = (fn) => { try {
            return fn();
        }
        catch (e) {
            return `threw: ${e}`;
        } };
        const instances = model.getInstances();
        report.instanceCount = safe(() => instances.getCount());
        try {
            const tree = await model.getObjectTreeAsync();
            const ids = [];
            tree.enumNodeInstances(tree.getRootId(), id => ids.push(id), true);
            report.objectTreeInstanceCount = ids.length;
            if (ids.length > 0) {
                report.objectTreeInstanceIdRange = [Math.min(...ids), Math.max(...ids)];
            }
        }
        catch (e) {
            report.objectTreeInstanceCount = undefined;
        }
        const count = typeof report.instanceCount === 'number' ? report.instanceCount : 0;
        const step = Math.max(1, Math.floor(count / sampleCount));
        for (let id = 0; id < count && report.samples.length < sampleCount; id += step) {
            const geom = safe(() => instances.getGeometry(id));
            const mat = safe(() => instances.getMaterial(id));
            const map = mat && typeof mat.getMap === 'function' ? safe(() => mat.getMap()) : undefined;
            const image = map && typeof map.getImage === 'function' ? safe(() => map.getImage()) : undefined;
            const g = geom;
            report.samples.push({
                instanceId: id,
                dbId: safe(() => instances.getDbId(id)),
                geometry: geom && typeof geom === 'object' ? {
                    vertexCount: safe(() => geom.getVertexCount()),
                    interleaved: safe(() => geom.isInterleaved()),
                    committed: safe(() => geom.isCommitted()),
                    byteSize: safe(() => g.getByteSize?.()),
                    indices: safe(() => { const i = geom.getIndices(); return i && { type: i.constructor.name, length: i.length }; }),
                    edgeIndices: safe(() => { const i = geom.getEdgeIndices(); return i && { type: i.constructor.name, length: i.length }; }),
                    hasPositionReader: safe(() => typeof geom.getPositionReader() === 'function'),
                    hasNormalReader: safe(() => typeof geom.getNormalReader() === 'function'),
                    attributes: Object.fromEntries(['position', 'normal', 'uv', 'color'].map(name => [name,
                        safe(() => geom.hasAttribute(name) ? describeAttribute(geom.getAttribute(name)) : false)])),
                } : geom,
                material: mat && typeof mat === 'object' ? {
                    class: classifyMaterial(mat),
                    constructorName: mat.constructor?.name,
                    color: safe(() => mat.getColor?.()),
                    opacity: safe(() => mat.getOpacity?.()),
                    side: safe(() => mat.getSide?.()),
                    map: map ? {
                        name: safe(() => map.getName()),
                        imageType: image?.constructor?.name ?? typeof image,
                        imageSize: image ? `${image.naturalWidth ?? image.width}x${image.naturalHeight ?? image.height}` : undefined,
                        wrapS: safe(() => map.getWrapS()),
                        wrapT: safe(() => map.getWrapT()),
                        repeat: safe(() => map.getRepeat()),
                        offset: safe(() => map.getOffset()),
                    } : map,
                } : mat,
                transform: safe(() => {
                    const Matrix4 = globalThis.Autodesk.Viewing.Math.Matrix4;
                    return Array.from(instances.getTransformWorld(id, new Matrix4()).elements);
                }),
                raw: { geometry: geom, material: mat },
            });
        }
        reports.push(report);
        console.log('[GeometryExporter] inspect', report);
    }
    return reports;
}
//# sourceMappingURL=inspect.js.map