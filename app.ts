'use strict';

import Homey from 'homey';
import { KEFSource } from './lib/KEFSpeaker';

module.exports = class KEFConnectApp extends Homey.App {
  private deviceRegistry: Map<string, any> = new Map();

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('[App] KEF Connect has been initialized');

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
      usb: "USB"
    };
    return labels[source] || source;
  }

  /**
   * Register flow action cards
   */
  registerFlowActions() {
    // Register the set_source flow action
    this.log('[App] Registering flow action: set_source');
    const setSourceAction = this.homey.flow.getActionCard('set_source');
    setSourceAction.registerRunListener(async (args: any) => {
      this.log(`[Flow] Setting source to ${args.source.id} for device ${args.device.getName()}`);
      try {
        // Call the capability handler directly to actually change the source
        await args.device.onCapabilitySource(args.source.id);
        // Also update the capability value to reflect the change
        await args.device.setCapabilityValue('source_input', args.source.id);
        return true;
      } catch (error: any) {
        this.error(`[Flow] Failed to set source: ${error.message}`);
        // Provide a user-friendly error message
        if (error.message && error.message.includes('not supported')) {
          const sourceLabel = this.getSourceLabel(args.source.id);
          throw new Error(this.homey.__('errors.source_not_supported').replace('__source__', sourceLabel));
        }
        // Generic error message for other failures
        throw new Error(this.homey.__('errors.source_change_failed'));
      }
    });

    // Register autocomplete for source selection based on device model
    setSourceAction.registerArgumentAutocompleteListener('source', async (query: string, args: any) => {
      // Get the available sources for this specific device
      const device = args.device;
      if (!device) return [];

      // Get sources from device's model configuration
      const sources = device.modelConfig?.sources || [];

      // Map sources to autocomplete format with translations
      const sourceOptions = sources.map((source: KEFSource) => ({
        id: source,
        name: this.getSourceLabel(source)
      }));

      // Filter by query if provided
      if (query) {
        return sourceOptions.filter((option: any) =>
          option.name.toLowerCase().includes(query.toLowerCase())
        );
      }

      return sourceOptions;
    });

    // Register play/pause flow action
    this.log('[App] Registering flow action: play_pause');
    const playPauseAction = this.homey.flow.getActionCard('play_pause');
    playPauseAction.registerRunListener(async (args: any) => {
      this.log(`[Flow] Toggling play/pause for device ${args.device.getName()}`);

      // Check if the current source supports playback control (only WiFi and Bluetooth support it)
      const currentSource = await args.device.getCurrentSource();
      if (currentSource !== 'wifi' && currentSource !== 'bluetooth') {
        const sourceLabel = this.getSourceLabel(currentSource);
        throw new Error(this.homey.__('errors.playback_control_not_supported_on_source').replace('__source__', sourceLabel));
      }

      try {
        await args.device.playPause();
        return true;
      } catch (error: any) {
        // If the API returns "Operation not supported", provide a helpful message
        if (error.message && error.message.toLowerCase().includes('operation not supported')) {
          throw new Error(this.homey.__('errors.operation_not_supported'));
        }
        // Re-throw other errors
        throw error;
      }
    });

    // Register next track flow action
    this.log('[App] Registering flow action: next_track');
    const nextTrackAction = this.homey.flow.getActionCard('next_track');
    nextTrackAction.registerRunListener(async (args: any) => {
      this.log(`[Flow] Skipping to next track for device ${args.device.getName()}`);

      // Check if the current source supports track control (only WiFi and Bluetooth support it)
      const currentSource = await args.device.getCurrentSource();
      if (currentSource !== 'wifi' && currentSource !== 'bluetooth') {
        const sourceLabel = this.getSourceLabel(currentSource);
        throw new Error(this.homey.__('errors.track_control_not_supported_on_source').replace('__source__', sourceLabel));
      }

      try {
        await args.device.nextTrack();
        return true;
      } catch (error: any) {
        // If the API returns "Operation not supported", provide a helpful message
        if (error.message && error.message.toLowerCase().includes('operation not supported')) {
          throw new Error(this.homey.__('errors.operation_not_supported'));
        }
        // Re-throw other errors
        throw error;
      }
    });

    // Register previous track flow action
    this.log('[App] Registering flow action: previous_track');
    const previousTrackAction = this.homey.flow.getActionCard('previous_track');
    previousTrackAction.registerRunListener(async (args: any) => {
      this.log(`[Flow] Skipping to previous track for device ${args.device.getName()}`);

      // Check if the current source supports track control (only WiFi and Bluetooth support it)
      const currentSource = await args.device.getCurrentSource();
      if (currentSource !== 'wifi' && currentSource !== 'bluetooth') {
        const sourceLabel = this.getSourceLabel(currentSource);
        throw new Error(this.homey.__('errors.track_control_not_supported_on_source').replace('__source__', sourceLabel));
      }

      try {
        await args.device.previousTrack();
        return true;
      } catch (error: any) {
        // If the API returns "Operation not supported", provide a helpful message
        if (error.message && error.message.toLowerCase().includes('operation not supported')) {
          throw new Error(this.homey.__('errors.operation_not_supported'));
        }
        // Re-throw other errors
        throw error;
      }
    });

    // Register volume up flow action
    this.log('[App] Registering flow action: volume_up');
    const volumeUpAction = this.homey.flow.getActionCard('volume_up');
    volumeUpAction.registerRunListener(async (args: any) => {
      this.log(`[Flow] Increasing volume for device ${args.device.getName()}`);
      try {
        await args.device.volumeUp();
        return true;
      } catch (error: any) {
        this.error(`[Flow] Failed to increase volume: ${error.message}`);
        throw new Error(this.homey.__('errors.volume_control_failed'));
      }
    });

    // Register volume down flow action
    this.log('[App] Registering flow action: volume_down');
    const volumeDownAction = this.homey.flow.getActionCard('volume_down');
    volumeDownAction.registerRunListener(async (args: any) => {
      this.log(`[Flow] Decreasing volume for device ${args.device.getName()}`);
      try {
        await args.device.volumeDown();
        return true;
      } catch (error: any) {
        this.error(`[Flow] Failed to decrease volume: ${error.message}`);
        throw new Error(this.homey.__('errors.volume_control_failed'));
      }
    });

  }

};
