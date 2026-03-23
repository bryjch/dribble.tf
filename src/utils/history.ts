export type HistoryState<T> = {
  past: T[]
  present: T
  future: T[]
}

export function createHistoryState<T>(present: T): HistoryState<T> {
  return {
    past: [],
    present,
    future: [],
  }
}

export function pushHistoryState<T>(history: HistoryState<T>, present: T): HistoryState<T> {
  return {
    past: [...history.past, history.present],
    present,
    future: [],
  }
}

export function undoHistoryState<T>(history: HistoryState<T>): HistoryState<T> {
  if (history.past.length === 0) return history

  const previous = history.past[history.past.length - 1]

  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  }
}

export function redoHistoryState<T>(history: HistoryState<T>): HistoryState<T> {
  if (history.future.length === 0) return history

  const next = history.future[0]

  return {
    past: [...history.past, history.present],
    present: next,
    future: history.future.slice(1),
  }
}
