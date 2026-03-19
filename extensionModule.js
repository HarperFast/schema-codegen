/** @typedef {import('harperdb').Scope} Scope */
import { setTimeout as delay } from 'node:timers/promises';
import { setLogger } from './utils/logger.js';
import { regenerateAll } from './utils/regenerateAll.js';

export const suppressHandleApplicationWarning = true;

/**
 * @param {Scope} scope
 */
export async function handleApplication(scope) {
	setLogger(scope.logger);

	if (!process.env.DEV_MODE) {
		scope.logger.trace?.('@harperfast/schema-codegen skipping execution outside of dev mode');
		return;
	}

	const watchConfig = scope.options.get(['watch']);
	const shouldWatch = watchConfig === true || watchConfig === undefined;
	const globalTypes = /** @type {string} */ (scope.options.get(['globalTypes']));
	const schemaTypes = /** @type {string} */ (scope.options.get(['schemaTypes']));
	const jsdoc = /** @type {string | undefined} */ (scope.options.get(['jsdoc']));

	if (shouldWatch) {
		scope.on('close', scopeClosed);
	}

	// Do not await this.
	delay(5000).then(() => {
		// Initial generation
		regenerateAll(globalTypes, schemaTypes, jsdoc);

		if (shouldWatch) {
			// Watch for schema/database changes via events
			scope.databaseEvents.on('updateTable', updateTable);
			scope.databaseEvents.on('dropTable', dropTable);
			scope.databaseEvents.on('dropDatabase', dropDatabase);
		}
	});

	function updateTable() {
		regenerateAll(globalTypes, schemaTypes, jsdoc);
	}

	function dropTable() {
		regenerateAll(globalTypes, schemaTypes, jsdoc);
	}

	function dropDatabase() {
		regenerateAll(globalTypes, schemaTypes, jsdoc);
	}

	function scopeClosed() {
		scope.databaseEvents.off('updateTable', updateTable);
		scope.databaseEvents.off('dropTable', dropTable);
		scope.databaseEvents.off('dropDatabase', dropDatabase);
		scope.off('close', scopeClosed);
	}
}
