import React from 'react'
import 'react-three-fiber'

export const Lights = () => {
  return (
    <group name="lights">
      <ambientLight intensity={0.3} />
      <directionalLight color="#ffffff" intensity={0.5} position={[100, 100, 100]} />
      <directionalLight color="#ffffff" intensity={0.5} position={[-100, -100, 100]} />
    </group>
  )
}
