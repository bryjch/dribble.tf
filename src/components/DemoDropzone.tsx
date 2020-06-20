import React from 'react'
import Dropzone, { FileRejection } from 'react-dropzone'

export interface DemoDropzoneProps {
  onDrop: (accepted: File[], rejected: FileRejection[]) => any
}

export const DemoDropzone = (props: DemoDropzoneProps) => (
  <>
    <Dropzone onDrop={props.onDrop}>
      {({ getRootProps, getInputProps }) => (
        <div className="demo-dropzone" {...getRootProps()}>
          <input {...getInputProps()} />
          <div className="text">
            Drop <code>.dem</code> file here
          </div>
        </div>
      )}
    </Dropzone>

    <style jsx>{`
      .demo-dropzone {
        display: inline-flex;
        justify-content: center;
        align-items: center;
        padding: 1rem 2rem;
        border: 1px dashed var(--text-primary);
        background-color: rgba(255, 255, 255, 0.5);
        cursor: pointer;
      }
    `}</style>
  </>
)
