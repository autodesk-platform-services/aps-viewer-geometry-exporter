import * as THREE from 'three';
import { USDZExporter } from 'three/addons/exporters/USDZExporter.js';
import type { Diagnostics } from '../diagnostics.ts';

export const USDZ_MIME_TYPE = 'model/vnd.usdz+zip';

/**
 * Serializes a three.js scene into a USDZ file.
 *
 * USDZExporter only supports meshes with (physically based) standard materials, so the
 * scene is adjusted in place first:
 * - unlit materials are replaced by standard materials that emit their color,
 * - line and point objects are removed (and reported).
 */
export async function writeUsdz(scene: THREE.Scene, diagnostics: Diagnostics): Promise<Blob> {
    prepareForUsdz(scene, diagnostics);
    const exporter = new USDZExporter();
    const result = await exporter.parseAsync(scene, { onlyVisible: false, quickLookCompatible: true });
    return new Blob([result], { type: USDZ_MIME_TYPE });
}

export function prepareForUsdz(scene: THREE.Scene, diagnostics: Diagnostics): void {
    const unsupported: THREE.Object3D[] = [];
    const replacements = new Map<THREE.Material, THREE.MeshStandardMaterial>();

    scene.traverse(object => {
        if ((object as THREE.LineSegments).isLine || (object as THREE.Points).isPoints) {
            unsupported.push(object);
            return;
        }
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) {
            return;
        }
        const material = mesh.material as THREE.Material;
        if ((material as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
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
        const lines = unsupported.filter(o => (o as THREE.LineSegments).isLine).length;
        diagnostics.report('unsupported-in-format', {}, {
            format: 'usdz', removedLineObjects: lines, removedPointObjects: unsupported.length - lines,
            note: 'USDZExporter only supports meshes',
        });
    }
}

function toEmissiveStandard(material: THREE.Material): THREE.MeshStandardMaterial {
    const basic = material as THREE.MeshBasicMaterial;
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
