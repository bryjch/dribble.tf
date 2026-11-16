import * as THREE from 'three'

/**
 * Source's field of view (fov_desired, viewmodel_fov, a sniper's zoom) is horizontal on a 4:3
 * screen, and a wider screen sees more to the sides; three.js wants the vertical.
 */
export const sourceVerticalFov = (sourceFov: number) =>
  THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(sourceFov) / 2) * 0.75))
