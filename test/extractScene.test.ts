import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
    FakeBufferAttribute, FakeBufferGeometry, FakeLineMaterial, FakeModel, FakePointsMaterial,
    FakeStandardMaterial, FakeUnlitMaterial, quadGeometry, Side, translation,
} from './fakes.ts';
import { Diagnostics } from '../src/diagnostics.ts';
import { extractScene, type ExtractOptions } from '../src/extract/extractScene.ts';
import { decodeAttribute } from '../src/extract/convertGeometry.ts';

const RAW_OPTIONS: ExtractOptions = { yUp: false, toMeters: false, recenter: false, includeTextures: false };

async function extract(models: FakeModel[], options: Partial<ExtractOptions> = {}) {
    const diagnostics = new Diagnostics({ silent: true });
    const result = await extractScene({ models: models as any, options: { ...RAW_OPTIONS, ...options }, diagnostics });
    const objects: THREE.Object3D[] = [];
    result.scene.traverse(o => { if ((o as THREE.Mesh).geometry) objects.push(o); });
    return { ...result, diagnostics, objects };
}

test('shared geometry and materials stay shared; transforms and names are kept', async () => {
    const geometry = quadGeometry();
    const material = new FakeStandardMaterial({ color: { r: 1, g: 0, b: 0 }, specularPower: 30, metal: true });
    const model = new FakeModel([
        { geometry, material, matrix: translation(1, 2, 3), dbId: 10 },
        { geometry, material, matrix: translation(5, 0, 0), dbId: 11 },
    ], { names: { 10: 'Door', 11: 'Window' } });

    const { objects, stats, diagnostics } = await extract([model]);

    assert.equal(diagnostics.total, 0, JSON.stringify(diagnostics.entries.map(e => e.category)));
    assert.equal(objects.length, 2);
    const [a, b] = objects as THREE.Mesh[];
    assert.ok(a.isMesh);
    assert.equal(a.geometry, b.geometry);
    assert.equal(a.material, b.material);
    assert.equal(a.name, 'Door [10]');
    assert.equal(b.name, 'Window [11]');
    assert.deepEqual(a.userData, { dbId: 10, instanceId: 0 });
    assert.deepEqual(new THREE.Vector3().setFromMatrixPosition(a.matrixWorld).toArray(), [1, 2, 3]);

    const mat = a.material as THREE.MeshStandardMaterial;
    assert.ok(mat.isMeshStandardMaterial);
    assert.equal(mat.metalness, 1);
    assert.ok(Math.abs(mat.roughness - Math.sqrt(2 / 32)) < 1e-6);
    assert.equal(mat.color.getHexString(THREE.SRGBColorSpace), 'ff0000');

    assert.equal(stats.uniqueGeometries, 1);
    assert.equal(stats.uniqueMaterials, 1);
    assert.equal(stats.triangles, 4);
    assert.equal(stats.exportedObjects, 2);
});

test('material classes map to three.js materials and object types', async () => {
    const model = new FakeModel([
        { geometry: quadGeometry(), material: new FakeUnlitMaterial({ opacity: 0.5, side: Side.Double }) },
        { geometry: new FakeBufferGeometry({ positions: [0, 0, 0, 1, 0, 0], normals: null, indices: null }), material: new FakeLineMaterial() },
        { geometry: new FakeBufferGeometry({ positions: [0, 0, 0], normals: null, indices: null }), material: new FakePointsMaterial({ size: 4 }) },
    ]);
    const { objects, diagnostics } = await extract([model]);
    assert.equal(diagnostics.total, 0, JSON.stringify(diagnostics.entries.map(e => e.category)));

    const [unlit, line, points] = objects as any[];
    assert.ok(unlit.isMesh && unlit.material.isMeshBasicMaterial);
    assert.equal(unlit.material.transparent, true, 'opacity < 1 implies transparency');
    assert.equal(unlit.material.side, THREE.DoubleSide);
    assert.ok(line.isLineSegments && line.material.isLineBasicMaterial);
    assert.ok(points.isPoints && points.material.size === 4);
});

test('export options: unit scale, Y-up and recentering', async () => {
    const model = new FakeModel([{ geometry: quadGeometry(), material: new FakeStandardMaterial(), matrix: translation(10, 20, 30) }], { unitScale: 0.5 });
    const { scene } = await extract([model], { toMeters: true, yUp: true, recenter: true });
    const box = new THREE.Box3().setFromObject(scene);
    const center = box.getCenter(new THREE.Vector3());
    assert.ok(center.length() < 1e-6, `center ${center.toArray()}`);
    const size = box.getSize(new THREE.Vector3());
    // The quad (1x1 in XY) is scaled by 0.5 and rotated so that its normal (Z) becomes Y.
    assert.deepEqual(size.toArray().map(v => +v.toFixed(6)), [0.5, 0, 0.5]);
});

test('unexpected data is reported and repaired or skipped', async () => {
    const good = quadGeometry();
    const model = new FakeModel([
        // index out of range: second triangle references vertex 7
        { geometry: quadGeometry({ indices: [0, 1, 2, 0, 2, 7] }), material: new FakeStandardMaterial() },
        // non-unit normals and a NaN position
        { geometry: quadGeometry({ normals: [0, 0, 2, 0, 0, 1, 0, 0, 1, 0, 0, 1], positions: [0, 0, 0, 1, NaN, 0, 1, 1, 0, 0, 1, 0] }), material: new FakeStandardMaterial() },
        // no geometry
        { geometry: null, material: new FakeStandardMaterial() },
        // unknown material type
        { geometry: good, material: { foo: 1 } },
        // out-of-range color and weird side value
        { geometry: good, material: new FakeStandardMaterial({ color: { r: 2, g: 0, b: 0 }, side: 'sideways' }) },
        // non-finite matrix
        { geometry: good, material: new FakeStandardMaterial(), matrix: [NaN, ...translation(0, 0, 0).slice(1)] },
        // uv with an unexpected item size
        { geometry: quadGeometry({ uv: new FakeBufferAttribute(new Float32Array(12), 3) }), material: new FakeStandardMaterial() },
        // missing normals on a lit mesh
        { geometry: quadGeometry({ normals: null }), material: new FakeStandardMaterial() },
    ]);
    const { objects, diagnostics, stats } = await extract([model]);
    const categories = new Set(diagnostics.entries.map(e => e.category));
    for (const expected of [
        'index-out-of-range', 'unexpected-scalar-value', 'non-finite-position', 'no-geometry', 'unknown-material-type',
        'unexpected-color-value', 'unexpected-side-value', 'non-finite-matrix', 'uv-undecodable', 'missing-normals',
    ] as const) {
        assert.ok(categories.has(expected), `expected a '${expected}' report; got ${[...categories].join(', ')}`);
    }
    assert.equal(stats.skippedInstances, 2, 'no-geometry and non-finite-matrix instances are skipped');
    assert.equal(objects.length, 6);

    const first = (objects[0] as THREE.Mesh).geometry;
    assert.deepEqual(Array.from(first.index!.array), [0, 1, 2], 'bad triangle dropped');
    const second = (objects[1] as THREE.Mesh).geometry;
    assert.equal(second.getAttribute('normal').getZ(0), 1, 'normal normalized');
    assert.equal(second.getAttribute('position').getY(1), 0, 'NaN replaced');
    const withoutNormals = (objects[5] as THREE.Mesh).geometry;
    assert.ok(withoutNormals.getAttribute('normal'), 'normals recomputed');

    // Each report carries its context.
    const noGeometry = diagnostics.byCategory('no-geometry')[0];
    assert.deepEqual({ instanceId: noGeometry.context.instanceId, dbId: noGeometry.context.dbId }, { instanceId: 2, dbId: 3 });
});

test('getter exceptions are reported instead of aborting the export', async () => {
    const geometry = quadGeometry();
    (geometry as any).getIndices = () => { throw new Error('boom'); };
    const model = new FakeModel([{ geometry, material: new FakeStandardMaterial() }]);
    const { objects, diagnostics } = await extract([model]);
    assert.equal(objects.length, 1);
    assert.equal(diagnostics.byCategory('exception').length, 1);
});

test('decodeAttribute handles plain, interleaved and packed layouts', () => {
    // plain, normalized Uint8
    const plain = decodeAttribute(Object.assign(new FakeBufferAttribute(new Uint8Array([0, 255, 51, 102]), 2), { normalized: true }) as any, [2], 2);
    assert.ok(!('error' in plain));
    assert.deepEqual(Array.from(plain.data).map(v => +v.toFixed(2)), [0, 1, 0.2, 0.4]);

    // interleaved floats: [px py pz u v] per vertex, uv at offset 3
    const buffer = new Float32Array([0, 0, 0, 0.25, 0.75, 1, 1, 1, 0.5, 0.5]);
    const interleaved = decodeAttribute(new FakeBufferAttribute(buffer, 2, { stride: 5, offset: 3 }) as any, [2], 2);
    assert.ok(!('error' in interleaved));
    assert.deepEqual(Array.from(interleaved.data), [0.25, 0.75, 0.5, 0.5]);

    // packed 2-byte components in a float slot (stride 4 floats, uv in float slot 3)
    const packed = new Float32Array(8);
    const view = new DataView(packed.buffer);
    view.setUint16(3 * 4, 65535, true); view.setUint16(3 * 4 + 2, 0, true);
    view.setUint16(7 * 4, 32768, true); view.setUint16(7 * 4 + 2, 65535, true);
    const decoded = decodeAttribute(new FakeBufferAttribute(packed, 2, { stride: 4, offset: 3, bytesPerItem: 2 }) as any, [2], 2);
    assert.ok(!('error' in decoded));
    assert.ok(decoded.warning, 'packed layouts are flagged for verification');
    assert.deepEqual(Array.from(decoded.data).map(v => +v.toFixed(3)), [1, 0, 0.5, 1]);

    // too short
    const short = decodeAttribute(new FakeBufferAttribute(new Float32Array(3), 2) as any, [2], 2);
    assert.ok('error' in short);
});

test('packed normals are decoded when the normal reader is missing (observed on committed geometry)', async () => {
    // Values observed in viewer 7.126 for a unit sphere: vertex normal (0, 1, 0) is stored
    // as [49151, 32767] and (0.9239, 0, -0.3827) as [32767, 20227] (uint16, normalized).
    const packed = new Float32Array(2 * 4); // stride 4 floats: xyz + packed normal
    const view = new DataView(packed.buffer);
    view.setUint16(3 * 4, 49151, true); view.setUint16(3 * 4 + 2, 32767, true);
    view.setUint16(7 * 4, 32767, true); view.setUint16(7 * 4 + 2, 20227, true);
    const geometry = new FakeBufferGeometry({ positions: [0, 1, 0, 0.9239, 0, -0.3827], normals: null, indices: null });
    (geometry.init as any).normal = new FakeBufferAttribute(packed, 2, { stride: 4, offset: 3, bytesPerItem: 2, normalized: true });
    (geometry as any).getNormal = () => null;
    const model = new FakeModel([{ geometry, material: new FakePointsMaterial() }]);

    const { objects, diagnostics } = await extract([model]);
    const normal = (objects[0] as THREE.Points).geometry.getAttribute('normal');
    assert.ok(normal, 'normals decoded');
    const n0 = [normal.getX(0), normal.getY(0), normal.getZ(0)].map(v => +v.toFixed(3) || 0);
    const n1 = [normal.getX(1), normal.getY(1), normal.getZ(1)].map(v => +v.toFixed(3) || 0);
    assert.deepEqual(n0, [0, 1, 0]);
    assert.deepEqual(n1, [0.924, 0, -0.383]);
    const report = diagnostics.byCategory('no-normal-reader');
    assert.equal(report.length, 1);
    assert.equal(report[0].details.decodedManually, true);
});

test('internal viewer materials of loaded models are converted (observed in viewer 7.126)', async () => {
    // Loaded Revit models return legacy three.js materials without the Scene API getters.
    const phong = { type: 'MeshPhongMaterial', name: '', color: { r: 0.380392, g: 0.294118, b: 0.243137 }, opacity: 1, transparent: false,
        shininess: 25, metal: false, map: null, side: 0, vertexColors: 0, depthTest: true, depthWrite: true };
    const line = { type: 'LineBasicMaterial', color: { r: 0, g: 0, b: 1 }, opacity: 1, transparent: false, vertexColors: 0, depthTest: true, depthWrite: true };
    const model = new FakeModel([
        { geometry: quadGeometry(), material: phong },
        { geometry: new FakeBufferGeometry({ positions: [0, 0, 0, 1, 0, 0], normals: null, indices: [0, 1] }), material: line },
    ]);
    const { objects, diagnostics } = await extract([model]);
    const [mesh, segments] = objects as any[];
    assert.ok(mesh.material.isMeshStandardMaterial);
    assert.equal(mesh.material.color.getHexString(THREE.SRGBColorSpace), new THREE.Color().setRGB(0.380392, 0.294118, 0.243137, THREE.SRGBColorSpace).getHexString(THREE.SRGBColorSpace));
    assert.ok(Math.abs(mesh.material.roughness - Math.sqrt(2 / 27)) < 1e-6);
    assert.equal(mesh.material.side, THREE.FrontSide);
    assert.ok(segments.isLineSegments, 'line material yields line segments');
    assert.equal(diagnostics.byCategory('legacy-material').length, 2);
    assert.equal(diagnostics.byCategory('unknown-material-type').length, 0);
    assert.equal(diagnostics.byCategory('index-count-not-multiple').length, 0);
});

test('internal PRISM materials (Fusion models) are approximated with PBR materials', async () => {
    // Shapes observed in viewer 7.126 (see MaterialConverterPrism): colors are linear.
    const base = { type: 'PrismMaterial', name: '', side: 0, opacity: 1, transparent: false, depthTest: true, depthWrite: true, surface_roughness: 0.25, mapList: {} };
    const opaque = { ...base, prismType: 'PrismOpaque', opaque_albedo: { r: 0.81, g: 0.42, b: 0.017 }, opaque_luminance: 0 };
    const metal = { ...base, prismType: 'PrismMetal', metal_f0: { r: 0.35, g: 0.35, b: 0.35 } };
    const glass = { ...base, prismType: 'PrismTransparent', transparent_color: { r: 0.9, g: 0.9, b: 0.9 }, transparent: true };
    const textured = { ...base, prismType: 'PrismOpaque', opaque_albedo: { r: 1, g: 1, b: 1 }, opaque_luminance: 0, mapList: { surface_albedo_map: { uri: 'x' }, surface_normal_map: null } };
    const model = new FakeModel([opaque, metal, glass, textured].map(material => ({ geometry: quadGeometry(), material })));
    const { objects, diagnostics } = await extract([model]);
    const [o, m, g] = objects.map(x => (x as THREE.Mesh).material as THREE.MeshStandardMaterial);

    assert.deepEqual([o.color.r, o.color.g, o.color.b].map(v => +v.toFixed(3)), [0.81, 0.42, 0.017], 'linear color kept as-is');
    assert.equal(o.metalness, 0);
    assert.equal(o.roughness, 0.25);
    assert.equal(m.metalness, 1);
    assert.ok(g.transparent && g.opacity < 1);
    assert.equal(diagnostics.byCategory('legacy-material').length, 4);
    const features = diagnostics.byCategory('unsupported-material-feature').map(e => (e.details.features as string[]).join('; '));
    assert.ok(features.some(f => f.includes('surface_albedo_map') && !f.includes('surface_normal_map')), features.join(' | '));
    assert.equal(diagnostics.byCategory('unknown-material-type').length, 0);
});
