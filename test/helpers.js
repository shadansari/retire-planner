import { readFileSync } from 'node:fs';
import { load as loadYaml, CORE_SCHEMA } from '../vendor/js-yaml.mjs';
import { parsePlanText } from '../js/data/load.js';

const EXAMPLE_PATH = new URL('../examples/example.yaml', import.meta.url);

export const exampleText = () => readFileSync(EXAMPLE_PATH, 'utf8');
export const exampleRaw = () => loadYaml(exampleText(), { schema: CORE_SCHEMA });

export function examplePlan() {
  const { errors, plan } = parsePlanText(exampleText());
  if (errors.length) throw new Error(`example.yaml invalid:\n${errors.join('\n')}`);
  return plan;
}
