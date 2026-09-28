import {calibrateBladeMount, transformToBladeFrame} from '../src/analysis/rowing/BladeMountCalibration';

describe('Blade mounting calibration', () => {
  it('uses the physical hand-to-blade and blade-face marks instead of hardcoded raw axes', () => {
    const calibration = calibrateBladeMount({
      handToBladeAxis: '-y',
      bladeFaceNormalAxis: 'x',
      profileVersion: 'blade-mount-v1',
    }, {x: 0, y: 0, z: 1});

    expect(calibration.qualified).toBe(true);
    expect(transformToBladeFrame({x: 2, y: -3, z: 4}, calibration)).toEqual({
      oarSweep: 3,
      featherSquare: 2,
      oarVertical: 4,
    });
  });

  it('rejects a resting calibration inconsistent with gravity', () => {
    const calibration = calibrateBladeMount({
      handToBladeAxis: 'x',
      bladeFaceNormalAxis: 'y',
      profileVersion: 'blade-mount-v1',
    }, {x: 1, y: 0, z: 0});
    expect(calibration.qualified).toBe(false);
  });
});
