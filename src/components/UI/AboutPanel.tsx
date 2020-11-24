import React from 'react'
import { Button } from 'semantic-ui-react'

import { TogglePanel } from '@components/UI/Shared/TogglePanel'

import { useStore, dispatch } from '@zus/store'
import { toggleUIPanelAction, parseDemoAction } from '@zus/actions'

import { getAsset } from '@utils/misc'

//
// ─── ABOUT PANEL ────────────────────────────────────────────────────────────────
//

const GITHUB_URL = `https://www.github.com/bryjch/dribble.tf`

export const AboutPanel = () => {
  const isOpen = useStore((state: any) => state.ui.activePanels.includes('AboutPanel'))

  const toggleUIPanel = () => {
    dispatch(toggleUIPanelAction('SettingsPanel', false))
    dispatch(toggleUIPanelAction('AboutPanel'))
  }

  const onClickSampleDemo = async () => {
    let url = getAsset('/samples/i52_snakewater_gc.dem')
    const fileBuffer = await fetch(url).then(res => res.arrayBuffer())
    dispatch(parseDemoAction(fileBuffer))
  }

  return (
    <div className="d-flex flex-row align-items-start">
      <Button
        compact
        icon="info"
        className="dribble-btn mr-2"
        secondary
        style={{ backgroundColor: 'rgba(30,30,30,0.75)' }}
        onClick={toggleUIPanel}
      />

      <TogglePanel className="panel" isOpen={isOpen}>
        <div className="header">
          <div>ABOUT</div>
          <Button compact secondary icon="close" size="mini" onClick={toggleUIPanel} />
        </div>

        <div className="content">
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
              Controls:
              <br />
              <b>LMB</b> ... rotate camera
              <br />
              <b>RMB / WASD</b> ... pan camera
            </p>

            <p>
              Drop your STV <code>.dem</code> file anywhere to start viewing!
            </p>

            <p>
              Or try loading a{' '}
              <span className="sample-demo" onClick={onClickSampleDemo}>
                sample demo
              </span>
              .
            </p>
          </div>

          <div className="links"></div>
        </div>
        <div className="notice">
          This project is still in early development / <a href={GITHUB_URL}>View on Github</a>
        </div>
      </TogglePanel>

      <style jsx>{`
        div > :global(.panel) {
          width: 360px;
          max-width: 100%;
          background-color: rgba(0, 0, 0, 0.7);
          color: #ffffff;
          font-size: 1rem;
          overflow: hidden;

          .header {
            display: flex;
            flex-flow: row nowrap;
            justify-content: space-between;
            align-items: center;
            letter-spacing: 2px;
            padding: 0.45rem 0.2rem 0.45rem 1.5rem;
            background-color: rgba(0, 0, 0, 0.3);
          }

          .content {
            padding: 1rem 1.5rem 2rem 1.5rem;

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

            .sample-demo {
              color: rgba(241, 104, 24, 1);
              cursor: pointer;
            }
          }

          .notice {
            padding: 0.2rem 1.5rem;
            background-color: rgba(241, 104, 24, 0.5);
            font-size: 0.8rem;
            text-align: center;

            a {
              color: #ffffff;
              text-decoration: underline;
            }
          }
        }
      `}</style>
    </div>
  )
}
