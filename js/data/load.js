// YAML text → validated, normalized plan. Shared by the browser and the tests.

import { load as loadYaml, CORE_SCHEMA } from '../../vendor/js-yaml.mjs';
import { validatePlan } from '../engine/validate.js';

// → { errors, warnings, plan }
export function parsePlanText(text) {
  let raw;
  try {
    // CORE_SCHEMA: no timestamp type, so dates stay strings for our own parser.
    raw = loadYaml(text, { schema: CORE_SCHEMA });
  } catch (e) {
    const line = e.mark ? ` on line ${e.mark.line + 1}` : '';
    const reason = e.reason || e.message;
    const snippet = e.mark?.snippet ? `\n${e.mark.snippet}` : '';
    return {
      errors: [`The file couldn't be read${line}: ${reason}. Check indentation (spaces, not tabs) and that each "key: value" has a space after the colon.${snippet}`],
      warnings: [],
      plan: null,
    };
  }
  return validatePlan(raw);
}
