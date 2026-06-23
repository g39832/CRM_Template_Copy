function render(company, config) {
  var title = config.title || 'About Us';
  var content = config.content || company.description || 'We are a company dedicated to providing quality service to our clients.';

  return '<section class="cmp-about">' +
    '<div class="cmp-body">' +
    '<h2>' + title + '</h2>' +
    '<p>' + content + '</p>' +
    '</div></section>';
}

module.exports = { render: render };
