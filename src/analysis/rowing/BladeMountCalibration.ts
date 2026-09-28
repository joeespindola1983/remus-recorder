export type SignedSensorAxis = 'x' | '-x' | 'y' | '-y' | 'z' | '-z';
export interface Vector3 { x: number; y: number; z: number }

export interface BladeMountingProfile {
  handToBladeAxis: SignedSensorAxis;
  bladeFaceNormalAxis: SignedSensorAxis;
  profileVersion: string;
}

export const BLADE_MOUNT_PORT: BladeMountingProfile = {
  handToBladeAxis: 'y',
  bladeFaceNormalAxis: 'z',
  profileVersion: '1.0.0',
};

export const BLADE_MOUNT_STARBOARD: BladeMountingProfile = {
  handToBladeAxis: '-y',
  bladeFaceNormalAxis: 'z',
  profileVersion: '1.0.0',
};

export const getDefaultMountingProfile = (placement?: string): BladeMountingProfile => {
  if (placement === 'right_paddle' || placement === 'starboard') {
    return BLADE_MOUNT_STARBOARD;
  }
  return BLADE_MOUNT_PORT;
};

export interface BladeMountCalibration {
  sensorFrameToBladeFrame: [Vector3, Vector3, Vector3];
  calibrationVersion: string;
  gravityAgreement: number;
  qualified: boolean;
}

const axisVector = (axis: SignedSensorAxis): Vector3 => {
  const sign = axis.startsWith('-') ? -1 : 1;
  const name = axis.replace('-', '');
  return {x: name === 'x' ? sign : 0, y: name === 'y' ? sign : 0, z: name === 'z' ? sign : 0};
};

const dot = (left: Vector3, right: Vector3) => left.x * right.x + left.y * right.y + left.z * right.z;
const cross = (left: Vector3, right: Vector3): Vector3 => ({
  x: left.y * right.z - left.z * right.y,
  y: left.z * right.x - left.x * right.z,
  z: left.x * right.y - left.y * right.x,
});
const norm = (value: Vector3) => Math.sqrt(dot(value, value));
const normalized = (value: Vector3): Vector3 => {
  const length = norm(value);
  return length > 0 ? {x: value.x / length, y: value.y / length, z: value.z / length} : value;
};

export const calibrateBladeMount = (
  profile: BladeMountingProfile,
  restingGravitySensorFrame: Vector3,
): BladeMountCalibration => {
  const sweepAxis = axisVector(profile.handToBladeAxis);
  const featherSquareAxis = axisVector(profile.bladeFaceNormalAxis);
  if (Math.abs(dot(sweepAxis, featherSquareAxis)) > 1e-6) {
    throw new Error('Mounting axes must be orthogonal');
  }
  const verticalAxis = normalized(cross(sweepAxis, featherSquareAxis));
  const gravity = normalized(restingGravitySensorFrame);
  const gravityAgreement = Math.abs(dot(gravity, verticalAxis));
  return {
    sensorFrameToBladeFrame: [sweepAxis, featherSquareAxis, verticalAxis],
    calibrationVersion: profile.profileVersion,
    gravityAgreement,
    qualified: norm(restingGravitySensorFrame) >= 0.7 &&
      norm(restingGravitySensorFrame) <= 1.3 && gravityAgreement >= 0.75,
  };
};

export const transformToBladeFrame = (
  sensorVector: Vector3,
  calibration: BladeMountCalibration,
): {oarSweep: number; featherSquare: number; oarVertical: number} => ({
  oarSweep: dot(sensorVector, calibration.sensorFrameToBladeFrame[0]),
  featherSquare: dot(sensorVector, calibration.sensorFrameToBladeFrame[1]),
  oarVertical: dot(sensorVector, calibration.sensorFrameToBladeFrame[2]),
});
