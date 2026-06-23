var path = require('path');
var fs = require('fs');

// Discover all .js files in this directory except this index file
var files = fs.readdirSync(__dirname).filter(function (f) {
  return f.endsWith('.js') && f !== 'index.js';
});

var registry = {};

files.forEach(function (file) {
  var type = path.basename(file, '.js');
  registry[type] = require('./' + file);
});

// ----- Default feature presets -----
// Used when seeding a new company's feature list for the first time.
var DEFAULT_FEATURES = [
  // Public site components (always available)
  { component_type: 'hero',        is_active: true,  display_order: 1, config: {} },
  { component_type: 'about',       is_active: true,  display_order: 2, config: {} },
  { component_type: 'services',    is_active: true,  display_order: 3, config: {} },
  { component_type: 'testimonials',is_active: true,  display_order: 4, config: {} },
  { component_type: 'contact-form',is_active: true,  display_order: 5, config: {} },
  { component_type: 'faq',         is_active: true,  display_order: 6, config: {} },
  { component_type: 'gallery',     is_active: false, display_order: 7, config: {} },
  { component_type: 'newsletter',  is_active: false, display_order: 8, config: {} },
  // CRM platform features (togglable)
  { component_type: 'advanced-filtering',  is_active: true,  display_order: 9,  config: {} },
  { component_type: 'client-portal',       is_active: false, display_order: 10, config: {} },
  { component_type: 'email-templates',     is_active: true,  display_order: 11, config: {} },
  { component_type: 'multi-currency',      is_active: false, display_order: 12, config: {} },
  { component_type: 'recurring-invoices',  is_active: true,  display_order: 13, config: {} },
  { component_type: 'export-reporting',    is_active: true,  display_order: 14, config: {} },
  { component_type: 'role-based-access',   is_active: true,  display_order: 15, config: {} },
  { component_type: 'activity-log',        is_active: true,  display_order: 16, config: {} }
];

function getAvailableTypes() {
  return Object.keys(registry);
}

function renderComponent(type, company, config) {
  var renderer = registry[type];
  if (!renderer) return '';
  return renderer.render(company, config || {});
}

module.exports = {
  registry: registry,
  DEFAULT_FEATURES: DEFAULT_FEATURES,
  getAvailableTypes: getAvailableTypes,
  renderComponent: renderComponent
};
