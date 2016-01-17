'use strict';

module.exports = function(rest) {
  var app = rest.app;
  app.get('/api/raw', (req, res) => {
    console.log('in /api/raw: ', req.url, req.method);
    res.contentType('application/json');
    res.send(true).end();
  })
};