function render(company, config) {
  var title = config.title || 'What Our Clients Say';
  var items = config.items || [
    { quote: 'Amazing service! Highly recommend.', author: 'Jane D.', role: 'Client' },
    { quote: 'Professional, reliable, and exceeded our expectations.', author: 'Mark T.', role: 'Partner' },
    { quote: 'They delivered exactly what they promised, on time and on budget.', author: 'Sarah L.', role: 'Client' }
  ];

  var cards = items.map(function (item) {
    return '<div class="cmp-tst-card">' +
      '<blockquote>' + item.quote + '</blockquote>' +
      '<div class="cmp-tst-author"><strong>' + item.author + '</strong>' +
      (item.role ? '<span>' + item.role + '</span>' : '') +
      '</div></div>';
  }).join('');

  return '<section class="cmp-testimonials" style="background:' + company.brand_secondary_color + ';">' +
    '<div class="cmp-body">' +
    '<h2>' + title + '</h2>' +
    '<div class="cmp-tst-grid">' + cards + '</div>' +
    '</div></section>';
}

module.exports = { render: render };
