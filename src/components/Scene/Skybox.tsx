import { useEffect } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'

import { useDerivedMap } from '@components/Scene/DerivedMap'
import { DerivedMapResult, textComponent } from '@utils/derivedMap'

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
        const images =
          result.kind === 'legacy'
            ? result.skyboxUrls
              ? await loadCubeFaceImages([
                  result.skyboxUrls.lf,
                  result.skyboxUrls.rt,
                  result.skyboxUrls.bk,
                  result.skyboxUrls.ft,
                  result.skyboxUrls.up,
                  result.skyboxUrls.dn,
                ])
              : null
            : await Promise.all(
                ['lf', 'rt', 'bk', 'ft', 'up', 'dn'].map(face => {
                  const bytes = skyFaceBytes(result, face)
                  return bytes
                    ? createImageBitmap(
                        new Blob(
                          [
                            bytes.buffer.slice(
                              bytes.byteOffset,
                              bytes.byteOffset + bytes.byteLength
                            ) as ArrayBuffer,
                          ],
                          { type: 'image/png' }
                        )
                      )
                    : null
                })
              )

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

function skyFaceBytes(
  result: Extract<DerivedMapResult, { kind: 'derived' }>,
  face: string
): Uint8Array | undefined {
  const root = result.manifest.dependencies.skybox.find(path => path.endsWith(`${face}.vmt`))
  if (!root) return undefined
  const materials = textComponent(result, 'materials.json') as {
    materials?: {
      name?: string
      textures?: { packageSourceIndex?: number; lookupPath?: string }[]
    }[]
  } | null
  const packageManifest = textComponent(result, 'material-textures.json') as {
    sources?: { output?: { fileName?: string } }[]
  } | null
  const materialName = root.replace(/^materials\//, '').replace(/\.vmt$/, '')
  const texture = materials?.materials?.find(material => material.name === materialName)
    ?.textures?.[0]
  const packaged =
    texture?.packageSourceIndex === undefined
      ? undefined
      : packageManifest?.sources?.[texture.packageSourceIndex]?.output?.fileName
  if (packaged) return result.components.get(`textures/${packaged}`)
  const vtfPath = texture?.lookupPath ?? result.sharedIndex.resources[root]?.dependencies[0]
  const decoded = vtfPath
    ? result.sharedIndex.resources[vtfPath]?.dependencies
        .map(path => result.sharedIndex.resources[path])
        .find(descriptor => descriptor?.kind === 'decodedTexture')
    : undefined
  return decoded ? result.sharedAssets.get(decoded.logicalPath) : undefined
}
