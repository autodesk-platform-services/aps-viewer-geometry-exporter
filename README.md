# APS Viewer Geometry Exporter

An [APS Viewer](https://aps.autodesk.com/en/docs/viewer/v7/developers_guide/overview/) extension that uses the new
[Scene API](https://aps.autodesk.com/en/docs/viewer/v7/developers_guide/scene_api/) to read the geometry, materials
and transforms of the loaded model(s), and download them as **GLB** (binary glTF 2.0) or **USDZ** files.

Scene API data (instances → geometry + material + world transform) is converted directly into a `THREE.Scene`
built with a modern, privately loaded three.js. That scene is then serialized with three.js' `GLTFExporter` or
`USDZExporter`. The viewer's own global `THREE` is left untouched.

## Requirements

- APS Viewer v7 with Scene API support. The Scene API is **opt-in**, so enable it *before* initializing the viewer:
  ```js
  Autodesk.Viewing.FeatureFlags.set(Autodesk.Viewing.PublicFeatureFlags.SceneAPI, true);
  Autodesk.Viewing.Initializer(options, () => { /* ... */ });
  ```
- The only runtime dependency is [three.js](https://threejs.org) (currently `0.186.0`). No bundler is needed.

## Build, test, demo

```bash
npm install
npm run build   # TypeScript → dist/
npm test        # node:test with Node's built-in TypeScript support (Node 22.18+ / 24)
npm run demo    # builds, then serves the repo at http://localhost:8080
```

Open `http://localhost:8080/demo/index.html?token=<access token>&urn=<urn>[,<urn>...]`, or open it without
parameters and fill in the form. The token needs `viewables:read`; the URNs must point to translated models.
Several comma-separated URNs load as a multi-model scene.

## Using the extension in your app

`dist/src/index.js` is plain ESM that imports `three` and `three/addons/...`. Resolve those with an import map
(or your bundler), and load the module after `viewer3D.js`:

```html
<script src="https://developer.api.autodesk.com/modelderivative/v2/viewers/7.*/viewer3D.min.js"></script>
<script type="importmap">
{
    "imports": {
        "three": "https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.module.js",
        "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.186.0/examples/jsm/"
    }
}
</script>
<script type="module">
    import { EXTENSION_ID } from './dist/src/index.js'; // registers the extension
    // ... after Autodesk.Viewing.Initializer and creating the viewer:
    const exporter = await viewer.loadExtension(EXTENSION_ID); // 'GeometryExporterExtension'
</script>
```

The extension adds a toolbar button that opens an **Export Geometry** panel with a format choice, the options
below, and a progress bar with a Cancel button. The same functionality is available programmatically:

```js
// Download a file (all loaded models by default)
await exporter.download({ format: 'glb' });
await exporter.download({ format: 'usdz', options: { recenter: true }, filename: 'building.usdz' });

// Get the Blob plus statistics and diagnostics instead
const { blob, stats, diagnostics } = await exporter.export({ format: 'glb', models: [viewer.model] });

// Log the raw Scene API data shapes of a few instances per model (for troubleshooting)
await exporter.inspect(10);
```

| Option            | Default | Meaning                                                                                   |
| ----------------- | ------- | ----------------------------------------------------------------------------------------- |
| `yUp`             | `true`  | Rotate the (Z-up) viewer world so that Y is up, as glTF and USDZ expect.                   |
| `toMeters`        | `true`  | Scale each model from its native units to meters (`model.getUnitScale()`).                |
| `recenter`        | `false` | Move the result so that its bounding box is centered at the origin.                       |
| `includeTextures` | `true`  | Export diffuse texture maps (`map`).                                                      |

## Output structure

```
Scene
└─ root              (Y-up rotation, recentering)
   └─ <model name>   (unit scale; one group per model)
      └─ "<object name> [<dbId>]"   (one mesh / line / points object per Scene API instance,
                                     world transform from getTransformWorld, userData { dbId, instanceId })
```

Geometries, materials and textures shared between instances stay shared, so a GLB uses one glTF mesh
for many nodes.

| Scene API material | three.js / exported as                                                                                         |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `StandardMaterial` | `MeshStandardMaterial`: color, opacity, side, vertex colors, map; roughness ≈ √(2 / (specularPower + 2)); `metal` → metalness 1 |
| `UnlitMaterial`    | `MeshBasicMaterial`, which becomes `KHR_materials_unlit` in GLB and an emissive standard material in USDZ           |
| `LineMaterial`     | `LineSegments` + `LineBasicMaterial` (GLB only; removed from USDZ)                                              |
| `PointsMaterial`   | `Points` + `PointsMaterial` (GLB only; removed from USDZ)                                                       |

## Diagnostics: reporting unexpected Scene API data

The export never aborts on bad data. When the Scene API returns something unexpected, the exporter reports it
to the browser console and then repairs the data, drops it, or skips the instance:

```
[GeometryExporter] index-out-of-range {model, instanceId, dbId, name} {droppedPrimitives, firstBadIndex, …, raw}
```

- The first 5 occurrences of each category are logged in full. `raw` holds the original Scene API object, so it can
  be expanded in DevTools. Further occurrences are only counted.
- Each export ends with one collapsed `[GeometryExporter] … export finished` group. It contains a statistics table
  (instances, exported objects, unique geometries/materials/textures, triangles, vertices), a table of occurrences
  per category, and the list of all entries.
- Categories: `no-geometry`, `no-material`, `no-position-reader`, `vertex-count-zero`, `non-finite-position`,
  `non-finite-normal`, `non-finite-matrix`, `missing-normals`, `no-normal-reader`, `index-out-of-range`, `index-count-not-multiple`,
  `vertex-count-not-multiple`, `unknown-material-type`, `legacy-material`, `unsupported-material-feature`, `unexpected-color-value`, `unexpected-scalar-value`
  (including non-unit normals), `uv-undecodable`, `color-undecodable`, `unexpected-attribute-layout`,
  `unknown-texture-image-type`, `texture-draw-failed`, `unexpected-side-value`, `unexpected-wrap-value`,
  `object-tree-unavailable`, `unsupported-in-format`, `exception` (a Scene API getter threw).

## Scene API behavior: verified vs. assumed

Checked against viewer **7.126.0** using dynamic models built with `GeometryFactory` (headless Chrome):

- ✅ `Scene.Side` is `{ Front: 0, Back: 1, Double: 2 }`, `Scene.Wrapping` uses the three.js constant values
  (1000–1002), and `Texture.getImage()` returns the source `HTMLCanvasElement`.
- ✅ Committed geometry is interleaved (stride 6 floats): position (3 floats), normal (2 × uint16 normalized),
  and uv (2 floats). UVs decode correctly from `getAttribute('uv')`.
- ⚠️ **After commit, `getNormalReader()` returns `null` and `getNormal()` returns `null`**, although
  `hasAttribute('normal')` is true. The exporter then decodes the packed normal attribute itself (spherical
  encoding: θ = (2u − 1)·π, z = 2v − 1; max error on a sphere is about 1e-4) and reports `no-normal-reader`
  for each affected geometry. If decoding isn't possible, normals are recomputed from the triangles.

Checked against a translated Revit model (`rac_basic_sample_project`, 733 instances):

- ⚠️ **`getMaterial()` returns the viewer's internal materials, not Scene API classes**: plain (legacy three.js)
  `MeshPhongMaterial` and `LineBasicMaterial` objects without `getColor()`/`getOpacity()`/… getters. The exporter
  recognizes these by their `type` (`MeshPhongMaterial`, `MeshLambertMaterial`, `MeshBasicMaterial`,
  `LineBasicMaterial`, `LineDashedMaterial`, `PointCloudMaterial`), reads their properties directly
  (`color`, `opacity`, `shininess`, `metal`, `map`, `side`, …), and reports `legacy-material` for each one.
- ⚠️ The same missing normal reader as above (`no-normal-reader`) applies to every triangle geometry.
- ✅ Instance ids `0 … getCount() - 1` cover all instances. Line geometry is identified correctly through its
  (`LineBasicMaterial`) material.

Checked against a translated Fusion model (`wall-e.f3d`, 182 instances):

- ⚠️ `getMaterial()` returns internal **PRISM** materials (`type: 'PrismMaterial'`), whose appearance lives in
  `prismType`-specific properties with **linear** colors (see the viewer's `MaterialConverterPrism`). They are
  approximated with `MeshStandardMaterial`:

  | `prismType`        | Base color                    | Other                                                        |
  | ------------------ | ----------------------------- | ------------------------------------------------------------ |
  | `PrismOpaque`      | `opaque_albedo`               | roughness `surface_roughness`                                |
  | `PrismMetal`       | `metal_f0`                    | metalness 1, roughness `surface_roughness`                   |
  | `PrismLayered`     | `layered_diffuse`             | roughness `layered_roughness`; the clear coat is dropped     |
  | `PrismTransparent` | `transparent_color`           | opacity derived from the transmission color                 |
  | `PrismGlazing`     | `glazing_transmission_color`  | opacity derived from the transmission color, `glazing_transmission_roughness` |
  | `PrismWood`        | `wood_early_color`            | the procedural wood pattern is dropped                       |

  Anything that isn't carried over (PRISM texture maps, emission, clear coat, refraction, procedural wood) is
  reported as `unsupported-material-feature`, listing the affected features and map names.

Still assumed (reported when violated):

- Other file formats (Inventor, Navisworks, IFC, …) use the same internal material types. Materials of any other
  type are exported with a grey fallback and reported as `unknown-material-type`, including their `type` and
  `is*` flags.
- Packed 1- or 2-byte interleaved uv/color components are decoded as unsigned normalized integers and flagged
  with `unexpected-attribute-layout`.
- Colors (`Scene.Color`, 0..1) are treated as sRGB.
- `getTransformWorld()` is taken as-is. The viewer's global offset is not added back; use `recenter` if needed.

`exporter.inspect()` shows what the API actually returns for any model.

## Not supported yet (possible future features)

- Exporting subsets: current selection, visible or isolated objects, or explicit dbIds (with hidden and ghosted
  instances skipped).
- OBJ (+MTL, textures) output.
- Theming colors and model edges (`getEdgeIndices()`).
- Choosing individual models in a multi-model scene from the panel (possible today through the API's `models`
  option).
- Normal, bump, specular and alpha maps. Only the diffuse `map` is exported, and PRISM texture maps aren't exported yet.

## Project layout

```
src/
  index.ts                     entry point; registers the extension, re-exports the API
  GeometryExporterExtension.ts viewer extension (toolbar button, panel, export/download/inspect)
  exportModels.ts              extract + write orchestration (no viewer UI dependencies)
  diagnostics.ts               unexpected-data collector and console reporting
  inspect.ts                   raw Scene API data dump for troubleshooting
  extract/extractScene.ts      Scene API instances → THREE.Scene
  extract/convertGeometry.ts   Scene BufferGeometry → THREE.BufferGeometry (decoding + validation)
  extract/convertMaterial.ts   Scene materials/textures → three.js materials/textures
  writers/glb.ts, usdz.ts      three.js exporters
  ui/ExportPanel.ts            DockingPanel UI
  types/scene-api.d.ts         hand-written declarations for the used viewer / Scene API surface
demo/                          static demo page
test/                          node:test suites with Scene API fakes
```
