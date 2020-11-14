import React from 'react'
import 'react-three-fiber'

export const Lights = () => {
  return (
    <group name="lights">
      <ambientLight color="#ffffff" intensity={0.3} />
      <directionalLight color="#ffffff" intensity={1.5} position={[100, 100, 100]} />
      <directionalLight color="#ffffff" intensity={1.5} position={[-100, -100, 100]} />
      <hemisphereLight />
    </group>
  )
}
