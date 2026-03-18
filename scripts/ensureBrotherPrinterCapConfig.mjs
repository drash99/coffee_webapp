import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const configPath = resolve('ios/App/App/capacitor.config.json');
const pluginClass = 'BrotherPrinterPlugin';

if (!existsSync(configPath)) {
  process.exit(0);
}

const raw = readFileSync(configPath, 'utf8');
const parsed = JSON.parse(raw);
const current = Array.isArray(parsed.packageClassList) ? parsed.packageClassList : [];

if (!current.includes(pluginClass)) {
  parsed.packageClassList = [...current, pluginClass].sort((a, b) => a.localeCompare(b));
  writeFileSync(configPath, `${JSON.stringify(parsed, null, '\t')}\n`);
}
