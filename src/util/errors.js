'use strict';

class AppError extends Error {
  constructor(message, alert = false) {
    super(message);
    this.alert = alert;
  }
}

module.exports = { AppError };
