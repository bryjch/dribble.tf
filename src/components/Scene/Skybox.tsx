import { useEffect } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'

import { getMapSkyboxUrls } from '@utils/game'

export interface SkyboxProps {
  map: string
}

export const Skybox = (props: SkyboxProps) => {
  const { scene, gl } = useThree()

  useEffect(() => {
    let skyboxTexture: THREE.CubeTexture | null = null
    let environmentTexture: THREE.Texture | null = null
    let pmrem: THREE.PMREMGenerator | null = null
    let cancelled = false

    const loadCubeFaceImages = (urls: string[]) => {
      const imageLoader = new THREE.ImageLoader()
      imageLoader.setCrossOrigin('anonymous')

      return Promise.all(
        urls.map(
          url =>
            new Promise<HTMLImageElement>((resolve, reject) => {
              imageLoader.load(url, image => resolve(image as HTMLImageElement), undefined, reject)
            })
        )
      )
    }

    const pickTargetFaceSize = (images: HTMLImageElement[]) => {
      let size = 0
      for (const image of images) {
        const width = image.naturalWidth || image.width || 0
        const height = image.naturalHeight || image.height || 0
        size = Math.max(size, width, height)
      }
      return size
    }

    const normalizeCubeFace = (image: HTMLImageElement, size: number) => {
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size

      const context = canvas.getContext('2d')
      if (context) {
        context.imageSmoothingEnabled = true
        context.imageSmoothingQuality = 'high'
        context.clearRect(0, 0, size, size)
        context.drawImage(image, 0, 0, size, size)
      }

      return canvas
    }

    const loadSkybox = async () => {
      try {
        const mapSkyboxFileUrls = getMapSkyboxUrls(props.map)

        if (!mapSkyboxFileUrls) {
          console.warn(`Failed to load skybox for map ${props.map}`)
          return
        }

        const urls = [
          mapSkyboxFileUrls.lf,
          mapSkyboxFileUrls.rt,
          mapSkyboxFileUrls.bk,
          mapSkyboxFileUrls.ft,
          mapSkyboxFileUrls.up,
          mapSkyboxFileUrls.dn,
        ]

        const images = await loadCubeFaceImages(urls)
        if (cancelled) return

        if (images.length !== 6) {
          console.warn(
            `[Skybox] Invalid cubemap faces for ${props.map}: expected 6, got ${images.length}`
          )
          return
        }

        const targetSize = pickTargetFaceSize(images)
        if (targetSize <= 0) {
          console.warn(`[Skybox] Invalid cubemap dimensions for ${props.map}`)
          return
        }

        const sizes = images.map(img => ({
          width: img.naturalWidth || img.width || 0,
          height: img.naturalHeight || img.height || 0,
        }))
        const hasMixedDimensions = sizes.some(
          s => s.width !== targetSize || s.height !== targetSize
        )
        if (hasMixedDimensions) {
          console.warn(`[Skybox] Normalizing cubemap face sizes for ${props.map}`, {
            targetSize,
            sizes,
          })
        }

        const normalizedFaces = images.map(image => normalizeCubeFace(image, targetSize))

        skyboxTexture = new THREE.CubeTexture(normalizedFaces)
        skyboxTexture.colorSpace = THREE.SRGBColorSpace
        skyboxTexture.generateMipmaps = false
        skyboxTexture.minFilter = THREE.LinearFilter
        skyboxTexture.magFilter = THREE.LinearFilter
        skyboxTexture.needsUpdate = true

        if (cancelled) {
          skyboxTexture.dispose()
          return
        }

        scene.background = skyboxTexture

        pmrem = new THREE.PMREMGenerator(gl)
        environmentTexture = pmrem.fromCubemap(skyboxTexture).texture
        scene.environment = environmentTexture
      } catch (error) {
        console.warn(`Failed to load skybox for map ${props.map}`)
        console.error(error)
      }
    }

    loadSkybox()

    return () => {
      cancelled = true

      scene.background = null
      scene.environment = null

      if (environmentTexture) environmentTexture.dispose()
      if (skyboxTexture) skyboxTexture.dispose()
      if (pmrem) pmrem.dispose()
    }
  }, [props.map, scene, gl])

  return null
}
