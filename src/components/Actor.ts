import * as THREE from 'three'
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer'

// Default TF2 player dimensions as specified in:
// https://developer.valvesoftware.com/wiki/TF2/Team_Fortress_2_Mapper%27s_Reference
export const ActorDimensions = new THREE.Vector3(49, 49, 83)

export const AimLinePoints = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(200, 0, 0)]

export class Actor extends THREE.Group {
  model: THREE.Mesh<THREE.BoxGeometry, THREE.MeshLambertMaterial>
  aimLine: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>
  nameplate: CSS2DObject
  name: string
  originalColor: string

  constructor(color: string, nameplateEl: HTMLElement) {
    super()

    // Character model
    const modelGeo = new THREE.BoxGeometry(...ActorDimensions.toArray())
    const modelMat = new THREE.MeshLambertMaterial({ color: color })
    const model = new THREE.Mesh(modelGeo, modelMat)

    // Aim line
    const aimLineGeo = new THREE.BufferGeometry().setFromPoints(AimLinePoints)
    const aimLineMat = new THREE.LineBasicMaterial({ color: color })
    const aimLine = new THREE.Line(aimLineGeo, aimLineMat)

    // Nameplate
    const nameplate = new CSS2DObject(nameplateEl)
    nameplate.position.add(new THREE.Vector3(0, 0, ActorDimensions.z * 1.5))

    // Assigns
    this.name = 'ACTOR'
    this.originalColor = color
    this.model = model
    this.aimLine = aimLine
    this.nameplate = nameplate

    this.add(model)
    this.add(aimLine)
    this.add(nameplate)
  }

  updateVisibility(visible: boolean): void {
    this.model.visible = visible
    this.aimLine.visible = visible
    this.nameplate.visible = visible
  }

  onHoverEnter(): void {
    this.model.material.color = new THREE.Color('#ffffff')
  }

  onHoverLeave(): void {
    this.model.material.color = new THREE.Color(this.originalColor)
  }
}
