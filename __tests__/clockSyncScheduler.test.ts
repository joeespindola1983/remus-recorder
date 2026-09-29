import { ClockSyncScheduler } from '../src/services/blade/ClockSyncScheduler';

describe('ClockSyncScheduler (TDD)', () => {
  let scheduler: ClockSyncScheduler;

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    scheduler?.destroy();
    jest.useRealTimers();
  });

  it('runs round-robin clock sync across registered devices with at most one in-flight per connection', async () => {
    const inFlightPerDevice = new Map<string, number>();
    const requestCalls: string[] = [];

    const makeDeviceFn = (id: string, latencyMs = 100) => {
      inFlightPerDevice.set(id, 0);
      return jest.fn(async () => {
        const current = inFlightPerDevice.get(id) ?? 0;
        expect(current).toBe(0); // At most one in-flight!
        inFlightPerDevice.set(id, current + 1);
        requestCalls.push(id);

        await new Promise(r => setTimeout(r, latencyMs));
        inFlightPerDevice.set(id, 0);
        return true;
      });
    };

    scheduler = new ClockSyncScheduler({
      tickIntervalMs: 250,
      initialBurstCount: 2,
    });

    const dev1Fn = makeDeviceFn('dev1');
    const dev2Fn = makeDeviceFn('dev2');

    scheduler.registerDevice('dev1', dev1Fn);
    scheduler.registerDevice('dev2', dev2Fn);

    // Initial burst queued for dev1 and dev2
    scheduler.queueBurst('dev1');
    scheduler.queueBurst('dev2');

    // Tick 1 (t=250ms) -> dev1 requested
    jest.advanceTimersByTime(250);
    await Promise.resolve();
    expect(requestCalls).toEqual(['dev1']);

    // dev1 finishes after 100ms
    jest.advanceTimersByTime(100);
    await Promise.resolve();

    // Tick 2 (t=500ms) -> round-robin moves to dev2
    jest.advanceTimersByTime(150);
    await Promise.resolve();
    expect(requestCalls).toEqual(['dev1', 'dev2']);

    // dev2 finishes after 100ms
    jest.advanceTimersByTime(100);
    await Promise.resolve();

    // Tick 3 (t=750ms) -> second burst for dev1
    jest.advanceTimersByTime(150);
    await Promise.resolve();
    expect(requestCalls).toEqual(['dev1', 'dev2', 'dev1']);
  });

  it('stops sending requests to unregistered or disconnected devices', () => {
    const dev1Fn = jest.fn().mockResolvedValue(true);
    scheduler = new ClockSyncScheduler({ tickIntervalMs: 250 });

    scheduler.registerDevice('dev1', dev1Fn);
    scheduler.queueBurst('dev1');

    scheduler.unregisterDevice('dev1');

    jest.advanceTimersByTime(1000);
    expect(dev1Fn).not.toHaveBeenCalled();
  });
});
