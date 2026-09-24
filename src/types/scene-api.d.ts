// Minimal ambient declarations for the parts of the APS Viewer (v7) and its Scene API
// that this extension uses. Based on the public reference documentation:
// https://aps.autodesk.com/en/docs/viewer/v7/developers_guide/scene_api/
//
// Everything that the docs don't describe precisely is typed loosely on purpose,
// because the exporter validates the actual runtime values and reports surprises.

declare namespace Autodesk.Viewing {
    const theExtensionManager: {
        registerExtension(id: string, cls: unknown): void;
        unregisterExtension(id: string): void;
    };

    const FeatureFlags: {
        set(name: string, enable: boolean): void;
        isEnabled(name: string): boolean | undefined;
        print(): void;
    };

    const PublicFeatureFlags: {
        SceneAPI: string;
        [name: string]: string;
    };

    function Initializer(options: object, callback: () => void): void;

    class Document {
        static load(urn: string, onSuccess: (doc: Document) => void, onError: (code: number, msg: string) => void): void;
        getRoot(): BubbleNode;
    }

    class BubbleNode {
        getDefaultGeometry(): BubbleNode;
    }

    class Extension {
        constructor(viewer: GuiViewer3D, options?: object);
        viewer: GuiViewer3D;
        options: object;
        load(): boolean | Promise<boolean>;
        unload(): boolean;
        onToolbarCreated?(toolbar: UI.ToolBar): void;
    }

    class Viewer3D {
        start(): number;
        loadDocumentNode(doc: Document, node: BubbleNode, options?: object): Promise<Model>;
        unloadModel(model: Model): boolean;
        getAllModels(): Model[];
        getVisibleModels(): Model[];
        loadExtension(id: string, options?: object): Promise<Extension>;
        getExtension(id: string): Extension | null;
        refresh(clear?: boolean): void;
        container: HTMLElement;
        toolbar?: UI.ToolBar;
    }

    class GuiViewer3D extends Viewer3D {
        constructor(container: HTMLElement, config?: object);
    }

    class Model {
        constructor();
        id: number;
        getInstances(): Scene.InstanceCollection3D;
        getObjectTreeAsync(): Promise<Scene.ObjectTree>;
        getUnitScale(): number;
        getDisplayUnit(): string;
        getData(): any;
        getDocumentNode(): { name?(): string; getModelName?(): string } | null;
        getBoundingBox(ignoreTransforms?: boolean, excludeShadow?: boolean): Math.Box3;
    }

    namespace UI {
        class DockingPanel {
            constructor(container: HTMLElement, id: string, title: string, options?: object);
            container: HTMLElement;
            title: HTMLElement;
            closer: HTMLElement;
            initialize(): void;
            createScrollContainer(options?: object): void;
            scrollContainer: HTMLElement;
            setVisible(show: boolean): void;
            isVisible(): boolean;
            uninitialize(): void;
            createTitleBar(title: string): HTMLElement;
            createCloseButton(): HTMLElement;
            initializeMoveHandlers(el: HTMLElement): void;
            addEventListener(target: EventTarget, event: string, cb: (e: Event) => void): void;
        }

        class Button {
            constructor(id: string);
            setToolTip(text: string): void;
            setIcon(cls: string): void;
            addClass(cls: string): void;
            setState(state: number): void;
            onClick: (e: Event) => void;
            container: HTMLElement;
            static State: { ACTIVE: number; INACTIVE: number; DISABLED: number };
        }

        class ControlGroup {
            constructor(id: string);
            addControl(control: Button): void;
            removeControl(control: Button): void;
        }

        class ToolBar {
            addControl(control: ControlGroup): void;
            removeControl(control: ControlGroup): void;
        }
    }

    namespace Math {
        class Vector3 {
            constructor(x?: number, y?: number, z?: number);
            x: number;
            y: number;
            z: number;
        }

        class Matrix4 {
            constructor();
            elements: ArrayLike<number>;
        }

        class Box3 {
            min: Vector3;
            max: Vector3;
        }
    }

    namespace Scene {
        type VertexAttributeReader = (index: number, out: Math.Vector3) => void;

        class BufferAttribute {
            constructor(array: ArrayLike<number>, itemSize: number);
            array: ArrayLike<number> & { buffer?: ArrayBufferLike; byteOffset?: number; BYTES_PER_ELEMENT?: number };
            itemSize?: number;
            normalized?: boolean;
            isInterleaved?(): boolean;
            getOffset?(): number;
            getStride?(): number;
        }

        class BufferGeometry {
            getVertexCount(): number;
            getPositionReader(): VertexAttributeReader | null;
            getNormalReader(): VertexAttributeReader | null;
            getNormal(index: number, target: Math.Vector3): Math.Vector3 | null;
            getPosition(index: number, target: Math.Vector3): Math.Vector3 | null;
            getIndices(): Uint16Array | Uint32Array | null;
            getEdgeIndices(): Uint16Array | Uint32Array | null;
            getAttribute(name: string): BufferAttribute | null;
            hasAttribute(name: string): boolean;
            isInterleaved(): boolean;
            isCommitted(): boolean;
        }

        class Color {
            r: number;
            g: number;
            b: number;
        }

        class Texture {
            getName(): string;
            getImage(): unknown;
            getWrapS(): number;
            getWrapT(): number;
            getOffset(): { x: number; y: number } | null;
            getRepeat(): { x: number; y: number } | null;
        }

        // Base shape shared by all material types (not a documented class).
        interface MaterialBase {
            getColor(): Color;
            getOpacity(): number;
            getTransparent(): boolean;
            getVertexColors(): boolean;
            getDepthTest(): boolean;
            getDepthWrite(): boolean;
        }

        class StandardMaterial implements MaterialBase {
            getColor(): Color;
            getOpacity(): number;
            getTransparent(): boolean;
            getVertexColors(): boolean;
            getDepthTest(): boolean;
            getDepthWrite(): boolean;
            getSpecularColor(): Color;
            getSpecularPower(): number;
            getMetal(): boolean;
            getMap(): Texture | null;
            getSide(): unknown;
        }

        class UnlitMaterial implements MaterialBase {
            getColor(): Color;
            getOpacity(): number;
            getTransparent(): boolean;
            getVertexColors(): boolean;
            getDepthTest(): boolean;
            getDepthWrite(): boolean;
            getMap(): Texture | null;
            getSide(): unknown;
        }

        class LineMaterial implements MaterialBase {
            getColor(): Color;
            getOpacity(): number;
            getTransparent(): boolean;
            getVertexColors(): boolean;
            getDepthTest(): boolean;
            getDepthWrite(): boolean;
        }

        class PointsMaterial implements MaterialBase {
            getColor(): Color;
            getOpacity(): number;
            getTransparent(): boolean;
            getVertexColors(): boolean;
            getDepthTest(): boolean;
            getDepthWrite(): boolean;
            getSize(): number;
            getMap(): Texture | null;
        }

        type Material = StandardMaterial | UnlitMaterial | LineMaterial | PointsMaterial;

        const Side: { Front: unknown; Back: unknown; Double: unknown; [key: string]: unknown } | undefined;

        class InstanceCollection3D {
            getCount(): number;
            getGeometry(instanceId: number): BufferGeometry | null;
            getMaterial(instanceId: number): Material | null;
            getTransformWorld(instanceId: number, target: Math.Matrix4): Math.Matrix4;
            getDbId(instanceId: number): number;
        }

        class ObjectTree {
            getRootId(): number;
            getNodeName(dbId: number, includeCount?: boolean): string;
            enumNodeInstances(node: number, callback: (instanceId: number) => void, recursive?: boolean): void;
        }
    }
}
