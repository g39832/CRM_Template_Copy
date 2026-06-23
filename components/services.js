function render(company, config) {
  var title = config.title || 'Our Services';
  var items = config.items || [
    { name: 'Service One', desc: 'Description of your first service offering.' },
    { name: 'Service Two', desc: 'Description of your second service offering.' },
    { name: 'Service Three', desc: 'Description of your third service offering.' }
  ];

  var cards = items.map(function (item) {
    return '<div class="cmp-svc-card"><h3>' + item.name + '</h3><p>' + item.desc + '</p></div>';
  }).join('');

  return '<section class="cmp-services">' +
    '<div class="cmp-body">' +
    '<h2>' + title + '</h2>' +
    '<div class="cmp-svc-grid">' + cards + '</div>' +
    '</div></section>';
}

module.exports = { render: render };
