const assert = require('assert');
const { fillPlaceholders, hasRequiredFields } = require('../src/personalization/resolve-prompt');
const { getTypeDefinition } = require('../src/personalization/registry');

const def = getTypeDefinition('realestate1');
assert.ok(def, 'realestate1 type should be registered');

const record = {
  listing_address: '100 Market St',
  listing_price: '$2M',
  listing_all_info: '3 bed 2 bath',
};

assert.ok(hasRequiredFields(record, def.requiredFields));

const template = 'Property at {{Active_Listing2_Address_Deep}} for {{Active_Listing2_Price_Deep}}.';
const filled = fillPlaceholders(template, record, def.placeholders);
assert.ok(filled.includes('100 Market St'));
assert.ok(filled.includes('$2M'));
console.log('personalization prompt tests OK');