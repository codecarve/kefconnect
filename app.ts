"use strict";

import Homey from "homey";
import { KEFSource } from "./lib/KEFSpeaker";

module.exports = class KEFConnectApp extends Homey.App {
  private deviceRegistry: Map<string, any> = new Map();

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log("[App] KEF Connect has been initialized");

    // Register flow cards
    this.registerFlowActions();
  }

  /**
   * Register a device in the app's device registry
   */
  registerDevice(deviceId: string, device: any) {
    this.deviceRegistry.set(deviceId, device);
    this.log(`[App] Device registered: ${deviceId}`);
    this.log(`[App] Registry now has ${this.deviceRegistry.size} devices`);
  }

  /**
   * Unregister a device from the app's device registry
   */
  unregisterDevice(deviceId: string) {
    this.deviceRegistry.delete(deviceId);
    this.log(`[App] Device unregistered: ${deviceId}`);
  }

  /**
   * Get a device from the registry by ID
   */
  getDevice(deviceId: string): any {
    return this.deviceRegistry.get(deviceId);
  }

  /**
   * Get localized source label
   */
  getSourceLabel(source: KEFSource): string {
    const labels: Record<string, string> = {
      wifi: "WiFi",
      bluetooth: "Bluetooth",
      optical: "Optical",
      coaxial: "Coaxial",
      analog: "Analog",
      tv: "TV",
      usb: "USB",
    };
    return labels[source] || source;
  }

  /**
   * Register flow action cards
   */
  registerFlowActions() {
    // Register the set_source flow action
    this.log("[App] Registering flow action: set_source");
    const setSourceAction = this.homey.flow.getActionCard("set_source");
    setSourceAction.registerRunListener(async (args: any) => {
      this.log(
        `[Flow] Setting source to ${args.source.id} for device ${args.device.getName()}`,
      );
      try {
        // Call the capability handler directly to actually change the source
        await args.device.onCapabilitySource(args.source.id);
        // Also update the capability value to reflect the change
        await args.device.setCapabilityValue("source_input", args.source.id);
        return true;
      } catch (error: any) {
        this.error(`[Flow] Failed to set source: ${error.message}`);
        // Provide a user-friendly error message
        if (error.message && error.message.includes("not supported")) {
          const sourceLabel = this.getSourceLabel(args.source.id);
          throw new Error(
            this.homey
              .__("errors.source_not_supported")
              .replace("__source__", sourceLabel),
          );
        }
        // Generic error message for other failures
        throw new Error(this.homey.__("errors.source_change_failed"));
      }
    });

    // Register autocomplete for source selection based on device model
    setSourceAction.registerArgumentAutocompleteListener(
      "source",
      async (query: string, args: any) => {
        // Get the available sources for this specific device
        const device = args.device;
        if (!device) return [];

        // Get sources from device's model configuration
        const sources = device.modelConfig?.sources || [];

        // Map sources to autocomplete format with translations
        const sourceOptions = sources.map((source: KEFSource) => ({
          id: source,
          name: this.getSourceLabel(source),
        }));

        // Filter by query if provided
        if (query) {
          return sourceOptions.filter((option: any) =>
            option.name.toLowerCase().includes(query.toLowerCase()),
          );
        }

        return sourceOptions;
      },
    );
  }
};
