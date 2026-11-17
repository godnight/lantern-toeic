'use strict';
// Compatibility name for legacy route/body tests. Registration, session cookies,
// password verification, identity lookup, routes and authorization are real H4
// product code. Only the existing local D1/SQLite and R2 adapters are reused.
// No platform header or synthetic owner is injected into a route.
module.exports = require('./product-auth-harness.cjs');
