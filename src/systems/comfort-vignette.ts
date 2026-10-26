import { BackSide, Color, CylinderGeometry, Mesh, ShaderMaterial } from '@iwsdk/core';

/**
 * A soft dark ring round the edge of view, for comfort while the view moves
 * by itself (like IWSDK's slide vignette). Add it to the camera and set
 * `material.uniforms.uAlpha` (0 none to 1 black at the rim).
 */
export function createVignette(): Mesh<CylinderGeometry, ShaderMaterial> {
  const mesh = new Mesh(
    new CylinderGeometry(0.3, 0.15, 0.3, 16, 1, true),
    new ShaderMaterial({
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uAlpha;
        varying vec2 vUv;
        void main() {
          gl_FragColor = vec4(uColor, uAlpha * vUv.y);
        }`,
      uniforms: { uColor: { value: new Color(0x000000) }, uAlpha: { value: 0 } },
      depthTest: false,
      side: BackSide,
      transparent: true,
    }),
  );
  mesh.frustumCulled = false;
  mesh.renderOrder = 999;
  mesh.rotateX(Math.PI / 2);
  mesh.position.z = -0.15;
  return mesh;
}
