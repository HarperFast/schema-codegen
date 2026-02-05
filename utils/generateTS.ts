import { parse, Source } from 'graphql';
import { generateInterface } from './generateInterface.ts';
import { singularize } from './singularize.ts';

export function generateTS(graphqlContent: string | Source, fileName: string) {
	try {
		const ast = parse(graphqlContent);
		let tsCode = `/**
 Generated from ${fileName}
 Manual changes will be lost!
 > npm run generate
 */`;
		const tables = [];

		for (const definition of ast.definitions) {
			if (definition.kind === 'ObjectTypeDefinition') {
				tsCode += generateInterface(definition);
				if (definition.directives && definition.directives.some(d => d.name.value === 'table')) {
					tables.push({
						plural: definition.name.value,
						singular: singularize(definition.name.value),
					});
				}
			}
		}

		return { tsCode, tables };
	} catch (e) {
		return { tsCode: `// Error parsing GraphQL: ${e}\nexport {};`, tables: [] };
	}
}
