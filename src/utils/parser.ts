export const getDurationFromTicks = (ticks: number, tickRate = 66.67) => {
  const totalSeconds = ticks / tickRate
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = Math.ceil(totalSeconds % 60)
  let formatted = ''

  if (hours > 0) {
    formatted += (hours < 10 ? '0' + hours : hours.toString()) + ':'
  }

  formatted += (minutes < 10 ? '0' + minutes : minutes.toString()) + ':'
  formatted += seconds < 10 ? '0' + seconds : seconds.toString()

  return { totalSeconds, hours, minutes, seconds, formatted }
}
