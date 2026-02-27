export const POSITION_FIXED_SCALE = 32
export const ANGLE_FIXED_SCALE = 256

const decodeFixedValue = (raw: number, scale: number): number => {
  return (raw | 0) / scale
}

const encodeFixedValue = (value: number, scale: number): number => {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * scale)
}

export const decodeFixedPosition = (raw: number): number => {
  return decodeFixedValue(raw, POSITION_FIXED_SCALE)
}

export const encodeFixedPosition = (value: number): number => {
  return encodeFixedValue(value, POSITION_FIXED_SCALE)
}

export const decodeFixedAngle = (raw: number, scale: number = ANGLE_FIXED_SCALE): number => {
  return decodeFixedValue(raw, scale)
}

export const encodeFixedAngle = (value: number, scale: number = ANGLE_FIXED_SCALE): number => {
  return encodeFixedValue(value, scale)
}
