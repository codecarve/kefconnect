'use strict';

import Homey from 'homey';

module.exports = class KEFConnectApp extends Homey.App {

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('KEF Connect app has been initialized');
  }

};
