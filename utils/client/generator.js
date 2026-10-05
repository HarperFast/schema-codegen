import fs from 'node:fs';

const { name, version } = JSON.parse(
	fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
);

/** This package's name and version, recorded in every IR and generated file header. */
export const GENERATOR = `${name}@${version}`;
