const assert = require('assert');
const {
  fillPlaceholders,
  hasRequiredFields,
  readTemplate,
} = require('../src/personalization/resolve-prompt');
const { getTypeDefinition } = require('../src/personalization/registry');

async function main() {
  const def = getTypeDefinition('realestate1');
  assert.ok(def, 'realestate1 type should be registered');

  const record = {
    listing_address: '100 Market St',
    listing_price: '$2M',
    listing_all_info: '3 bed 2 bath',
  };

  assert.ok(hasRequiredFields(record, def.requiredFields));

  const template = await readTemplate(def.templateFile);
  assert.ok(template, 'Template file should exist and be readable');

  const filled = fillPlaceholders(template, record, def.placeholders);
  assert.ok(filled.includes('100 Market St'));
  assert.ok(filled.includes('$2M'));
  assert.ok(filled.includes('3 bed 2 bath'));
  console.log('personalization prompt tests OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});