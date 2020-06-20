import * as React from 'react'

import './AnalyseMenu.css'

export interface AnalyseMenuProps {
  sessionName: string
  onShare: Function
  canShare: boolean
  isShared: boolean
}

export function AnalyseMenu({ sessionName, onShare, canShare, isShared }: AnalyseMenuProps) {
  const loc = window.location.toString().replace(/\#.+/, '') + '#' + sessionName
  const shareText = isShared ? (
    <input
      className="share-text"
      value={loc}
      readOnly={true}
      title="Use this link to join the current session"
      style={{ width: loc.length * 8 }}
      onFocus={event => {
        ;(event.target as HTMLInputElement).select()
      }}
    />
  ) : (
    ''
  )

  const shareButton = canShare ? (
    <div className="analyse-menu">
      <button
        className="share-session"
        title="Start a shared session"
        onClick={() => {
          onShare()
        }}
      />
      {shareText}
    </div>
  ) : (
    ''
  )

  return <div>{shareButton}</div>
}
