import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRegenerationScheduler } from './createRegenerationScheduler.js';

describe('createRegenerationScheduler', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
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
		await scheduler.idle();
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
