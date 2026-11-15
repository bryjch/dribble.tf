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
      className={cn('absolute inset-0', dropzoneActive ? 'ui-dropzone' : 'pointer-events-none')}
      {...getRootProps()}
    >
      <input {...getInputProps()} />

      {dropzoneActive && (
        <div className="ui-dropzone__target">
          <div className="ui-dropzone__title">
            Drop the <code>.dem</code> to open it
          </div>
          <div className="ui-muted">SourceTV demos only</div>
        </div>
      )}
    </div>
  )
}
