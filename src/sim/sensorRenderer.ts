import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

/** Layer used for physical scene geometry. Visual helpers (paths, markers) use other layers. */
export const PHYSICAL_LAYER = 0;

export interface CameraIntrinsics {
  width: number;
  height: number;
  /** Vertical field of view in degrees. */
  vfovDeg: number;
  near: number;
  far: number;
}

export const ROBOT_CAMERA: CameraIntrinsics = { width: 640, height: 480, vfovDeg: 50, near: 0.05, far: 30 };

export function makeRobotCamera(intr: CameraIntrinsics = ROBOT_CAMERA): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(intr.vfovDeg, intr.width / intr.height, intr.near, intr.far);
  cam.layers.set(PHYSICAL_LAYER);
  return cam;
}

const DEPTH_VERT = /* glsl */ `
uniform mat3 uvTransform;
varying vec2 vUv;
varying float vViewZ;
void main() {
  vUv = (uvTransform * vec3(uv, 1.0)).xy;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewZ = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const DEPTH_FRAG = /* glsl */ `
uniform sampler2D map;
uniform float alphaTest;
uniform bool useMap;
varying vec2 vUv;
varying float vViewZ;
void main() {
  if (useMap) {
    float a = texture2D(map, vUv).a;
    if (a < alphaTest) discard;
  }
  gl_FragColor = vec4(vViewZ, 0.0, 0.0, 1.0);
}`;

type AnyMaterial = THREE.Material & {
  map?: THREE.Texture | null;
  alphaTest: number;
  transmission?: number;
};

/**
 * Renders what the robot-mounted camera sees: an sRGB colour image (for the detector)
 * and a pixel-aligned linear depth image (for the range sensor). Both passes use the
 * same camera and intrinsics, so pixel (u, v) in the depth image is the range along
 * the same ray that produced pixel (u, v) in the colour image.
 */
export class SensorRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  private readonly depthTarget: THREE.WebGLRenderTarget;
  private readonly depthMaterials = new Map<string, THREE.ShaderMaterial>();
  private readonly env: THREE.Texture;
  private readonly rgbBuf: Uint8Array;
  private readonly depthBuf: Float32Array;

  constructor(readonly intr: CameraIntrinsics = ROBOT_CAMERA) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = intr.width;
    this.canvas.height = intr.height;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(intr.width, intr.height, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    if (!this.renderer.extensions.has("EXT_color_buffer_float")) {
      throw new Error("Depth sensor requires EXT_color_buffer_float (WebGL2 float render targets).");
    }
    this.depthTarget = new THREE.WebGLRenderTarget(intr.width, intr.height, {
      type: THREE.FloatType,
      format: THREE.RGBAFormat,
      depthBuffer: true,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    });
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.rgbBuf = new Uint8Array(intr.width * intr.height * 4);
    this.depthBuf = new Float32Array(intr.width * intr.height * 4);
  }

  /** Colour image exactly as the detector will receive it (row 0 = top of image). */
  renderRGB(scene: THREE.Scene, camera: THREE.Camera): ImageData {
    const { width: w, height: h } = this.intr;
    const prevEnv = scene.environment;
    scene.environment = this.env;
    this.renderer.setRenderTarget(null);
    this.renderer.render(scene, camera);
    scene.environment = prevEnv;
    const gl = this.renderer.getContext();
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, this.rgbBuf);
    const out = new ImageData(w, h);
    const row = w * 4;
    for (let y = 0; y < h; y++) {
      out.data.set(this.rgbBuf.subarray((h - 1 - y) * row, (h - y) * row), y * row);
    }
    return out;
  }

  /**
   * Linear depth (metres along the optical axis) per pixel, row 0 = top.
   * 0 means no surface was hit. Alpha-masked surfaces (e.g. leaf cards) honour their
   * alpha test; transmissive/blended surfaces (glass) are not returned, as with many RGB-D sensors.
   */
  renderDepth(scene: THREE.Scene, camera: THREE.Camera): Float32Array {
    const { width: w, height: h } = this.intr;
    const swapped: Array<[THREE.Mesh, THREE.Material | THREE.Material[]]> = [];
    const hidden: THREE.Object3D[] = [];
    scene.traverseVisible((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) {
        if ((o as THREE.Line).isLine || (o as THREE.Points).isPoints || (o as THREE.Sprite).isSprite) {
          hidden.push(o);
        }
        return;
      }
      const orig = mesh.material;
      const first = (Array.isArray(orig) ? orig[0] : orig) as AnyMaterial;
      if (this.isSeeThrough(first)) {
        hidden.push(mesh);
        return;
      }
      swapped.push([mesh, orig]);
      mesh.material = Array.isArray(orig)
        ? orig.map((m) => this.depthMaterialFor(m as AnyMaterial))
        : this.depthMaterialFor(orig as AnyMaterial);
    });
    hidden.forEach((o) => (o.visible = false));
    const prevBg = scene.background;
    const prevEnv = scene.environment;
    const prevTone = this.renderer.toneMapping;
    scene.background = null;
    scene.environment = null;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setRenderTarget(this.depthTarget);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear(true, true, true);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.toneMapping = prevTone;
    scene.background = prevBg;
    scene.environment = prevEnv;
    swapped.forEach(([mesh, mat]) => (mesh.material = mat));
    hidden.forEach((o) => (o.visible = true));

    this.renderer.readRenderTargetPixels(this.depthTarget, 0, 0, w, h, this.depthBuf);
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const src = (h - 1 - y) * w;
      const dst = y * w;
      for (let x = 0; x < w; x++) out[dst + x] = this.depthBuf[(src + x) * 4];
    }
    return out;
  }

  private isSeeThrough(m: AnyMaterial): boolean {
    if ((m.transmission ?? 0) > 0) return true;
    return m.transparent && m.opacity < 0.5;
  }

  private depthMaterialFor(m: AnyMaterial): THREE.ShaderMaterial {
    let dm = this.depthMaterials.get(m.uuid);
    if (dm) return dm;
    const map = m.map ?? null;
    const useMap = !!map && (m.alphaTest > 0 || m.transparent);
    if (map) map.updateMatrix();
    dm = new THREE.ShaderMaterial({
      vertexShader: DEPTH_VERT,
      fragmentShader: DEPTH_FRAG,
      uniforms: {
        map: { value: map },
        alphaTest: { value: m.alphaTest > 0 ? m.alphaTest : 0.5 },
        useMap: { value: useMap },
        uvTransform: { value: map ? map.matrix.clone() : new THREE.Matrix3() },
      },
      side: m.side,
    });
    this.depthMaterials.set(m.uuid, dm);
    return dm;
  }

  dispose(): void {
    this.depthTarget.dispose();
    this.depthMaterials.forEach((m) => m.dispose());
    this.env.dispose();
    this.renderer.dispose();
  }
}
