const path = require('path');

/**
 * Registered personalization types. Extend by adding a key + template + field map.
 */
const PERSONALIZATION_TYPES = {
  realestate1: {
    label: 'Real estate listing (demo)',
    templateFile: 'types/realestate1.md',
    requiredFields: ['listing_address', 'listing_price', 'listing_all_info'],
    placeholders: {
      Active_Listing2_Address_Deep: 'listing_address',
      Active_Listing2_Price_Deep: 'listing_price',
      Active_Listing2_All_Info: 'listing_all_info',
    },
  },
};

function getTypeDefinition(typeKey) {
  const key = String(typeKey || '').trim().toLowerCase();
  return PERSONALIZATION_TYPES[key] || null;
}

function listRegisteredTypes() {
  return Object.keys(PERSONALIZATION_TYPES);
}

module.exports = {
  PERSONALIZATION_TYPES,
  getTypeDefinition,
  listRegisteredTypes,
  promptsDir: path.resolve(__dirname, '..', '..', 'prompts'),
};