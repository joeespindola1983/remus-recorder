import { SensorPlacement } from '../../contracts/acquisition/types';
import { SensorSample } from '../../types/wearables';
import {
  BladeMountCalibration,
  transformToBladeFrame,
} from '../../analysis/rowing/BladeMountCalibration';

export interface ParityHistoryPoint {
  left: number;
  right: number;
  parityPercent?: number | null;
  timestamp: number;
}

/**
 * Normalizes blade angular rotation around the vertical pin (yaw/sweep axis).
 * When calibration is provided, uses semantic oarSweep from transformToBladeFrame.
 * For inverted blade mounting (e.g. right_paddle) without calibration, inverts the sign so that
 * stroke phases (drive / recovery) are positive/negative symmetrically on both oars.
 */
export function normalizeBladeRotation(
  sample: SensorSample,
  placement?: SensorPlacement,
  calibration?: BladeMountCalibration,
): number | null {
  if (!sample.rotationRateRadiansPerSecond) {
    return null;
  }

  if (calibration) {
    const bladeFrame = transformToBladeFrame(
      {
        x: sample.rotationRateRadiansPerSecond.x,
        y: sample.rotationRateRadiansPerSecond.y,
        z: sample.rotationRateRadiansPerSecond.z,
      },
      calibration,
    );
    const sweep = bladeFrame.oarSweep;
    if (typeof sweep !== 'number' || Number.isNaN(sweep)) {
      return null;
    }
    return sweep;
  }

  const z = sample.rotationRateRadiansPerSecond.z;
  if (typeof z !== 'number' || Number.isNaN(z)) {
    return null;
  }
  // If mounted on the right paddle with inverted orientation, flip sign
  if (placement === 'right_paddle') {
    return -z;
  }
  return z;
}

/**
 * Calculates instantaneous parity percentage between left and right oar angular rates.
 * Returns null if both oars are within the idle deadzone.
 * Returns 0 if oars are moving in opposing directions (out of phase).
 * Returns 0-100 percentage based on magnitude alignment.
 */
export function calculateParityPercentage(
  leftAngularRate: number,
  rightAngularRate: number,
  deadzone = 0.2,
): number | null {
  const absLeft = Math.abs(leftAngularRate);
  const absRight = Math.abs(rightAngularRate);

  if (absLeft < deadzone && absRight < deadzone) {
    return null;
  }

  // Check if directions match (both positive during drive, or both negative during recovery)
  const leftSign = Math.sign(leftAngularRate);
  const rightSign = Math.sign(rightAngularRate);
  if (leftSign !== 0 && rightSign !== 0 && leftSign !== rightSign) {
    return 0;
  }

  const maxVal = Math.max(absLeft, absRight);
  const minVal = Math.min(absLeft, absRight);
  if (maxVal === 0) return 100;

  return Math.round((minVal / maxVal) * 100);
}

/**
 * Appends a history point to a fixed-length rolling buffer.
 */
export function addParityHistoryPoint(
  history: ParityHistoryPoint[],
  point: ParityHistoryPoint,
  maxPoints = 25,
): ParityHistoryPoint[] {
  const next = [...history, point];
  if (next.length > maxPoints) {
    return next.slice(next.length - maxPoints);
  }
  return next;
}
