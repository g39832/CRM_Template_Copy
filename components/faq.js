function render(company, config) {
  var title = config.title || 'Frequently Asked Questions';
  var items = config.items || [
    { q: 'What areas do you serve?', a: 'We serve clients across the region. Contact us for details.' },
    { q: 'How can I get a quote?', a: 'Fill out our contact form and we will respond within 24 hours.' },
    { q: 'What payment methods do you accept?', a: 'We accept all major credit cards, bank transfers, and checks.' }
  ];

  var faqs = items.map(function (item, i) {
    return '<details class="cmp-faq-item">' +
      '<summary>' + item.q + '</summary>' +
      '<p>' + item.a + '</p></details>';
  }).join('');

  return '<section class="cmp-faq">' +
    '<div class="cmp-body">' +
    '<h2>' + title + '</h2>' +
    faqs +
    '</div></section>';
}

module.exports = { render: render };
