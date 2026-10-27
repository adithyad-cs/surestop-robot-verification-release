import type { TfBackend } from "./cocoSsd";

export interface BackendChoice {
  backend: TfBackend;
  reason: string;
  glRenderer: string | null;
}

const SOFTWARE_GL = /swiftshader|llvmpipe|software|softpipe|microsoft basic render/i;

/**
 * Chooses the TF.js backend: WebGL on a hardware GPU, WASM when WebGL is software-rendered
 * (measured 140 ms vs 784 ms per inference on SwiftShader). An explicit override wins.
 */
export function chooseBackend(override?: string | null): BackendChoice {
  if (override === "webgl" || override === "wasm" || override === "cpu") {
    return { backend: override, reason: "set explicitly", glRenderer: null };
  }
  let glRenderer: string | null = null;
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl2") ?? c.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return { backend: "wasm", reason: "WebGL unavailable", glRenderer: null };
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    glRenderer = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    return { backend: "wasm", reason: "WebGL probe failed", glRenderer: null };
  }
  if (SOFTWARE_GL.test(glRenderer)) {
    return { backend: "wasm", reason: "software WebGL detected; WASM is faster", glRenderer };
  }
  return { backend: "webgl", reason: "hardware WebGL", glRenderer };
}
