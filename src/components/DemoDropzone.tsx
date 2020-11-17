import React, { useState, useEffect } from 'react'
import { useDropzone, FileRejection } from 'react-dropzone'

import { useEventListener } from '@utils/hooks'

export interface DemoDropzoneProps {
  onDrop: (accepted: File[], rejected: FileRejection[]) => any
}

export const DemoDropzone = (props: DemoDropzoneProps) => {
  const { onDrop } = props

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
    if (acceptedFiles.length > 0) onDrop(acceptedFiles, [])
  }, [acceptedFiles, onDrop])

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
    <>
      <div
        className={`demo-dropzone ${dropzoneActive ? 'active' : 'disabled'}`}
        {...getRootProps()}
      >
        <input {...getInputProps()} />

        {dropzoneActive && (
          <div className="hint">
            <span>
              Drop <code>.dem</code> file to parse
            </span>

            <br />

            <span style={{ fontSize: '1rem' }}>Only STV demos are supported!</span>
          </div>
        )}
      </div>

      <style jsx>{`
        .demo-dropzone {
          display: flex;
          justify-content: center;
          align-items: flex-start;
          position: absolute;
          top: 0;
          right: 0;
          bottom: 0;
          left: 0;
          color: #ffffff;
          transition: 0.1s ease all;

          &.active {
            background-color: rgba(0, 0, 0, 0.4);
          }

          &.disabled {
            pointer-events: none;
          }

          .hint {
            margin-top: 100px;
            font-size: 1.8rem;
            text-align: center;
          }
        }
      `}</style>
    </>
  )
}
