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
	let running = false;
	/** @type {ReturnType<typeof setTimeout> | null} */
	let timer = null;

	const drain = async () => {
		timer = null;
		running = true;
		try {
			while (requested && !closed) {
				requested = false;
				try {
					await run();
				} catch (error) {
					onError(error);
				}
			}
		} finally {
			running = false;
		}
	};

	return {
		schedule() {
			if (closed) return;
			requested = true;
			if (timer || running) return;
			timer = setTimeout(drain, delayMs);
		},
		/** A run already in progress is not interrupted. */
		close() {
			closed = true;
			if (timer) clearTimeout(timer);
			timer = null;
		},
	};
}
