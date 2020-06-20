import React from 'react'

import { AsyncParser } from '../components/Analyse/Data/AsyncParser'
import { DemoDropzone } from '../components/DemoDropzone'
import { DemoViewer } from '../components/DemoViewer'

export interface ViewerPageState {
  parser: AsyncParser | null
  tick: number | 0
  progress: number
  loading: string | false
  error?: string
}

export default class ViewerPage extends React.Component {
  state: ViewerPageState = {
    parser: null,
    tick: 0,
    progress: 0,
    loading: false,
  }

  //
  // ─── METHODS ────────────────────────────────────────────────────────────────────
  //

  onDemoDropped = (files: File[]) => {
    const demoFile: File = files[0]

    const reader = new FileReader()

    reader.onload = () => {
      const buffer = reader.result as ArrayBuffer

      this.handleBuffer(buffer)
    }

    reader.readAsArrayBuffer(demoFile)
  }

  handleBuffer = async (buffer: ArrayBuffer) => {
    try {
      this.setState({ loading: 'handleBuffer', progress: 0 })

      const parser = new AsyncParser(buffer, progress => {
        this.setState({ progress: progress })
      })

      await parser.cache()

      this.setState({
        header: parser.header,
        parser: parser,
        loading: false,
      })
    } catch (error) {
      this.setState({
        loading: false,
        error: error.message,
      })
    }
  }

  //
  // ─── RENDER ─────────────────────────────────────────────────────────────────────
  //

  render() {
    return (
      <div>
        <DemoViewer parser={this.state.parser} />

        <div className="ui-layer dropzone">
          {this.state.loading ? (
            <p>{this.state.progress}%</p>
          ) : (
            <DemoDropzone onDrop={this.onDemoDropped} />
          )}
        </div>

        <style jsx>{`
          .dropzone {
            justify-content: flex-start;
            align-items: flex-end;
            margin: 1rem;
          }
        `}</style>
      </div>
    )
  }
}
