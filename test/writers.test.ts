import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FakeBufferGeometry, FakeLineMaterial, FakeModel, FakeStandardMaterial, FakeUnlitMaterial, quadGeometry, translation } from './fakes.ts';
import { Diagnostics } from '../src/diagnostics.ts';
import { exportModels } from '../src/exportModels.ts';
import { prepareForUsdz } from '../src/writers/usdz.ts';

function sampleModel() {
    const quad = quadGeometry();
    const red = new FakeStandardMaterial({ color: { r: 1, g: 0, b: 0 } });
    return new FakeModel([
        { geometry: quad, material: red, matrix: translation(0, 0, 0), dbId: 1 },
        { geometry: quad, material: red, matrix: translation(2, 0, 0), dbId: 2 },
        { geometry: quadGeometry(), material: new FakeUnlitMaterial(), matrix: translation(4, 0, 0), dbId: 3 },
        { geometry: new FakeBufferGeometry({ positions: [0, 0, 0, 0, 0, 1], normals: null, indices: null }), material: new FakeLineMaterial(), dbId: 4 },
    ], { names: { 1: 'A', 2: 'B', 3: 'C', 4: 'D' } });
}

function parseGlb(buffer: ArrayBuffer) {
    const view = new DataView(buffer);
    assert.equal(view.getUint32(0, true), 0x46546c67, 'magic "glTF"');
    assert.equal(view.getUint32(4, true), 2, 'version 2');
    assert.equal(view.getUint32(8, true), buffer.byteLength, 'total length');
    const jsonLength = view.getUint32(12, true);
    assert.equal(view.getUint32(16, true), 0x4e4f534a, 'JSON chunk');
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength)));
    const binOffset = 20 + jsonLength;
    assert.equal(view.getUint32(binOffset + 4, true), 0x004e4942, 'BIN chunk');
    return json;
}

test('GLB export produces a valid container with instanced meshes', async () => {
    const diagnostics = new Diagnostics({ silent: true });
    const { blob, stats } = await exportModels({ models: [sampleModel() as any], format: 'glb', diagnostics });
    assert.equal(blob.type, 'model/gltf-binary');
    const json = parseGlb(await blob.arrayBuffer());

    assert.equal(stats.exportedObjects, 4);
    // root + model group + 4 instances
    assert.equal(json.nodes.length, 6);
    // The two instances of the shared quad reference the same glTF mesh.
    const nodeA = json.nodes.find((n: any) => n.name === 'A [1]');
    const nodeB = json.nodes.find((n: any) => n.name === 'B [2]');
    assert.equal(nodeA.mesh, nodeB.mesh);
    assert.deepEqual(nodeB.matrix?.slice(12, 15) ?? nodeB.translation, [2, 0, 0]);
    assert.ok(json.extensionsUsed?.includes('KHR_materials_unlit'));
    const lineMesh = json.meshes[json.nodes.find((n: any) => n.name === 'D [4]').mesh];
    assert.equal(lineMesh.primitives[0].mode, 1, 'LINES');
    const positionAccessor = json.accessors[json.meshes[nodeA.mesh].primitives[0].attributes.POSITION];
    assert.equal(positionAccessor.count, 4);
    assert.deepEqual(json.asset.version, '2.0');
});

test('USDZ preparation removes lines and converts unlit materials', () => {
    const scene = new THREE.Scene();
    const basic = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), basic);
    const line = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial());
    scene.add(mesh, line);
    const diagnostics = new Diagnostics({ silent: true });
    prepareForUsdz(scene, diagnostics);

    assert.equal(line.parent, null);
    const converted = mesh.material as THREE.MeshStandardMaterial;
    assert.ok(converted.isMeshStandardMaterial);
    assert.equal(converted.emissive.getHex(), basic.color.getHex());
    assert.equal(diagnostics.byCategory('unsupported-in-format').length, 1);
});

test('USDZ export produces a zip archive', async () => {
    const diagnostics = new Diagnostics({ silent: true });
    const { blob } = await exportModels({ models: [sampleModel() as any], format: 'usdz', diagnostics });
    assert.equal(blob.type, 'model/vnd.usdz+zip');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04], 'zip local file header');
    const text = new TextDecoder().decode(bytes);
    assert.ok(text.includes('upAxis = "Y"'));
    assert.ok(text.includes('A_1') || text.includes('A__1_') || /def Xform "A/.test(text), 'instance names are kept');
});
