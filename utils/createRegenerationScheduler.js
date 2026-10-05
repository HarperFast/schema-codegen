/**
 * Coalesces regeneration requests: requests made while a run is pending or in progress collapse
 * into one more run after it, so runs never overlap and an older run can never finish after a
 * newer one. Errors go to `onError`; nothing runs after `close()`.
 * @param {() => Promise<void> | void} run
 * @param {{ delayMs?: number, onError: (error: unknown) => void }} options
 */
export function createRegenerationScheduler(run, { delayMs = 100, onError }) {
	let requested = false;
	let closed = false;
	/** @type {ReturnType<typeof setTimeout> | null} */
	let timer = null;
	/** @type {Promise<void> | null} */
	let draining = null;

	const drain = async () => {
		timer = null;
		while (requested && !closed) {
			requested = false;
			try {
				await run();
			} catch (error) {
				onError(error);
			}
		}
		draining = null;
	};

	return {
		/** Requests a run; it starts after `delayMs` unless one is already pending or running. */
		schedule() {
			if (closed) return;
			requested = true;
			if (timer || draining) return;
			timer = setTimeout(() => {
				draining = drain();
			}, delayMs);
		},
		/** Cancels pending runs; a run already in progress finishes. */
		close() {
			closed = true;
			if (timer) clearTimeout(timer);
			timer = null;
		},
	};
}
