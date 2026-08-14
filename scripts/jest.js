const fs = require('fs');
const path = require('path');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  const contents = fs.readFileSync(filePath, 'utf8');

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const equalsIndex = trimmed.indexOf('=');

    if (equalsIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  return true;
}

const projectRoot = path.resolve(__dirname, '..');
const localEnvPath = path.join(projectRoot, '.env');
const exampleEnvPath = path.join(projectRoot, '.env.example');

loadEnvFile(localEnvPath);

if (!process.env.DATABASE_URL || !process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
  loadEnvFile(exampleEnvPath);
}

require('jest/bin/jest');