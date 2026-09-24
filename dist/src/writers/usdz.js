import * as THREE from 'three';
import { USDZExporter } from 'three/addons/exporters/USDZExporter.js';
export const USDZ_MIME_TYPE = 'model/vnd.usdz+zip';
/**
 * Serializes a three.js scene into a USDZ file.
 *
 * USDZExporter only supports meshes with (physically based) standard materials, so the
 * scene is adjusted in place first:
 * - unlit materials are replaced by standard materials that emit their color,
 * - line and point objects are removed (and reported).
 */
export async function writeUsdz(scene, diagnostics) {
    prepareForUsdz(scene, diagnostics);
    const exporter = new USDZExporter();
    const result = await exporter.parseAsync(scene, { onlyVisible: false, quickLookCompatible: true });
    return new Blob([result], { type: USDZ_MIME_TYPE });
}
export function prepareForUsdz(scene, diagnostics) {
    const unsupported = [];
    const replacements = new Map();
    scene.traverse(object => {
        if (object.isLine || object.isPoints) {
            unsupported.push(object);
            return;
        }
        const mesh = object;
        if (!mesh.isMesh) {
            return;
        }
        const material = mesh.material;
        if (material.isMeshStandardMaterial) {
            return;
        }
        let replacement = replacements.get(material);
        if (!replacement) {
            replacement = toEmissiveStandard(material);
            replacements.set(material, replacement);
        }
        mesh.material = replacement;
    });
    for (const object of unsupported) {
        object.removeFromParent();
    }
    if (unsupported.length > 0) {
        const lines = unsupported.filter(o => o.isLine).length;
        diagnostics.report('unsupported-in-format', {}, {
            format: 'usdz', removedLineObjects: lines, removedPointObjects: unsupported.length - lines,
            note: 'USDZExporter only supports meshes',
        });
    }
}
function toEmissiveStandard(material) {
    const basic = material;
    const color = basic.color ?? new THREE.Color(1, 1, 1);
    const result = new THREE.MeshStandardMaterial({
        name: material.name,
        color: new THREE.Color(0, 0, 0),
        emissive: color,
        emissiveMap: basic.map ?? null,
        roughness: 1,
        metalness: 0,
        opacity: material.opacity,
        transparent: material.transparent,
        side: material.side,
        vertexColors: material.vertexColors,
    });
    // Keep the base color map too, so that viewers ignoring emission still show the texture.
    result.map = basic.map ?? null;
    return result;
}
//# sourceMappingURL=usdz.js.map