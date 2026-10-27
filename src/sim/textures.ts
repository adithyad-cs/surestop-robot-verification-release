// Procedural, deterministic textures for floors and walls.
import * as THREE from "three";

let floorTexture: THREE.Texture | null = null;
let wallTexture: THREE.Texture | null = null;

function makeTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000);
}

export function getFloorTexture(): THREE.Texture {
  if (floorTexture) return floorTexture;
  floorTexture = makeTexture(512, 512, (ctx) => {
    const r = lcg(7);
    for (let y = 0; y < 512; y += 64) {
      let x = -Math.floor(r() * 256);
      while (x < 512) {
        const len = 180 + r() * 200;
        const tone = 150 + Math.floor(r() * 30);
        ctx.fillStyle = `rgb(${tone + 25},${tone - 5},${tone - 45})`;
        ctx.fillRect(x, y, len, 64);
        for (let g = 0; g < 14; g++) {
          ctx.strokeStyle = `rgba(90,60,30,${0.05 + r() * 0.08})`;
          ctx.beginPath();
          const gy = y + r() * 64;
          ctx.moveTo(x, gy);
          ctx.bezierCurveTo(x + len / 3, gy + r() * 6 - 3, x + (2 * len) / 3, gy + r() * 6 - 3, x + len, gy);
          ctx.stroke();
        }
        ctx.fillStyle = "rgba(60,40,20,0.55)";
        ctx.fillRect(x, y, 2, 64);
        x += len;
      }
      ctx.fillStyle = "rgba(60,40,20,0.6)";
      ctx.fillRect(0, y, 512, 2);
    }
  });
  return floorTexture;
}

export function getWallTexture(): THREE.Texture {
  if (wallTexture) return wallTexture;
  wallTexture = makeTexture(256, 256, (ctx) => {
    const r = lcg(11);
    ctx.fillStyle = "rgb(226,222,214)";
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2500; i++) {
      const v = Math.floor(r() * 18) - 9;
      ctx.fillStyle = `rgba(${200 + v},${196 + v},${188 + v},0.25)`;
      ctx.fillRect(r() * 256, r() * 256, 2, 2);
    }
  });
  return wallTexture;
}
