function render(company, config) {
  var headline = config.headline || company.name || 'Your Company';
  var subtext = config.subtext || company.tagline || '';
  var ctaText = config.cta_text || 'Get Started';
  var ctaLink = config.cta_link || '#contact';

  return '<section class="cmp-hero" style="background:' + company.brand_primary_color + ';">' +
    '<div class="cmp-hero-body">' +
    '<h1>' + headline + '</h1>' +
    (subtext ? '<p class="cmp-hero-sub">' + subtext + '</p>' : '') +
    '<a href="' + ctaLink + '" class="cmp-btn cmp-btn-light">' + ctaText + '</a>' +
    '</div></section>';
}

module.exports = { render: render };
