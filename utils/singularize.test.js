import { describe, expect, it } from 'vitest';
import { singularize } from './singularize.js';

describe('singularize', () => {
	it('should return the same word for nouns that do not change', () => {
		expect(singularize('moose')).toBe('moose');
		expect(singularize('series')).toBe('series');
		expect(singularize('news')).toBe('news');
	});

	it('should handle irregular plurals', () => {
		expect(singularize('people')).toBe('person');
		expect(singularize('men')).toBe('man');
		expect(singularize('children')).toBe('child');
		expect(singularize('indices')).toBe('index');
	});

	it('should preserve capitalization for irregular plurals', () => {
		expect(singularize('People')).toBe('Person');
		expect(singularize('Men')).toBe('Man');
	});

	it('should handle words ending in "ies"', () => {
		expect(singularize('categories')).toBe('category');
		expect(singularize('cities')).toBe('city');
	});

	it('should handle words ending in "es"', () => {
		expect(singularize('boxes')).toBe('box');
		expect(singularize('buses')).toBe('bus');
		expect(singularize('churches')).toBe('church');
		expect(singularize('wishes')).toBe('wish');
	});

	it('should handle standard plurals ending in "s"', () => {
		expect(singularize('users')).toBe('user');
		expect(singularize('tables')).toBe('table');
		expect(singularize('attributes')).toBe('attribute');
	});

	it('should not singularize words ending in "ss"', () => {
		expect(singularize('glass')).toBe('glass');
		expect(singularize('class')).toBe('class');
	});

	it('should return the same word if it is already singular', () => {
		expect(singularize('user')).toBe('user');
		expect(singularize('box')).toBe('box');
	});
});
