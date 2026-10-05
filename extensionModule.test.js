import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const regenerateAll = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('./utils/regenerateAll.js', async (importOriginal) => ({
	.../** @type {object} */ (await importOriginal()),
	regenerateAll,
}));

const { handleApplication } = await import('./extensionModule.js');

/**
 * @param {Record<string, unknown>} options
 */
function fakeScope(options) {
	const scope = Object.assign(new EventEmitter(), {
		logger: { trace: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
		options: { get: (/** @type {string[]} */ [key]) => options[key] },
		databaseEvents: new EventEmitter(),
		directory: '/apps/demo',
		resources: { allTypes: new Map() },
		handleEntry: vi.fn(),
	});
	return scope;
}

describe('handleApplication', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		process.env.DEV_MODE = 'true';
	});
	afterEach(() => {
		vi.useRealTimers();
		delete process.env.DEV_MODE;
		vi.clearAllMocks();
	});

	it('does nothing outside dev mode', async () => {
		delete process.env.DEV_MODE;
		const scope = fakeScope({ schemaTypes: 'types.ts' });
		await handleApplication(/** @type {any} */ (scope));
		await vi.advanceTimersByTimeAsync(10_000);
		expect(regenerateAll).not.toHaveBeenCalled();
	});

	it('generates after the initial delay, resolving outputs against the app directory', async () => {
		const scope = fakeScope({
			schemaTypes: 'types.ts',
			swift: 'ios/HarperModels',
			swiftModule: 'Demo',
		});
		await handleApplication(/** @type {any} */ (scope));
		await vi.advanceTimersByTimeAsync(4_999);
		expect(regenerateAll).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(200);
		expect(regenerateAll).toHaveBeenCalledTimes(1);
		const [, schemaTypes, , options] = regenerateAll.mock.calls[0];
		expect(schemaTypes).toBe('types.ts');
		expect(options).toMatchObject({
			baseDirectory: '/apps/demo',
			client: { swift: 'ios/HarperModels', swiftModule: 'Demo', types: scope.resources.allTypes },
		});
	});

	it('reads the type registry on every run', async () => {
		const scope = fakeScope({ schemaTypes: 'types.ts', schemaIR: 'ir.json' });
		await handleApplication(/** @type {any} */ (scope));
		await vi.advanceTimersByTimeAsync(5_200);
		const replaced = new Map([['Address', { attributes: [] }]]);
		scope.resources.allTypes = replaced;
		scope.databaseEvents.emit('updateTable');
		await vi.advanceTimersByTimeAsync(200);
		expect(regenerateAll.mock.calls.at(-1)?.[3]).toMatchObject({ client: { types: replaced } });
	});

	it('aborts a run still in flight when the scope closes', async () => {
		const scope = fakeScope({ schemaTypes: 'types.ts', schemaIR: 'ir.json' });
		await handleApplication(/** @type {any} */ (scope));
		await vi.advanceTimersByTimeAsync(5_200);
		const { signal } = /** @type {any} */ (regenerateAll.mock.calls[0][3]).client;
		expect(signal.aborted).toBe(false);
		scope.emit('close');
		expect(signal.aborted).toBe(true);
	});

	it('coalesces a burst of schema events into one regeneration', async () => {
		const scope = fakeScope({ schemaTypes: 'types.ts' });
		await handleApplication(/** @type {any} */ (scope));
		await vi.advanceTimersByTimeAsync(5_200);
		regenerateAll.mockClear();
		for (let i = 0; i < 5; i++) scope.databaseEvents.emit('updateTable');
		scope.databaseEvents.emit('dropTable');
		await vi.advanceTimersByTimeAsync(200);
		expect(regenerateAll).toHaveBeenCalledTimes(1);
	});

	it('installs nothing when the scope closes before the initial delay', async () => {
		const scope = fakeScope({ schemaTypes: 'types.ts' });
		await handleApplication(/** @type {any} */ (scope));
		scope.emit('close');
		await vi.advanceTimersByTimeAsync(10_000);
		expect(regenerateAll).not.toHaveBeenCalled();
		expect(scope.databaseEvents.listenerCount('updateTable')).toBe(0);
	});

	it('stops listening when the scope closes', async () => {
		const scope = fakeScope({ schemaTypes: 'types.ts' });
		await handleApplication(/** @type {any} */ (scope));
		await vi.advanceTimersByTimeAsync(5_200);
		scope.emit('close');
		regenerateAll.mockClear();
		scope.databaseEvents.emit('updateTable');
		await vi.advanceTimersByTimeAsync(1_000);
		expect(regenerateAll).not.toHaveBeenCalled();
		expect(scope.databaseEvents.listenerCount('updateTable')).toBe(0);
	});

	it('logs a failed regeneration instead of throwing into Harper', async () => {
		regenerateAll.mockRejectedValueOnce(new Error('disk full'));
		const scope = fakeScope({ schemaTypes: 'types.ts' });
		await handleApplication(/** @type {any} */ (scope));
		await vi.advanceTimersByTimeAsync(5_200);
		expect(scope.logger.error).toHaveBeenCalledWith(expect.stringContaining('disk full'));
	});

	it('watches sync.yaml only when a client output is configured', async () => {
		const withClient = fakeScope({ syncProfiles: 'sync.yaml', kotlin: 'android' });
		await handleApplication(/** @type {any} */ (withClient));
		expect(withClient.handleEntry).toHaveBeenCalledWith(
			{ files: 'sync.yaml' },
			expect.any(Function),
		);

		const profilesOnly = fakeScope({ syncProfiles: 'sync.yaml' });
		await handleApplication(/** @type {any} */ (profilesOnly));
		expect(profilesOnly.handleEntry).not.toHaveBeenCalled();
	});

	it('regenerates on sync.yaml changes once started', async () => {
		const scope = fakeScope({ syncProfiles: 'sync.yaml', schemaIR: 'ir.json' });
		await handleApplication(/** @type {any} */ (scope));
		const onEntry = scope.handleEntry.mock.calls[0][1];
		onEntry({ eventType: 'add' });
		await vi.advanceTimersByTimeAsync(1_000);
		expect(regenerateAll).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(4_200);
		regenerateAll.mockClear();
		onEntry({ eventType: 'change' });
		await vi.advanceTimersByTimeAsync(200);
		expect(regenerateAll).toHaveBeenCalledTimes(1);
	});
});
