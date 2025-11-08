"use strict";

module.exports = {
  async getDeviceState({ homey, query }) {
    try {
      const { deviceId } = query;
      if (!deviceId) {
        throw new Error("Device ID is required");
      }

      // Get device from app's registry
      const app = homey.app;
      const device = app.getDevice ? app.getDevice(deviceId) : null;

      if (!device) {
        throw new Error(`Device not found with ID: ${deviceId}`);
      }

      // Get album art URL from the device's speaker object
      let albumArtUrl = null;
      try {
        if (device.speaker && device.speaker.getAlbumArtUrl) {
          albumArtUrl = await device.speaker.getAlbumArtUrl();
          // Convert KEF speaker URL to full URL if needed
          if (albumArtUrl && !albumArtUrl.startsWith("http")) {
            const settings = device.getSettings();
            albumArtUrl = `http://${settings.ip}:80${albumArtUrl}`;
          }
        }
      } catch (e) {
        // Silently fail if album art is not available
      }

      // Get supported sources from the device's model configuration
      let supportedSources = [];
      try {
        if (device.modelConfig && device.modelConfig.sources) {
          supportedSources = device.modelConfig.sources;
        }
      } catch (e) {
        // Default to common sources if not available
        supportedSources = [
          "wifi",
          "bluetooth",
          "tv",
          "optical",
          "usb",
          "analog",
        ];
      }

      // Get current capabilities from the device
      const state = {
        available: device.getAvailable(),
        // KEF speakers don't have a power capability - they're always on when available
        power: device.getAvailable(),
        playing: device.getCapabilityValue("speaker_playing") || false,
        volume: device.getCapabilityValue("volume_set") || 0,
        source: device.getCapabilityValue("source_input") || "wifi",
        track: device.getCapabilityValue("speaker_track") || "",
        artist: device.getCapabilityValue("speaker_artist") || "",
        album: device.getCapabilityValue("speaker_album") || "",
        albumArt: albumArtUrl,
        supportedSources: supportedSources,
      };

      return state;
    } catch (error) {
      throw new Error(`Failed to get device state: ${error.message}`);
    }
  },

  async sendCommand({ homey, body }) {
    try {
      const { deviceId, command, value } = body;
      if (!deviceId || !command) {
        throw new Error("Device ID and command are required");
      }

      // Get device from app's registry
      const app = homey.app;
      let device = app.getDevice ? app.getDevice(deviceId) : null;

      if (!device) {
        // Try to find device directly through drivers as fallback
        const drivers = [
          "kef-lsx2",
          "kef-ls50w2",
          "kef-ls60",
          "kef-lsx2lt",
          "kef-xio",
        ];
        for (const driverId of drivers) {
          try {
            const driver = homey.drivers.getDriver(driverId);
            const devices = driver.getDevices();
            const found = devices.find(
              (d) =>
                d.getData().id === deviceId ||
                d.__id === deviceId ||
                d.id === deviceId,
            );
            if (found) {
              device = found;
              break;
            }
          } catch (e) {
            // Driver might not exist
          }
        }

        if (!device) {
          throw new Error(`Device not found with ID: ${deviceId}`);
        }
      }

      // Map commands to capability actions
      switch (command) {
        case "play":
          // Call the capability listener directly instead of setCapabilityValue
          if (device.onCapabilityPlay) {
            await device.onCapabilityPlay();
          } else if (device.playPause) {
            await device.playPause();
          } else if (device.speaker && device.speaker.play) {
            await device.speaker.play();
          } else {
            await device.triggerCapabilityListener("speaker_playing", true);
          }
          break;
        case "pause":
          // Call the capability listener directly instead of setCapabilityValue
          if (device.onCapabilityPause) {
            await device.onCapabilityPause();
          } else if (device.playPause) {
            await device.playPause();
          } else if (device.speaker && device.speaker.pause) {
            await device.speaker.pause();
          } else {
            await device.triggerCapabilityListener("speaker_playing", false);
          }
          break;
        case "next":
          if (device.nextTrack) {
            await device.nextTrack();
          } else if (device.speaker && device.speaker.nextTrack) {
            await device.speaker.nextTrack();
          } else {
            await device.triggerCapabilityListener("speaker_next", true);
          }
          break;
        case "previous":
          if (device.previousTrack) {
            await device.previousTrack();
          } else if (device.speaker && device.speaker.previousTrack) {
            await device.speaker.previousTrack();
          } else {
            await device.triggerCapabilityListener("speaker_prev", true);
          }
          break;
        case "volume":
          if (value !== undefined) {
            if (device.onCapabilityVolume) {
              await device.onCapabilityVolume(value / 100);
            } else {
              await device.triggerCapabilityListener("volume_set", value / 100);
            }
          }
          break;
        default:
          throw new Error(`Unknown command: ${command}`);
      }

      return { success: true };
    } catch (error) {
      throw new Error(`Failed to send command: ${error.message}`);
    }
  },

  async getAlbumArt({ homey, query }) {
    try {
      const { deviceId, url } = query;
      if (!deviceId) {
        throw new Error("Device ID is required");
      }
      if (!url) {
        throw new Error("Album art URL is required");
      }

      // Get device from app's registry
      const app = homey.app;
      const device = app.getDevice ? app.getDevice(deviceId) : null;

      if (!device) {
        throw new Error(`Device not found with ID: ${deviceId}`);
      }

      // Fetch the album art from the KEF speaker
      const http = require("http");
      const urlParts = new URL(url);

      return new Promise((resolve, reject) => {
        let request = null;
        let responseHandled = false;
        const maxSize = 5 * 1024 * 1024; // 5MB limit
        let bytesReceived = 0;
        const chunks = [];

        // Helper function to cleanup resources
        const cleanup = () => {
          if (request && !request.destroyed) {
            request.destroy();
          }
        };

        request = http.get(
          {
            hostname: urlParts.hostname,
            port: urlParts.port || 80,
            path: urlParts.pathname,
            timeout: 5000,
          },
          (response) => {
            // Check content length if provided
            const contentLength = parseInt(
              response.headers["content-length"] || "0",
              10,
            );
            if (contentLength > maxSize) {
              cleanup();
              responseHandled = true;
              reject(
                new Error(
                  `Album art too large: ${contentLength} bytes (max ${maxSize} bytes)`,
                ),
              );
              return;
            }

            response.on("data", (chunk) => {
              bytesReceived += chunk.length;
              if (bytesReceived > maxSize) {
                cleanup();
                if (!responseHandled) {
                  responseHandled = true;
                  reject(
                    new Error(
                      `Album art stream too large: ${bytesReceived} bytes (max ${maxSize} bytes)`,
                    ),
                  );
                }
                return;
              }
              chunks.push(chunk);
            });

            response.on("end", () => {
              if (!responseHandled) {
                responseHandled = true;
                const buffer = Buffer.concat(chunks);
                const base64 = buffer.toString("base64");
                const contentType =
                  response.headers["content-type"] || "image/jpeg";

                // Return the image as a data URL
                resolve({
                  dataUrl: `data:${contentType};base64,${base64}`,
                });
              }
            });

            response.on("error", (error) => {
              cleanup();
              if (!responseHandled) {
                responseHandled = true;
                reject(new Error("Failed to fetch album art"));
              }
            });
          },
        );

        request.on("error", (error) => {
          cleanup();
          if (!responseHandled) {
            responseHandled = true;
            reject(new Error("Failed to fetch album art"));
          }
        });

        request.on("timeout", () => {
          cleanup();
          if (!responseHandled) {
            responseHandled = true;
            reject(new Error("Album art request timed out"));
          }
        });
      });
    } catch (error) {
      throw new Error(`Failed to get album art: ${error.message}`);
    }
  },
};
