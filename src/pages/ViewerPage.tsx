import React from 'react'

import { AsyncParser } from '@components/Analyse/Data/AsyncParser'
import { DemoDropzone } from '@components/DemoDropzone'
import { DemoViewer } from '@components/DemoViewer'

import { getAsset } from '@utils/misc'

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

  onClickSampleDemo = async () => {
    let url = getAsset('/samples/i52_snakewater_gc.dem')

    const demoBuffer: ArrayBuffer = await fetch(url).then(res => res.arrayBuffer())

    this.handleBuffer(demoBuffer)
  }

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

      try {
        await parser.cache()
      } catch (error) {
        alert(`Unable to load demo. Please make sure it's a valid SourceTV .dem file.`)
        throw error
      }

      console.log('%c-------- Parser loaded --------', 'color: blue; font-size: 16px;')
      console.log(parser)
      console.log('%c-------------------------------', 'color: blue; font-size: 16px;')

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

        {!this.state.parser && !this.state.loading && (
          <div className="ui-layer welcome">
            <div className="panel">
              <div className="title">dribble.tf</div>

              <div className="subtitle">
                Demo replay in browser <span style={{ opacity: 0.3 }}>but less epic</span>
              </div>

              <div className="intro">
                <p>Watch Team Fortress 2 STV demos in your browser... kinda.</p>

                <p>
                  Currently only supports:
                  <br />
                  - cp_gullywash
                  <br />
                  - cp_process
                  <br />
                  - cp_snakewater
                  <br />
                  - cp_sunshine
                  <br />- koth_product_rcx
                </p>

                <p>
                  Drop your STV <code>.dem</code> file anywhere to start viewing!
                </p>

                <p>
                  Or try loading a{' '}
                  <span className="sample-demo" onClick={this.onClickSampleDemo}>
                    sample demo
                  </span>
                  .
                </p>
              </div>

              <div className="notice">This project is still in early development</div>
            </div>
          </div>
        )}

        {this.state.loading ? (
          <div className="ui-layer loading-demo">
            <div className="panel">
              <div>Parsing demo... {this.state.progress}%</div>
            </div>
          </div>
        ) : (
          <div className="ui-layer">
            <DemoDropzone onDrop={this.onDemoDropped} />
          </div>
        )}

        <style jsx>{`
          .ui-layer {
            &.welcome {
              justify-content: flex-end;
              align-items: flex-start;
              margin: 3vw;
              z-index: 100; // make this layer less important

              .panel {
                display: inline-flex;
                flex-flow: column nowrap;
                color: #ffffff;
                background: rgba(30, 30, 30, 0.75);
                padding: 1.5rem;
                max-width: 320px;

                .title {
                  font-family: 'Lato';
                  font-size: 1.7rem;
                  font-weight: 500;
                  line-height: 1.2;
                }

                .subtitle {
                  font-size: 0.85rem;
                }

                .intro {
                  margin-top: 1rem;
                }

                .notice {
                  margin: 1rem -1.5rem -1.5rem -1.5rem;
                  padding: 0.2rem 1.5rem;
                  background-color: rgba(241, 104, 24, 0.5);
                  font-size: 0.8rem;
                  text-align: center;
                }

                .sample-demo {
                  color: rgba(241, 104, 24, 1);
                  cursor: pointer;
                }
              }
            }

            &.loading-demo {
              justify-content: center;
              align-items: flex-start;
              top: 80px;

              .panel {
                display: inline-flex;
                color: #ffffff;
                background-color: rgba(30, 30, 30, 0.75);
                padding: 0.75rem 1rem;
              }
            }
          }
        `}</style>
      </div>
    )
  }
}
