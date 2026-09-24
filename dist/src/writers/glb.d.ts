import type * as THREE from 'three';
export declare const GLB_MIME_TYPE = "model/gltf-binary";
/** Serializes a three.js scene into a binary glTF (.glb) file. */
export declare function writeGlb(scene: THREE.Scene): Promise<Blob>;
