import * as THREE from 'three'

export const DEFAULT_SCENE = {
  mapName: 'cp_snakewater_final1',
  cameraOffset: new THREE.Vector3(900, -700, 500),
  bounds: {
    center: new THREE.Vector3(6179, 2805, 542.5).add(new THREE.Vector3(0, 0, 0)),
    max: new THREE.Vector3(6687, 2961, 960),
    min: new THREE.Vector3(-5671, -2649, -584),
  },
}
