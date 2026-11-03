import * as THREE from 'three';
import { CONTRAST, FLUORO } from '../config/anatomy';

/**
 * X-ray attenuation materials. Each fragment outputs its transmission (1 − attenuation) and
 * is multiplied into a white target (dst = dst · src), so overlapping structures darken like
 * stacked absorbers. No depth test: everything along the ray counts.
 */
function xrayBase(fragment: string, vertexExtra = '', vertexBody = '', uniforms: Record<string, THREE.IUniform> = {}, side: THREE.Side = THREE.FrontSide) {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      ${vertexExtra}
      varying float vTh;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec3 n = normalize(normalMatrix * normal);
        vec3 v = normalize(-mv.xyz);
        vTh = abs(dot(n, v));
        ${vertexBody}
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vTh;
      ${fragment}`,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.ZeroFactor,
    blendDst: THREE.SrcColorFactor,
  });
}

/** Solid absorber whose path length is largest through the middle (|n·v|^pow). */
export function solidMaterial(att: number, pow = 0.6): THREE.ShaderMaterial {
  return xrayBase(
    /* glsl */ `
      uniform float uAtt; uniform float uPow;
      void main() { float a = uAtt * pow(vTh, uPow); gl_FragColor = vec4(vec3(1.0 - a), 1.0); }`,
    '',
    '',
    { uAtt: { value: att }, uPow: { value: pow } },
  );
}

/** Thin shell (stent): darker at the rims where the ray grazes the metal. */
export function shellMaterial(att: number): THREE.ShaderMaterial {
  return xrayBase(
    /* glsl */ `
      uniform float uAtt;
      void main() { float a = uAtt * (0.35 + 0.65 * (1.0 - vTh)); gl_FragColor = vec4(vec3(1.0 - a), 1.0); }`,
    '',
    '',
    { uAtt: { value: att } },
    THREE.DoubleSide,
  );
}

/**
 * Vessel lumen: contrast density from per-vertex arrival time (front, then washout tail);
 * darkness grows with the local lumen diameter (1 − e^(−k·Ø)), so a stenosis looks thin
 * and faint while a wide vessel saturates.
 */
export function vesselMaterial(): THREE.ShaderMaterial {
  return xrayBase(
    /* glsl */ `
      varying float vA;
      void main() { float a = vA * sqrt(vTh); gl_FragColor = vec4(vec3(1.0 - a), 1.0); }`,
    /* glsl */ `
      attribute float arrival;
      attribute float diam;
      uniform float uT; uniform float uDur; uniform float uWash; uniform float uIntensity;
      uniform float uK; uniform float uMax; uniform float uEmpty;
      varying float vA;`,
    /* glsl */ `
      float d = smoothstep(arrival, arrival + 0.15, uT) * (1.0 - smoothstep(arrival + uDur, arrival + uDur + uWash, uT));
      if (arrival > 1e5) d = 0.0;
      // Beer–Lambert-like saturation: thin lumen → faint, wide lumen → up to uMax.
      vA = uMax * (1.0 - exp(-uK * diam * d)) * uIntensity + uEmpty;`,
    {
      uT: { value: -1 },
      uDur: { value: CONTRAST.selectiveInjectionS },
      uWash: { value: CONTRAST.washoutS },
      uIntensity: { value: 0 },
      uK: { value: FLUORO.contrastAttenuationPerMm },
      uMax: { value: FLUORO.contrastMaxDarkness },
      uEmpty: { value: FLUORO.emptyVesselAttenuation },
    },
  );
}

/** Dissection stain: dye fills the false lumen and lingers after washout. */
export function stainMaterial(): THREE.ShaderMaterial {
  return xrayBase(
    /* glsl */ `
      uniform float uDensity;
      void main() { float a = 0.55 * uDensity * sqrt(vTh); gl_FragColor = vec4(vec3(1.0 - a), 1.0); }`,
    '',
    '',
    { uDensity: { value: 0 } },
  );
}

/** Post-process: blur, quantum noise, square collimation, vignette, display levels. */
export function postMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      tScene: { value: null },
      uRes: { value: new THREE.Vector2(1, 1) },
      uSquare: { value: 1 },
      uSeed: { value: 0 },
      uNoise: { value: FLUORO.noiseAmount },
      uBlur: { value: FLUORO.blurPx },
      uVignette: { value: FLUORO.vignette },
      uCollimation: { value: FLUORO.collimation },
    },
    vertexShader: /* glsl */ `void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tScene; uniform vec2 uRes; uniform float uSquare; uniform float uSeed;
      uniform float uNoise; uniform float uBlur; uniform float uVignette; uniform float uCollimation;
      float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21) + uSeed); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      void main() {
        vec2 c = gl_FragCoord.xy - 0.5 * uRes;
        vec2 uv = c / uSquare + 0.5;
        float hw = 0.5 * uCollimation;
        if (abs(c.x) > hw * uSquare || abs(c.y) > hw * uSquare) { gl_FragColor = vec4(0.02, 0.02, 0.025, 1.0); return; }
        vec2 px = vec2(uBlur) / uSquare;
        float I = texture2D(tScene, uv).r * 0.4
          + (texture2D(tScene, uv + vec2(px.x, 0.0)).r + texture2D(tScene, uv - vec2(px.x, 0.0)).r
          +  texture2D(tScene, uv + vec2(0.0, px.y)).r + texture2D(tScene, uv - vec2(0.0, px.y)).r) * 0.15;
        float n = (hash(gl_FragCoord.xy) + hash(gl_FragCoord.yx + 7.0) - 1.0) * uNoise * (0.4 + sqrt(max(I, 0.0)));
        float r = length(uv - 0.5) * 1.6;
        float v = 1.0 - uVignette * r * r;
        float g = clamp((0.1 + 0.78 * I + n) * v, 0.0, 1.0);
        gl_FragColor = vec4(vec3(g), 1.0);
      }`,
    depthTest: false,
    depthWrite: false,
  });
}

/** Plain copy of the held frame to the screen. */
export function blitMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { tFrame: { value: null }, uRes: { value: new THREE.Vector2(1, 1) } },
    vertexShader: /* glsl */ `void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tFrame; uniform vec2 uRes;
      void main() { gl_FragColor = texture2D(tFrame, gl_FragCoord.xy / uRes); }`,
    depthTest: false,
    depthWrite: false,
  });
}
