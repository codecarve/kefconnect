"use strict";
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod };
  };
Object.defineProperty(exports, "__esModule", { value: true });
const homey_1 = __importDefault(require("homey"));
module.exports = class KEFConnectApp extends homey_1.default.App {
  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log("KEF Connect app has been initialized");
    // Register flow cards
    this.registerFlowActions();
  }
  /**
   * Register flow action cards
   */
  registerFlowActions() {
    // Register the set_source flow action
    const setSourceAction = this.homey.flow.getActionCard("set_source");
    setSourceAction.registerRunListener(async (args) => {
      return args.device.setCapabilityValue("source_input", args.source);
    });
    // Register the source_changed trigger
    const sourceChangedTrigger =
      this.homey.flow.getDeviceTriggerCard("source_changed");
    // Trigger is fired from device when source changes
  }
};
