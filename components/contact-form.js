function render(company, config) {
  var title = config.title || 'Contact Us';
  var email = config.email || company.contact_email || 'mail@example.com';

  // POSTs to a formspree-style endpoint; for MVP the form action
  // uses a mailto fallback so it works without a dedicated handler.
  return '<section class="cmp-contact">' +
    '<div class="cmp-body">' +
    '<h2>' + title + '</h2>' +
    '<form class="cmp-cf-form" action="mailto:' + email + '" method="POST" enctype="text/plain">' +
    '<div class="cmp-cf-row"><input type="text" name="name" placeholder="Your Name" required></div>' +
    '<div class="cmp-cf-row"><input type="email" name="email" placeholder="Your Email" required></div>' +
    '<div class="cmp-cf-row"><textarea name="message" rows="4" placeholder="Your Message" required></textarea></div>' +
    '<div class="cmp-cf-row"><button type="submit" class="cmp-btn" style="background:' + company.brand_primary_color + ';">Send Message</button></div>' +
    '</form></div></section>';
}

module.exports = { render: render };
