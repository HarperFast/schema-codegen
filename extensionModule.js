/** @typedef {import('harperdb').Scope} Scope */
import { createRegenerationScheduler } from './utils/createRegenerationScheduler.js';
import { setLogger } from './utils/logger.js';
import { hasClientOutputs, regenerateAll } from './utils/regenerateAll.js';

export const suppressHandleApplicationWarning = true;

const INITIAL_DELAY_MS = 5000;

/**
 * @param {Scope} scope
 */
export async function handleApplication(scope) {
	setLogger(scope.logger);

	if (!process.env.DEV_MODE) {
		scope.logger.trace?.('@harperfast/schema-codegen skipping execution outside of dev mode');
		return;
	}

	/**
	 * @param {string} key
	 * @returns {any}
	 */
	const option = (key) => scope.options.get([key]);
	const watchConfig = option('watch');
	const shouldWatch = watchConfig === true || watchConfig === undefined;
	const globalTypes = /** @type {string} */ (option('globalTypes'));
	const schemaTypes = /** @type {string} */ (option('schemaTypes'));
	const jsdoc = /** @type {string | undefined} */ (option('jsdoc'));
	const client = {
		schemaIR: /** @type {string | undefined} */ (option('schemaIR')),
		syncProfiles: /** @type {string | undefined} */ (option('syncProfiles')),
		swift: /** @type {string | undefined} */ (option('swift')),
		swiftModule: /** @type {string | undefined} */ (option('swiftModule')),
		kotlin: /** @type {string | undefined} */ (option('kotlin')),
		kotlinPackage: /** @type {string | undefined} */ (option('kotlinPackage')),
	};
	const options = {
		module: /** @type {string | undefined} */ (option('module')),
		includeDatabases: /** @type {string[] | undefined} */ (option('includeDatabases')),
		excludeDatabases: /** @type {string[] | undefined} */ (option('excludeDatabases')),
		baseDirectory: /** @type {any} */ (scope).directory,
	};
	const closing = new AbortController();

	const scheduler = createRegenerationScheduler(
		() =>
			regenerateAll(globalTypes, schemaTypes, jsdoc, {
				...options,
				client: {
					...client,
					types: /** @type {any} */ (scope).resources?.allTypes,
					signal: closing.signal,
				},
			}),
		{
			onError: (error) =>
				scope.logger.error?.(
					`@harperfast/schema-codegen failed to regenerate: ${/** @type {Error} */ (error)?.stack ?? error}`,
				),
		},
	);
	const schedule = () => scheduler.schedule();
	let started = false;
	const initialTimer = setTimeout(() => {
		started = true;
		scheduler.schedule();
		if (shouldWatch) {
			scope.databaseEvents.on('updateTable', schedule);
			scope.databaseEvents.on('dropTable', schedule);
			scope.databaseEvents.on('dropDatabase', schedule);
		}
	}, INITIAL_DELAY_MS);

	if (shouldWatch && client.syncProfiles && hasClientOutputs(client)) {
		try {
			/** @type {any} */ (scope).handleEntry({ files: client.syncProfiles }, () => {
				if (started) scheduler.schedule();
			});
		} catch (error) {
			scope.logger.warn?.(
				`@harperfast/schema-codegen cannot watch ${client.syncProfiles}; edits apply on the next schema change: ${/** @type {Error} */ (error)?.message}`,
			);
		}
	}

	scope.on('close', scopeClosed);

	function scopeClosed() {
		clearTimeout(initialTimer);
		closing.abort();
		scheduler.close();
		scope.databaseEvents.off('updateTable', schedule);
		scope.databaseEvents.off('dropTable', schedule);
		scope.databaseEvents.off('dropDatabase', schedule);
		scope.off('close', scopeClosed);
	}
}
