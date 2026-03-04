export function singularize(word: string): string {
	const lower = word.toLowerCase();

	// Nouns that are the same in singular and plural or should be treated as unchanged here
	const noChange = new Set([
		'moose',
		'series',
		'species',
		'sheep',
		'fish',
		'deer',
		'news',
		'chassis',
		'aircraft',
		'bison',
		'salmon',
		'trout',
		'swine',
		'media',
	]);
	if (noChange.has(lower)) {
		return word;
	}

	// Irregular plurals not covered by suffix rules
	const irregular: Record<string, string> = {
		people: 'person',
		men: 'man',
		women: 'woman',
		children: 'child',
		geese: 'goose',
		mice: 'mouse',
		teeth: 'tooth',
		feet: 'foot',
		oxen: 'ox',
		indices: 'index',
		matrices: 'matrix',
		vertices: 'vertex',
	};
	if (Object.prototype.hasOwnProperty.call(irregular, lower)) {
		const singular = irregular[lower];
		// Preserve capitalization of the first letter
		if (word[0] === word[0].toUpperCase()) {
			return singular.charAt(0).toUpperCase() + singular.slice(1);
		}
		return singular;
	}

	if (word.endsWith('ies')) {
		return word.slice(0, -3) + 'y';
	}
	if (word.endsWith('es')) {
		if (word.endsWith('xes') || word.endsWith('ses') || word.endsWith('ches') || word.endsWith('shes')) {
			return word.slice(0, -2);
		}
	}
	if (word.endsWith('s') && !word.endsWith('ss')) {
		return word.slice(0, -1);
	}
	return word;
}
