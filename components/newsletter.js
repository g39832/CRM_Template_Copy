function render(company, config) {
  var title = config.title || 'Stay Updated';
  var placeholder = config.placeholder || 'Enter your email';

  return '<section class="cmp-newsletter" style="background:' + company.brand_primary_color + ';">' +
    '<div class="cmp-body cmp-nl-body">' +
    '<h2>' + title + '</h2>' +
    '<form class="cmp-nl-form">' +
    '<input type="email" placeholder="' + placeholder + '" required>' +
    '<button type="submit" class="cmp-btn cmp-btn-light">Subscribe</button>' +
    '</form></div></section>';
}

module.exports = { render: render };
