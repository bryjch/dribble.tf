import {
  AiFillFastForwardIcon,
  AiFillStepForwardIcon,
  IoMdPauseIcon,
  IoMdPlayIcon,
} from '@components/Misc/Icons'
import { cn } from '@utils/styling'

const iconClasses = 'w-5 h-5'

export const EventHistoryText = ({ type, value }: { type: string; value?: any }) => {
  switch (type) {
    case 'seekBackward':
      return <AiFillFastForwardIcon className={cn(iconClasses, 'rotate-180')} />

    case 'previousTick':
      return <AiFillStepForwardIcon className={cn(iconClasses, 'rotate-180')} />

    case 'play':
      return <IoMdPlayIcon className={cn(iconClasses)} />

    case 'pause':
      return <IoMdPauseIcon className={cn(iconClasses)} />

    case 'nextTick':
      return <AiFillStepForwardIcon className={cn(iconClasses)} />

    case 'seekForward':
      return <AiFillFastForwardIcon className={cn(iconClasses)} />

    case 'changeMaterial':
      return (
        <div className="px-2">
          Material: <span className="font-bold">{value}</span>
        </div>
      )
  }

  // Probably a string, so pad the sides a bit
  return <div className="px-2">{value}</div>
}
