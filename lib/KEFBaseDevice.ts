import Homey from "homey";
import { KEFSpeaker, KEFSettings } from "./KEFSpeaker";
import { getModelConfig, isSourceSupported, getAvailableSources } from "./KEFModels";

export class KEFBaseDevice extends Homey.Device {
  protected speaker!: KEFSpeaker;
  protected pollInterval?: NodeJS.Timeout;
  protected isAvailable: boolean = false;
  protected reconnectTimer?: NodeJS.Timeout;
  protected reconnectAttempts: number = 0;
  protected maxReconnectAttempts: number = 10;
  protected modelId: string = "auto-detect";
  protected modelConfig: any;

  async onInit() {
    this.log("KEF Speaker Device initialized");

    // Get model from device data or settings
    const data = this.getData();
    const settings = this.getSettings();
    const store = this.getStore();
    
    // Override modelId in child classes
    this.modelId = this.getModelId();
    this.modelConfig = getModelConfig(this.modelId);
    
    this.log(`Device model: ${this.modelId}`);
    this.log(`Supported sources: ${this.modelConfig.sources.join(", ")}`);
    
    // Set energy consumption based on model
    if (this.modelConfig.energyUsage) {
      try {
        await this.setEnergy(this.modelConfig.energyUsage);
        this.log(`Set energy usage - On: ${this.modelConfig.energyUsage.usageOn}W, Off: ${this.modelConfig.energyUsage.usageOff}W`);
      } catch (error) {
        this.log('Could not set energy usage:', error);
      }
    }

    // Initialize speaker connection
    this.speaker = new KEFSpeaker(settings.ip, settings.port || 80, (msg: string) => this.log(msg));

    // Setup capabilities based on model
    await this.setupCapabilities();

    // Register capability listeners (before connection attempt)
    this.registerCapabilities();

    // Try initial connection but don't fail if it doesn't work
    try {
      await this.initializeConnection();
    } catch (error) {
      this.log('Device is offline, will check for availability via polling');
      // Mark as unavailable but continue
      this.isAvailable = false;
      await this.setUnavailable("Device is not responding. Will retry connection automatically.").catch(this.error);
    }

    // Always start polling - it will handle availability
    this.startPolling();
  }

  // Override this in child classes to return the specific model ID
  protected getModelId(): string {
    return "auto-detect";
  }

  private async setupCapabilities() {
    // Get capabilities supported by this specific model
    const supportedCapabilities = this.modelConfig.capabilities;
    const currentCapabilities = this.getCapabilities();
    
    // Log current capabilities for debugging
    this.log(`Current capabilities: ${currentCapabilities.join(', ')}`);
    this.log(`Model ${this.modelId} supports: ${supportedCapabilities.join(', ')}`);
    
    // Add missing capabilities that the model supports
    for (const capability of supportedCapabilities) {
      if (!this.hasCapability(capability)) {
        try {
          await this.addCapability(capability);
          this.log(`Added capability: ${capability}`);
        } catch (error: any) {
          this.error(`Failed to add capability ${capability}:`, error);
        }
      }
    }
    
    // Remove capabilities that the model doesn't support (except core ones)
    const coreCapabilities = ['onoff', 'volume_set', 'volume_mute', 'source_input'];
    for (const capability of currentCapabilities) {
      if (!supportedCapabilities.includes(capability) && !coreCapabilities.includes(capability)) {
        try {
          await this.removeCapability(capability);
          this.log(`Removed unsupported capability: ${capability}`);
        } catch (error) {
          this.error(`Failed to remove capability ${capability}:`, error);
        }
      }
    }
    
    // Update source_input capability options based on model
    if (this.hasCapability('source_input')) {
      try {
        const supportedSources = this.modelConfig.sources;
        const sourceOptions = supportedSources.map((source: string) => ({
          id: source,
          title: this.getSourceTitle(source)
        }));
        
        await this.setCapabilityOptions('source_input', {
          values: sourceOptions
        });
        
        this.log(`Updated source_input options to: ${supportedSources.join(', ')}`);
      } catch (error) {
        this.error('Failed to update source_input options:', error);
      }
    }
  }
  
  private getSourceTitle(source: string): any {
    // Return localized titles for each source
    const titles: Record<string, any> = {
      wifi: { en: "WiFi", nl: "WiFi", fr: "WiFi", de: "WiFi", es: "WiFi" },
      bluetooth: { en: "Bluetooth", nl: "Bluetooth", fr: "Bluetooth", de: "Bluetooth", es: "Bluetooth" },
      optical: { en: "Optical", nl: "Optisch", fr: "Optique", de: "Optisch", es: "Óptico" },
      coaxial: { en: "Coaxial", nl: "Coaxiaal", fr: "Coaxial", de: "Koaxial", es: "Coaxial" },
      analog: { en: "Analog", nl: "Analoog", fr: "Analogique", de: "Analog", es: "Analógico" },
      tv: { en: "TV", nl: "TV", fr: "TV", de: "TV", es: "TV" },
      usb: { en: "USB", nl: "USB", fr: "USB", de: "USB", es: "USB" }
    };
    
    return titles[source] || { en: source };
  }

  private async initializeConnection(skipSettingsUpdate: boolean = false) {
    try {
      const connected = await this.speaker.testConnection();
      if (connected) {
        this.log("Successfully connected to KEF speaker");
        this.isAvailable = true;
        this.reconnectAttempts = 0;
        await this.setAvailable();

        // Get fresh speaker info
        const info = await this.speaker.getSpeakerInfo();
        this.log(`Connected to ${info.model} - ${info.name} at ${info.ip}`);

        // Store the fresh device info in Homey settings only if not called from onSettings
        if (!skipSettingsUpdate) {
          try {
            await this.setSettings({
              speaker_name: info.name,
              speaker_model: info.model,
              firmware_version: info.firmware || 'Unknown',
              serial_number: info.serialNumber || 'Unknown',
              last_connected: new Date().toISOString()
            });
            this.log("Updated device info in Homey settings");
          } catch (settingsError) {
            this.error("Failed to update device settings:", settingsError);
            // Don't fail the connection if settings update fails
          }
        }

        // Update initial states
        await this.updateDeviceState();
      } else {
        throw new Error("Connection test failed");
      }
    } catch (error: any) {
      this.log("Device is not reachable at", this.getSettings().ip);
      this.isAvailable = false;
      await this.setUnavailable("Cannot connect to speaker").catch(this.error);
      // Don't schedule reconnect - polling will handle it
      throw new Error('Device offline'); // Simple error for onInit
    }
  }

  private registerCapabilities() {
    // Power control
    if (this.hasCapability("onoff")) {
      this.registerCapabilityListener(
        "onoff",
        this.onCapabilityOnoff.bind(this),
      );
    }

    // Volume control
    if (this.hasCapability("volume_set")) {
      this.registerCapabilityListener(
        "volume_set",
        this.onCapabilityVolume.bind(this),
      );
    }

    // Mute control
    if (this.hasCapability("volume_mute")) {
      this.registerCapabilityListener(
        "volume_mute",
        this.onCapabilityMute.bind(this),
      );
    }

    // Source selection - with model-specific filtering
    if (this.hasCapability("source_input")) {
      this.registerCapabilityListener(
        "source_input",
        this.onCapabilitySource.bind(this),
      );
    }

    // DSP Settings (only for models that support them)
    if (this.hasCapability("bass_extension")) {
      this.registerCapabilityListener(
        "bass_extension",
        this.onCapabilityBassExtension.bind(this),
      );
    }

    if (this.hasCapability("desk_mode")) {
      this.registerCapabilityListener(
        "desk_mode",
        this.onCapabilityDeskMode.bind(this),
      );
    }

    if (this.hasCapability("wall_mode")) {
      this.registerCapabilityListener(
        "wall_mode",
        this.onCapabilityWallMode.bind(this),
      );
    }

    if (this.hasCapability("speaker_balance")) {
      this.registerCapabilityListener(
        "speaker_balance",
        this.onCapabilityBalance.bind(this),
      );
    }
  }

  // Capability handlers
  async onCapabilityOnoff(value: boolean) {
    try {
      await this.speaker.setPowerState(value);
      this.log("Power set to:", value);
    } catch (error) {
      this.error("Error setting power:", error);
      throw new Error("Failed to set power state");
    }
  }

  async onCapabilityVolume(value: number) {
    try {
      await this.speaker.setVolume(value * 100); // Convert 0-1 to 0-100
      this.log("Volume set to:", value * 100);
    } catch (error) {
      this.error("Error setting volume:", error);
      throw new Error("Failed to set volume");
    }
  }

  async onCapabilityMute(value: boolean) {
    try {
      await this.speaker.setMuted(value);
      this.log("Mute set to:", value);
    } catch (error) {
      this.error("Error setting mute:", error);
      throw new Error("Failed to set mute state");
    }
  }

  async onCapabilitySource(value: string) {
    try {
      // Check if source is supported by this model
      if (!isSourceSupported(this.modelId, value)) {
        throw new Error(`Source ${value} is not supported by ${this.modelConfig.name}`);
      }
      
      await this.speaker.setSource(value);
      this.log("Source set to:", value);
    } catch (error) {
      this.error("Error setting source:", error);
      throw new Error("Failed to set source");
    }
  }

  async onCapabilityBassExtension(value: string) {
    try {
      await this.speaker.setBassExtension(
        value as "less" | "standard" | "extra",
      );
      this.log("Bass extension set to:", value);
    } catch (error) {
      this.error("Error setting bass extension:", error);
      throw new Error("Failed to set bass extension");
    }
  }

  async onCapabilityDeskMode(value: boolean) {
    try {
      await this.speaker.setDeskMode(value);
      this.log("Desk mode set to:", value);
    } catch (error) {
      this.error("Error setting desk mode:", error);
      throw new Error("Failed to set desk mode");
    }
  }

  async onCapabilityWallMode(value: boolean) {
    try {
      await this.speaker.setWallMode(value);
      this.log("Wall mode set to:", value);
    } catch (error) {
      this.error("Error setting wall mode:", error);
      throw new Error("Failed to set wall mode");
    }
  }

  async onCapabilityBalance(value: number) {
    try {
      await this.speaker.setBalance(value);
      this.log("Balance set to:", value);
    } catch (error) {
      this.error("Error setting balance:", error);
      throw new Error("Failed to set balance");
    }
  }

  // State polling with availability management
  private startPolling() {
    const settings = this.getSettings();
    const normalInterval = (settings.polling_interval || 5) * 1000;
    const retryInterval = 30000; // Check every 30 seconds when device is unavailable
    // Start with retry interval if device is initially unavailable
    let currentInterval = this.isAvailable ? normalInterval : retryInterval;
    let failureCount = 0;
    const maxFailures = 3; // Mark unavailable after 3 consecutive failures

    this.log(`Starting polling with interval: ${currentInterval}ms (device ${this.isAvailable ? 'available' : 'unavailable'})`);

    const poll = async () => {
      try {
        // Try to get device settings
        const deviceSettings = await this.speaker.getAllSettings();
        
        // If we get here, device is responding
        if (!this.isAvailable) {
          this.log("Device is back online, marking as available");
          this.isAvailable = true;
          await this.setAvailable();
          failureCount = 0;
          
          // Switch back to normal polling interval
          if (currentInterval !== normalInterval) {
            currentInterval = normalInterval;
            clearInterval(this.pollInterval);
            this.pollInterval = setInterval(poll, currentInterval);
            this.log(`Switched back to normal polling interval: ${currentInterval}ms`);
          }
        }
        
        // Update capabilities
        await this.updateCapabilities(deviceSettings);
        failureCount = 0; // Reset failure count on success
        
      } catch (error) {
        failureCount++;
        
        // Mark device as unavailable after max failures
        if (failureCount >= maxFailures && this.isAvailable) {
          this.log(`Device not responding after ${maxFailures} attempts, marking as unavailable`);
          this.isAvailable = false;
          await this.setUnavailable("Device is not responding. Check if it's powered on and connected to the network.").catch(this.error);
          
          // Switch to slower retry interval to reduce network traffic
          if (currentInterval !== retryInterval) {
            currentInterval = retryInterval;
            clearInterval(this.pollInterval);
            this.pollInterval = setInterval(poll, currentInterval);
            this.log(`Switched to retry polling interval: ${currentInterval}ms`);
          }
        } else if (!this.isAvailable && failureCount === 1) {
          // Only log once when device is already unavailable
          this.log(`Device still offline, checking every ${currentInterval / 1000} seconds...`);
        }
      }
    };

    // Start polling
    this.pollInterval = setInterval(poll, currentInterval);
  }

  private async updateDeviceState() {
    try {
      const settings = await this.speaker.getAllSettings();
      await this.updateCapabilities(settings);
    } catch (error) {
      this.error("Error updating device state:", error);
    }
  }

  private async updateCapabilities(settings: KEFSettings) {
    // Update power state
    if (settings.standby !== undefined && this.hasCapability("onoff")) {
      await this.setCapabilityValue("onoff", !settings.standby).catch(
        this.error,
      );
    }

    // Update volume
    if (settings.volume !== undefined && this.hasCapability("volume_set")) {
      await this.setCapabilityValue("volume_set", settings.volume / 100).catch(
        this.error,
      );
    }

    // Update mute
    if (settings.muted !== undefined && this.hasCapability("volume_mute")) {
      await this.setCapabilityValue("volume_mute", settings.muted).catch(
        this.error,
      );
    }

    // Update source (filter out 'standby' and unsupported sources)
    if (settings.source !== undefined && this.hasCapability("source_input")) {
      // Only update source if it's not 'standby' and is supported by this model
      if (settings.source !== "standby" && isSourceSupported(this.modelId, settings.source)) {
        await this.setCapabilityValue("source_input", settings.source).catch(
          this.error,
        );
      }
    }

    // Update DSP settings (only if capability exists)
    if (
      settings.bassExtension !== undefined &&
      this.hasCapability("bass_extension")
    ) {
      await this.setCapabilityValue(
        "bass_extension",
        settings.bassExtension,
      ).catch(this.error);
    }

    if (settings.deskMode !== undefined && this.hasCapability("desk_mode")) {
      await this.setCapabilityValue("desk_mode", settings.deskMode).catch(
        this.error,
      );
    }

    if (settings.wallMode !== undefined && this.hasCapability("wall_mode")) {
      await this.setCapabilityValue("wall_mode", settings.wallMode).catch(
        this.error,
      );
    }

    if (
      settings.balance !== undefined &&
      this.hasCapability("speaker_balance")
    ) {
      await this.setCapabilityValue("speaker_balance", settings.balance).catch(
        this.error,
      );
    }
  }

  // Reconnection logic (now handled by polling)
  private scheduleReconnect() {
    // With the new polling mechanism, we don't need separate reconnection
    // The polling will automatically detect when device comes back online
    this.log("Device connection failed, polling will detect when it comes back online");
  }

  // Flow card actions
  async playPause() {
    await this.speaker.togglePlayPause();
  }

  async nextTrack() {
    await this.speaker.nextTrack();
  }

  async previousTrack() {
    await this.speaker.previousTrack();
  }

  async volumeUp(step: number = 5) {
    await this.speaker.increaseVolume(step);
  }

  async volumeDown(step: number = 5) {
    await this.speaker.decreaseVolume(step);
  }

  // Get available sources for this model
  async getAvailableSources() {
    return getAvailableSources(this.modelId);
  }

  // Settings update
  async onSettings({
    oldSettings,
    newSettings,
    changedKeys,
  }: {
    oldSettings: any;
    newSettings: any;
    changedKeys: string[];
  }) {
    this.log("Settings changed:", changedKeys);

    if (changedKeys.includes("ip") || changedKeys.includes("port")) {
      // Stop all current operations first
      if (this.pollInterval) {
        clearInterval(this.pollInterval);
        this.pollInterval = undefined;
      }

      // Clear any pending reconnect timers
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = undefined;
      }

      // Reset reconnection attempts
      this.reconnectAttempts = 0;

      // Create new speaker instance with new settings
      this.speaker = new KEFSpeaker(newSettings.ip, newSettings.port || 80, (msg: string) => this.log(msg));

      // Try to connect with the new settings
      try {
        const connected = await this.speaker.testConnection();
        if (connected) {
          this.log("Successfully connected to KEF speaker with new settings");
          this.isAvailable = true;
          await this.setAvailable();

          // Get fresh speaker info but don't update settings again
          try {
            const info = await this.speaker.getSpeakerInfo();
            this.log(`Connected to ${info.model} - ${info.name} at ${info.ip}`);
          } catch (infoError) {
            this.log("Could not get speaker info, but connection is working");
          }

          // Update device state
          await this.updateDeviceState();

          // Restart polling with new speaker instance
          this.startPolling();
        } else {
          throw new Error("Connection test failed");
        }
      } catch (error) {
        this.error("Failed to connect with new settings:", error);
        this.isAvailable = false;
        await this.setUnavailable("Cannot connect to speaker with new settings").catch(this.error);
        
        // Schedule reconnection attempts for the new IP
        this.scheduleReconnect();
        
        // Still start polling (it will handle connection failures gracefully)
        this.startPolling();
        
        // Don't throw the error - let Homey know we accepted the settings
        // even though connection failed (user might be entering correct IP soon)
      }
      
      return; // Return early to avoid executing other setting changes
    }

    if (changedKeys.includes("polling_interval")) {
      // Restart polling with new interval
      if (this.pollInterval) {
        clearInterval(this.pollInterval);
        this.pollInterval = undefined;
      }
      this.startPolling();
    }
  }

  // Device deletion
  async onDeleted() {
    this.log("Device deleted");

    // Stop polling
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = undefined;
    }

    // Clear timers
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
  }

  // Device unavailable
  async onUninit() {
    this.log("Device uninit");

    // Stop polling
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = undefined;
    }

    // Clear timers
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
  }
}