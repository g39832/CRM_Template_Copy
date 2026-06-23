function render(company, config) {
  var title = config.title || 'Our Work';
  var images = config.images || [];

  var grid;
  if (images.length === 0) {
    // Show placeholder thumbnails when no images have been uploaded yet
    var placeholders = [];
    for (var i = 0; i < 4; i++) {
      placeholders.push(
        '<div class="cmp-gal-item" style="background:' + company.brand_primary_color + '20; border:2px dashed ' + company.brand_primary_color + '40; min-height:140px; display:flex; align-items:center; justify-content:center; border-radius:8px; color:' + company.brand_primary_color + '60; font-size:0.85rem;">Photo ' + (i + 1) + '</div>'
      );
    }
    grid = placeholders.join('');
  } else {
    grid = images.map(function (img) {
      return '<div class="cmp-gal-item"><img src="' + img.url + '" alt="' + (img.alt || 'Gallery image') + '" loading="lazy"></div>';
    }).join('');
  }

  return '<section class="cmp-gallery">' +
    '<div class="cmp-body">' +
    '<h2>' + title + '</h2>' +
    '<div class="cmp-gal-grid">' + grid + '</div>' +
    '</div></section>';
}

module.exports = { render: render };
