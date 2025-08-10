'use strict';

const Homey = require('homey');

class KEFConnectApp extends Homey.App {
  
  async onInit() {
    this.log('KEF Connect App has been initialized');
    
    // Register flow cards
    this.registerFlowCards();
  }
  
  registerFlowCards() {
    // Register the set_source flow action
    const setSourceAction = this.homey.flow.getActionCard('set_source');
    setSourceAction.registerRunListener(async (args, state) => {
      return args.device.setCapabilityValue('source_input', args.source);
    });
    
    // Register the source_changed trigger
    const sourceChangedTrigger = this.homey.flow.getDeviceTriggerCard('source_changed');
    // Trigger is fired from device when source changes
  }
}

module.exports = KEFConnectApp;