import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
export const GLB_MIME_TYPE = 'model/gltf-binary';
/** Serializes a three.js scene into a binary glTF (.glb) file. */
export async function writeGlb(scene) {
    const exporter = new GLTFExporter();
    const result = await exporter.parseAsync(scene, { binary: true, onlyVisible: false });
    if (!(result instanceof ArrayBuffer)) {
        throw new Error('GLTFExporter did not return binary output');
    }
    return new Blob([result], { type: GLB_MIME_TYPE });
}
//# sourceMappingURL=glb.js.map