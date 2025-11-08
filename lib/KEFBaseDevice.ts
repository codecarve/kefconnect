import Homey from "homey";
import { KEFSpeaker, KEFSettings, KEFSource } from "./KEFSpeaker";
import { getModelConfig, isSourceSupported } from "./KEFModels";
import { ImageUtil } from "./image-util";

export class KEFBaseDevice extends Homey.Device {
  protected speaker!: KEFSpeaker;
  protected pollInterval?: NodeJS.Timeout;
  protected isAvailable: boolean = false;
  protected modelId: string = "auto-detect";
  protected modelConfig: any;
  protected albumArtImage?: any;
  protected currentAlbumArtUrl: string | null = null;

  async onInit() {
    this.log("KEF Speaker Device initialized");

    // Register device with the app using Homey's device ID
    const app = this.homey.app as any;
    if (app && app.registerDevice) {
      // Use the Homey system ID (not the data ID)
      const deviceId =
        (this as any).__id || (this as any).id || this.getData().id;
      this.log(`Registering with ID: ${deviceId}`);
      app.registerDevice(deviceId, this);
    }

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
        this.log(
          `Set energy usage - On: ${this.modelConfig.energyUsage.usageOn}W, Off: ${this.modelConfig.energyUsage.usageOff}W`,
        );
      } catch (error) {
        this.log("Could not set energy usage:", error);
      }
    }

    // Initialize speaker connection
    this.speaker = new KEFSpeaker(
      settings.ip,
      settings.port || 80,
      (msg: string) => this.log(msg),
    );

    // Setup capabilities based on model
    await this.setupCapabilities();

    // Register capability listeners (before connection attempt)
    this.registerCapabilities();

    // Initialize album art image
    try {
      this.log("[onInit] Creating album art image...");
      this.albumArtImage = await ImageUtil.createAlbumArtImage(this.homey);
      this.log("[onInit] Album art image created, setting on device...");
      await this.setAlbumArtImage(this.albumArtImage);
      this.log("[onInit] Album art image successfully set on device");
    } catch (error) {
      this.error("[onInit] Failed to initialize album art:", error);
      // Continue without album art if it fails
    }

    // Try initial connection but don't fail if it doesn't work
    try {
      await this.initializeConnection();
    } catch (error) {
      this.log("Device is offline, will check for availability via polling");
      // Mark as unavailable but continue
      this.isAvailable = false;
      await this.setUnavailable(
        "Device is not responding. Will retry connection automatically.",
      ).catch(this.error);
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
    this.log(`Current capabilities: ${currentCapabilities.join(", ")}`);
    this.log(
      `Model ${this.modelId} supports: ${supportedCapabilities.join(", ")}`,
    );

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
    const coreCapabilities = ["volume_set", "source_input"];
    for (const capability of currentCapabilities) {
      if (
        !supportedCapabilities.includes(capability) &&
        !coreCapabilities.includes(capability)
      ) {
        try {
          await this.removeCapability(capability);
          this.log(`Removed unsupported capability: ${capability}`);
        } catch (error) {
          this.error(`Failed to remove capability ${capability}:`, error);
        }
      }
    }

    // Update source_input capability options based on model
    if (this.hasCapability("source_input")) {
      try {
        const supportedSources = this.modelConfig.sources;
        const sourceOptions = supportedSources.map((source: KEFSource) => ({
          id: source,
          title: this.getSourceTitle(source),
        }));

        await this.setCapabilityOptions("source_input", {
          values: sourceOptions,
        });

        this.log(
          `Updated source_input options to: ${supportedSources.join(", ")}`,
        );
      } catch (error) {
        this.error("Failed to update source_input options:", error);
      }
    }
  }

  private getSourceTitle(source: KEFSource): any {
    // Return localized titles for each source
    const titles: Record<string, any> = {
      wifi: { en: "WiFi", nl: "WiFi", fr: "WiFi", de: "WiFi", es: "WiFi" },
      bluetooth: {
        en: "Bluetooth",
        nl: "Bluetooth",
        fr: "Bluetooth",
        de: "Bluetooth",
        es: "Bluetooth",
      },
      optical: {
        en: "Optical",
        nl: "Optisch",
        fr: "Optique",
        de: "Optisch",
        es: "Óptico",
      },
      coaxial: {
        en: "Coaxial",
        nl: "Coaxiaal",
        fr: "Coaxial",
        de: "Koaxial",
        es: "Coaxial",
      },
      analog: {
        en: "Analog",
        nl: "Analoog",
        fr: "Analogique",
        de: "Analog",
        es: "Analógico",
      },
      tv: { en: "TV", nl: "TV", fr: "TV", de: "TV", es: "TV" },
      usb: { en: "USB", nl: "USB", fr: "USB", de: "USB", es: "USB" },
    };

    return titles[source] || { en: source };
  }

  private async initializeConnection(skipSettingsUpdate: boolean = false) {
    try {
      const connected = await this.speaker.testConnection();
      if (connected) {
        this.log("Successfully connected to KEF speaker");
        this.isAvailable = true;
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
              serial_number: info.serialNumber || "Unknown",
              firmware_version: info.firmware || "Unknown",
              last_connected: new Date().toISOString(),
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
      throw new Error("Device offline"); // Simple error for onInit
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

    // Music player controls
    if (this.hasCapability("speaker_playing")) {
      this.registerCapabilityListener("speaker_playing", async (value) => {
        try {
          this.log(`[speaker_playing] Received command: ${value}`);
          if (value) {
            this.log("[speaker_playing] Calling speaker.play()");
            await this.speaker.play();
            this.log("[speaker_playing] Play command completed");
          } else {
            this.log("[speaker_playing] Calling speaker.pause()");
            await this.speaker.pause();
            this.log("[speaker_playing] Pause command completed");
          }
        } catch (error: any) {
          this.error(`[speaker_playing] Error: ${error.message}`);
          // Check if it's an "Operation not supported" error
          if (
            error.message &&
            error.message.includes("Operation not supported")
          ) {
            this.log(
              "[speaker_playing] Playback control not available for current source",
            );
            // Don't throw the error, just log it
          } else {
            throw error;
          }
        }
      });
    }

    if (this.hasCapability("speaker_next")) {
      this.registerCapabilityListener("speaker_next", async () => {
        await this.nextTrack();
      });
    }

    if (this.hasCapability("speaker_prev")) {
      this.registerCapabilityListener("speaker_prev", async () => {
        await this.previousTrack();
      });
    }

    // Source selection - with model-specific filtering
    if (this.hasCapability("source_input")) {
      this.registerCapabilityListener(
        "source_input",
        this.onCapabilitySource.bind(this),
      );
    }

    if (this.hasCapability("speaker_shuffle")) {
      this.registerCapabilityListener(
        "speaker_shuffle",
        this.onCapabilityShuffle.bind(this),
      );
    }

    if (this.hasCapability("speaker_repeat")) {
      this.registerCapabilityListener(
        "speaker_repeat",
        this.onCapabilityRepeat.bind(this),
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

  async onCapabilitySource(value: string) {
    try {
      // Check if source is supported by this model
      if (!isSourceSupported(this.modelId, value)) {
        throw new Error(
          `Source ${value} is not supported by ${this.modelConfig.name}`,
        );
      }

      await this.speaker.setSource(value as KEFSource);
      this.log("Source set to:", value);

      // Immediately update the capability value so widgets see the change right away
      await this.setCapabilityValue("source_input", value).catch(this.error);
    } catch (error) {
      this.error("Error setting source:", error);
      throw new Error("Failed to set source");
    }
  }

  async onCapabilityShuffle(value: boolean) {
    try {
      // Validate input value
      if (value === null || value === undefined || typeof value !== "boolean") {
        this.error(
          `Invalid shuffle value received: ${value} (type: ${typeof value})`,
        );
        return;
      }

      // Ensure speaker is initialized
      if (!this.speaker) {
        this.error("Speaker not initialized when setting shuffle");
        return;
      }

      // Map Homey shuffle boolean to KEF shuffle modes
      // Homey uses boolean, KEF uses "none" | "all"
      const shuffleMode = value ? "all" : "none";
      await this.speaker.setShuffleMode(shuffleMode);
      this.log("Shuffle set to:", shuffleMode);
    } catch (error) {
      this.error("Error setting shuffle:", error);
      throw new Error("Failed to set shuffle");
    }
  }

  async onCapabilityRepeat(value: string) {
    try {
      // Validate input value
      if (!value || typeof value !== "string") {
        this.error(
          `Invalid repeat value received: ${value} (type: ${typeof value})`,
        );
        return;
      }

      // Ensure speaker is initialized
      if (!this.speaker) {
        this.error("Speaker not initialized when setting repeat");
        return;
      }

      // Map Homey repeat values to KEF repeat modes
      // Homey uses: "none" | "track" | "playlist"
      // KEF uses: "none" | "track" | "playlist" (same values)
      const validModes = ["none", "track", "playlist"];
      if (!validModes.includes(value)) {
        this.error(
          `Invalid repeat mode: ${value}. Expected one of: ${validModes.join(", ")}`,
        );
        return;
      }

      await this.speaker.setRepeatMode(value as "none" | "track" | "playlist");
      this.log("Repeat set to:", value);
    } catch (error) {
      this.error("Error setting repeat:", error);
      throw new Error("Failed to set repeat");
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

    this.log(
      `Starting polling with interval: ${currentInterval}ms (device ${this.isAvailable ? "available" : "unavailable"})`,
    );

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
            this.log(
              `Switched back to normal polling interval: ${currentInterval}ms`,
            );
          }
        }

        // Update capabilities
        await this.updateCapabilities(deviceSettings);

        // Update music metadata (track, artist, album, playing state)
        await this.updateMusicMetadata();

        // Update album art (only for streaming sources)
        await this.updateAlbumArt();

        failureCount = 0; // Reset failure count on success
      } catch (error) {
        failureCount++;

        // Mark device as unavailable after max failures
        if (failureCount >= maxFailures && this.isAvailable) {
          this.log(
            `Device not responding after ${maxFailures} attempts, marking as unavailable`,
          );
          this.isAvailable = false;
          await this.setUnavailable(
            "Device is not responding. Check if it's powered on and connected to the network.",
          ).catch(this.error);

          // Switch to slower retry interval to reduce network traffic
          if (currentInterval !== retryInterval) {
            currentInterval = retryInterval;
            clearInterval(this.pollInterval);
            this.pollInterval = setInterval(poll, currentInterval);
            this.log(
              `Switched to retry polling interval: ${currentInterval}ms`,
            );
          }
        } else if (!this.isAvailable && failureCount === 1) {
          // Only log once when device is already unavailable
          this.log(
            `Device still offline, checking every ${currentInterval / 1000} seconds...`,
          );
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

      // Update music metadata (track, artist, album, playing state)
      await this.updateMusicMetadata();

      // Update album art (only for streaming sources)
      await this.updateAlbumArt();
    } catch (error) {
      this.error("Error updating device state:", error);
    }
  }

  private async updateCapabilities(settings: KEFSettings) {
    // Update power state
    if (this.hasCapability("onoff")) {
      const powerState = settings.standby !== undefined ? !settings.standby : true;
      await this.setCapabilityValue("onoff", powerState).catch(this.error);
    }

    // Update volume
    if (settings.volume !== undefined && this.hasCapability("volume_set")) {
      await this.setCapabilityValue("volume_set", settings.volume / 100).catch(
        this.error,
      );
    }

    // Update source (filter out 'standby' and unsupported sources)
    if (settings.source !== undefined && this.hasCapability("source_input")) {
      // Only update source if it's not 'standby' and is supported by this model
      if (
        settings.source !== "standby" &&
        isSourceSupported(this.modelId, settings.source)
      ) {
        await this.setCapabilityValue("source_input", settings.source).catch(
          this.error,
        );
      }
    }
  }

  private async updateAlbumArt() {
    // Only update album art if the image is initialized and device is available
    if (!this.albumArtImage) {
      this.log(
        "[updateAlbumArt] Album art image not initialized, skipping update",
      );
      return;
    }
    if (!this.isAvailable) {
      this.log("[updateAlbumArt] Device not available, skipping update");
      return;
    }

    try {
      // Get current source to determine if we should show album art
      const currentSource = await this.speaker.getSource();

      // Only show album art for streaming sources (WiFi and Bluetooth)
      if (currentSource === "wifi" || currentSource === "bluetooth") {
        // Get the album art URL from the speaker
        const albumArtUrl = await this.speaker.getAlbumArtUrl();

        // Only update if the URL has changed
        if (albumArtUrl !== this.currentAlbumArtUrl) {
          this.currentAlbumArtUrl = albumArtUrl;

          try {
            await ImageUtil.updateAlbumArt(
              this.albumArtImage,
              albumArtUrl,
              this.getSettings().ip,
              this.log.bind(this),
            );
            await this.setAlbumArtImage(this.albumArtImage);
            this.log("[updateAlbumArt] Album art set on device successfully");
          } catch (error) {
            this.error("[updateAlbumArt] Failed to update album art:", error);
          }
        }
      } else {
        // Clear album art when not on a streaming source
        if (this.currentAlbumArtUrl !== null) {
          this.log(
            `[updateAlbumArt] Non-streaming source (${currentSource}), clearing album art`,
          );
          this.currentAlbumArtUrl = null;

          try {
            await ImageUtil.updateAlbumArt(
              this.albumArtImage,
              null,
              this.getSettings().ip,
              this.log.bind(this),
            );
            await this.setAlbumArtImage(this.albumArtImage);
          } catch (error) {
            this.error("[updateAlbumArt] Failed to clear album art:", error);
          }
        }
      }
    } catch (error) {
      this.error("[updateAlbumArt] Error in album art update process:", error);
    }
  }

  private async updateMusicMetadata() {
    try {
      // Get playback info from the speaker
      const playbackInfo = await this.speaker.getPlaybackInfo();

      // Update playing state - ensure it's always a boolean
      if (this.hasCapability("speaker_playing")) {
        const isPlaying = playbackInfo.isPlaying; // Ensure boolean value
        await this.setCapabilityValue("speaker_playing", isPlaying).catch(
          this.error,
        );
      }

      // Update track metadata
      if (this.hasCapability("speaker_artist")) {
        const artist = playbackInfo.artist || "";
        await this.setCapabilityValue("speaker_artist", artist).catch(
          this.error,
        );
      }

      if (this.hasCapability("speaker_track")) {
        const title = playbackInfo.title || "";
        await this.setCapabilityValue("speaker_track", title).catch(this.error);
      }

      if (this.hasCapability("speaker_album")) {
        const album = playbackInfo.album || "";
        await this.setCapabilityValue("speaker_album", album).catch(this.error);
      }

      if (this.hasCapability("speaker_repeat")) {
        const repeatMode = await this.speaker.getRepeatMode();
        await this.setCapabilityValue("speaker_repeat", repeatMode).catch(
          this.error,
        );
      }

      if (this.hasCapability("speaker_shuffle")) {
        const shuffleMode = await this.speaker.getShuffleMode();
        const shuffleValue = shuffleMode === "all";
        await this.setCapabilityValue("speaker_shuffle", shuffleValue).catch(
          this.error,
        );
      }
    } catch (error) {
      this.error("[updateMusicMetadata] Error updating metadata:", error);
    }
  }

  // Speaker control methods (used by capabilities)
  async nextTrack() {
    await this.speaker.nextTrack();
  }

  async previousTrack() {
    await this.speaker.previousTrack();
  }

  async getCurrentSource(): Promise<string> {
    try {
      return await this.speaker.getSource();
    } catch (error) {
      this.error("Error getting current source:", error);
      return "unknown";
    }
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

      // Create new speaker instance with new settings
      this.speaker = new KEFSpeaker(
        newSettings.ip,
        newSettings.port || 80,
        (msg: string) => this.log(msg),
      );

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
        await this.setUnavailable(
          "Cannot connect to speaker with new settings",
        ).catch(this.error);

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

    // Unregister device from the app using the same ID
    const app = this.homey.app as any;
    if (app && app.unregisterDevice) {
      const deviceId =
        (this as any).__id || (this as any).id || this.getData().id;
      app.unregisterDevice(deviceId);
    }

    // Stop polling
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = undefined;
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
  }
}
