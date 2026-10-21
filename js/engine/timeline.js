// Calendar helpers. Months are integer indexes (year*12 + month-1); see parse.monthIndex.

import { monthIndex } from './parse.js';

// Month indexes of a calendar year, Jan..Dec.
export const monthsOf = (year) => Array.from({ length: 12 }, (_, m) => year * 12 + m);

// Inflation factor from the plan's start year ("today's dollars") to `year`.
export const growthFactor = (rate, year, fromYear) => (1 + rate) ** (year - fromYear);

// Age at end of calendar year (whole years).
export const ageAtYearEnd = (person, year) => year - person.birth.year;

// Age in whole years during month `mi` (birthday counted in the birth month).
export const ageInMonth = (person, mi) => Math.floor((mi - monthIndex(person.birth)) / 12);

// A person is modeled through the end of the year they reach life expectancy.
export const isAlive = (person, year) => year <= person.deathYear;
export const isAliveInMonth = (person, mi) => isAlive(person, Math.floor(mi / 12));

export const isRetiredInMonth = (person, mi) => mi >= monthIndex(person.retire);

// Number of months of `year` for which pred(mi) holds.
export const countMonths = (year, pred) => monthsOf(year).filter(pred).length;
