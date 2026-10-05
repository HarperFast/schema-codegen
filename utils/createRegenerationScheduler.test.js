import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRegenerationScheduler } from './createRegenerationScheduler.js';

describe('createRegenerationScheduler', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	it('coalesces a burst of requests into one run', async () => {
		const run = vi.fn();
		const scheduler = createRegenerationScheduler(run, { delayMs: 50, onError: vi.fn() });
		for (let i = 0; i < 10; i++) scheduler.schedule();
		await vi.advanceTimersByTimeAsync(50);
		expect(run).toHaveBeenCalledTimes(1);
	});

	it('runs once more after a run that was asked for again while running, never overlapping', async () => {
		/** @type {(() => void)[]} */
		const finishers = [];
		let active = 0;
		let maxActive = 0;
		const run = vi.fn(
			() =>
				new Promise((resolve) => {
					active++;
					maxActive = Math.max(maxActive, active);
					finishers.push(() => {
						active--;
						resolve(undefined);
					});
				}),
		);
		const scheduler = createRegenerationScheduler(run, { delayMs: 10, onError: vi.fn() });
		scheduler.schedule();
		await vi.advanceTimersByTimeAsync(10);
		expect(run).toHaveBeenCalledTimes(1);
		scheduler.schedule();
		scheduler.schedule();
		finishers.shift()?.();
		await vi.advanceTimersByTimeAsync(0);
		expect(run).toHaveBeenCalledTimes(2);
		finishers.shift()?.();
		await vi.advanceTimersByTimeAsync(100);
		expect(run).toHaveBeenCalledTimes(2);
		expect(maxActive).toBe(1);
	});

	it('reports a failed run and keeps serving requests', async () => {
		const onError = vi.fn();
		const run = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined);
		const scheduler = createRegenerationScheduler(run, { delayMs: 10, onError });
		scheduler.schedule();
		await vi.advanceTimersByTimeAsync(10);
		expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }));
		scheduler.schedule();
		await vi.advanceTimersByTimeAsync(10);
		expect(run).toHaveBeenCalledTimes(2);
	});

	it('keeps serving requests after a run that throws synchronously', async () => {
		const onError = vi.fn();
		const run = vi
			.fn()
			.mockImplementationOnce(() => {
				throw new Error('sync');
			})
			.mockReturnValue(undefined);
		const scheduler = createRegenerationScheduler(run, { delayMs: 10, onError });
		scheduler.schedule();
		await vi.advanceTimersByTimeAsync(10);
		expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'sync' }));
		scheduler.schedule();
		await vi.advanceTimersByTimeAsync(10);
		expect(run).toHaveBeenCalledTimes(2);
	});

	it('folds a request made synchronously by the run into one later run, never overlapping', async () => {
		let active = 0;
		let maxActive = 0;
		/** @type {ReturnType<typeof createRegenerationScheduler>} */
		let scheduler;
		const run = vi.fn(async () => {
			active++;
			maxActive = Math.max(maxActive, active);
			if (run.mock.calls.length === 1) scheduler.schedule();
			await new Promise((resolve) => setTimeout(resolve, 50));
			active--;
		});
		scheduler = createRegenerationScheduler(run, { delayMs: 10, onError: vi.fn() });
		scheduler.schedule();
		await vi.advanceTimersByTimeAsync(100);
		expect(run).toHaveBeenCalledTimes(2);
		expect(maxActive).toBe(1);
	});

	it('serves requests queued behind a run whose failure the reporter could not report, then surfaces the reporter failure', async () => {
		/** @type {(() => Promise<void>)[]} */
		const timers = [];
		vi.spyOn(globalThis, 'setTimeout').mockImplementation(
			/** @type {any} */ ((/** @type {() => Promise<void>} */ callback) => timers.push(callback)),
		);
		/** @type {ReturnType<typeof createRegenerationScheduler>} */
		let scheduler;
		const run = vi
			.fn()
			.mockImplementationOnce(async () => {
				scheduler.schedule();
				throw new Error('boom');
			})
			.mockResolvedValue(undefined);
		scheduler = createRegenerationScheduler(run, {
			delayMs: 10,
			onError: () => {
				throw new Error('reporter');
			},
		});
		scheduler.schedule();
		await expect(timers[0]()).rejects.toThrow('reporter');
		expect(run).toHaveBeenCalledTimes(2);
		scheduler.schedule();
		expect(timers).toHaveLength(2);
	});

	it('does nothing after close', async () => {
		const run = vi.fn();
		const scheduler = createRegenerationScheduler(run, { delayMs: 10, onError: vi.fn() });
		scheduler.schedule();
		scheduler.close();
		scheduler.schedule();
		await vi.advanceTimersByTimeAsync(100);
		expect(run).not.toHaveBeenCalled();
	});
});
