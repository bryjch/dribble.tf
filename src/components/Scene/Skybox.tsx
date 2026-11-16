import { useEffect } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'

import { useDerivedMap } from '@components/Scene/DerivedMap'

export interface SkyboxProps {
  map: string
}

export const Skybox = (props: SkyboxProps) => {
  const { scene, gl } = useThree()
  const { result } = useDerivedMap()

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

    const pickTargetFaceSize = (images: (HTMLImageElement | ImageBitmap)[]) => {
      let size = 0
      for (const image of images) {
        const width = 'naturalWidth' in image ? image.naturalWidth || image.width || 0 : image.width
        const height =
          'naturalHeight' in image ? image.naturalHeight || image.height || 0 : image.height
        size = Math.max(size, width, height)
      }
      return size
    }

    const normalizeCubeFace = (image: HTMLImageElement | ImageBitmap, size: number) => {
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
        if (!result) return
        const urls = result.skyboxUrls
        const images = urls
          ? await loadCubeFaceImages([urls.lf, urls.rt, urls.bk, urls.ft, urls.up, urls.dn])
          : null

        if (!images || images.some(image => !image)) {
          console.warn(`Failed to load skybox for map ${props.map}`)
          return
        }
        const validImages = images as (HTMLImageElement | ImageBitmap)[]
        if (cancelled) return

        if (validImages.length !== 6) {
          console.warn(
            `[Skybox] Invalid cubemap faces for ${props.map}: expected 6, got ${validImages.length}`
          )
          return
        }

        const targetSize = pickTargetFaceSize(validImages)
        if (targetSize <= 0) {
          console.warn(`[Skybox] Invalid cubemap dimensions for ${props.map}`)
          return
        }

        const sizes = validImages.map(img => ({
          width: 'naturalWidth' in img ? img.naturalWidth || img.width || 0 : img.width,
          height: 'naturalHeight' in img ? img.naturalHeight || img.height || 0 : img.height,
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

        const normalizedFaces = validImages.map(image => normalizeCubeFace(image, targetSize))

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
  }, [props.map, scene, gl, result])

  return null
}
