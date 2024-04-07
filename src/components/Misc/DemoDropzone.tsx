import { useState, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'

import { useEventListener } from '@utils/hooks'
import { onUploadDemoAction } from '@zus/actions'
import { cn } from '@utils/styling'

export const DemoDropzone = () => {
  const [dropzoneActive, setDropzoneActive] = useState(false)

  const { getRootProps, getInputProps, acceptedFiles, draggedFiles } = useDropzone({
    noClick: true,
    noKeyboard: true,
    maxFiles: 1,
    multiple: false,
  })

  //
  // ─── DROPZONE DRAG HANDLERS ─────────────────────────────────────────────────────
  //

  // Callback to do something with the files
  useEffect(() => {
    if (acceptedFiles.length > 0) onUploadDemoAction(acceptedFiles)
  }, [acceptedFiles, onUploadDemoAction])

  // Reset dropzone active state after user has dropped files
  useEffect(() => {
    if (draggedFiles.length === 0) setDropzoneActive(false)
  }, [draggedFiles])

  //
  // ─── WINDOW DRAG HANDLERS ───────────────────────────────────────────────────────
  // These additional drag handlers are necessary to allow for fullscreen
  // dropzone handling, because disabling point-events also disables drop listeners

  let lastTarget: any = null

  const handleDragEnter = (e: DragEvent) => {
    lastTarget = e.target
    setDropzoneActive(true)
  }

  const handleDragLeave = (e: DragEvent) => {
    if (lastTarget === e.target) {
      setDropzoneActive(false)
    }
  }

  useEventListener('dragenter', handleDragEnter, window)
  useEventListener('dragleave', handleDragLeave, window)

  //
  // ─── RENDER ─────────────────────────────────────────────────────────────────────
  //

  return (
    <div
      className={cn(
        'absolute inset-0 flex items-center justify-center transition-[0.1s_ease_all]',
        dropzoneActive ? 'bg-black/40' : 'pointer-events-none'
      )}
      {...getRootProps()}
    >
      <input {...getInputProps()} />

      {dropzoneActive && (
        <div className="relative flex aspect-square flex-col items-center justify-center rounded-3xl p-20 text-center">
          <div className="absolute h-2/3 w-2/3 animate-[ping_1.5s_cubic-bezier(0,0,0.2,1)_infinite] rounded-full bg-white/20" />
          <div className="absolute inset-0 h-full w-full rounded-full border-2 border-dashed border-white/30" />

          <div className="relative">
            <div className="text-2xl font-black">
              Drop <code>.dem</code> file to parse
            </div>

            <div className="mt-2 text-lg">
              Only <span className="font-bold">STV demos</span> are supported!
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
