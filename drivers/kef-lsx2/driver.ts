import Homey from "homey";
import { KEFSpeaker } from "../../lib/KEFSpeaker";

class KEFLSX2Driver extends Homey.Driver {
  async onInit() {
    this.log("KEF LSX II Driver initialized");
  }

  async onPair(session: any) {
    let speakerInfo: any = null;

    // Handle IP input view
    session.setHandler("showView", async (view: string) => {
      if (view === "manual_ip") {
        return true;
      }
      return false;
    });

    // Check for existing device with same IP

    session.setHandler("check_duplicate", async (data: any) => {
      const { ip } = data;

      this.log(`[Check Duplicate] Checking for existing device with IP: ${ip}`);

      // Get all devices from all KEF drivers

      const allDrivers = [
        "kef-ls50w2",
        "kef-lsx2",
        "kef-lsx2lt",
        "kef-ls60",
        "kef-xio",
      ];

      for (const driverId of allDrivers) {
        try {
          const driver = this.homey.drivers.getDriver(driverId);

          const devices = driver.getDevices();

          for (const device of devices) {
            const settings = device.getSettings();

            if (settings.ip === ip) {
              this.log(
                `[Check Duplicate] Found existing device: ${device.getName()} (${driverId}) with IP ${ip}`,
              );

              return {
                isDuplicate: true,

                deviceName: device.getName(),

                driverName: driverId,
              };
            }
          }
        } catch (error) {
          // Driver might not exist, continue checking others

          continue;
        }
      }

      this.log("[Check Duplicate] No existing device found with this IP");

      return { isDuplicate: false };
    });

    // Test connection and verify model
    session.setHandler("test_connection", async (data: any) => {
      const { ip, port } = data;

      this.log(`[Test Connection] Testing connection to ${ip}:${port || 80}`);

      if (!ip) {
        throw new Error("IP address is required");
      }

      try {
        // Create temporary speaker instance to test and get info
        const speaker = new KEFSpeaker(ip, port || 80, (msg: string) =>
          this.log(msg),
        );

        // Test connection
        this.log("[Test Connection] Testing connection...");
        const connected = await speaker.testConnection();
        if (!connected) {
          this.log("[Test Connection] Connection test failed");
          throw new Error("Cannot connect to speaker");
        }
        this.log("[Test Connection] Connection successful");

        // Get speaker info
        this.log("[Test Connection] Getting speaker info...");
        speakerInfo = await speaker.getSpeakerInfo();
        this.log(
          "[Test Connection] Speaker info received:",
          JSON.stringify(speakerInfo, null, 2),
        );

        // No strict verification - warning will be shown in UI if model mismatch

        return {
          success: true,
          model: "kef-lsx2",
          speakerInfo: speakerInfo,
        };
      } catch (error: any) {
        this.error("[Test Connection] Error:", error);
        throw new Error(`Connection failed: ${error.message}`);
      }
    });

    // Create device
    session.setHandler("create_device", async (data: any) => {
      const { ip, port, name, hideFromSpeakers } = data;

      const device: any = {
        name: name || speakerInfo?.name || "KEF LSX II",
        data: {
          id: `kef-lsx2-${ip.replace(/\./g, "-")}`,
          model: "kef-lsx2",
        },
        settings: {
          ip: ip,
          port: parseInt(port) || 80,
          polling_interval: 5,
        },
        store: {
          model: "kef-lsx2",
          speakerInfo: speakerInfo,
          hideFromSpeakers: hideFromSpeakers || false,
        },
      };

      // Set device class based on visibility preference
      // If hideFromSpeakers is true, use "other" class instead of "speaker"
      if (hideFromSpeakers) {
        device.class = "other";
      } else {
        device.class = "speaker";
      }

      return device;
    });
  }

  async onRepair(session: any, device: any) {
    this.log("Starting repair session for device:", device.getName());

    // Send current settings to the repair UI
    const currentSettings = device.getSettings();
    session.emit("current_settings", currentSettings);

    // Handle showing views
    session.setHandler("showView", async (view: string) => {
      if (view === "repair_ip") {
        // Send current settings again when the view is shown
        session.emit("current_settings", currentSettings);
        return true;
      }
      return false;
    });

    // Handle connection testing
    session.setHandler("test_connection", async (data: any) => {
      const { ip, port } = data;

      this.log(`[Repair Test] Testing connection to ${ip}:${port || 80}`);

      if (!ip) {
        throw new Error("IP address is required");
      }

      try {
        // Create temporary speaker instance to test and get info
        const speaker = new KEFSpeaker(ip, port || 80, (msg: string) =>
          this.log(msg),
        );

        // Test connection
        this.log("[Repair Test] Testing connection...");
        const connected = await speaker.testConnection();
        if (!connected) {
          this.log("[Repair Test] Connection test failed");
          throw new Error("Cannot connect to speaker");
        }
        this.log("[Repair Test] Connection successful");

        // Get speaker info to verify it's the right device
        this.log("[Repair Test] Getting speaker info...");
        const speakerInfo = await speaker.getSpeakerInfo();
        this.log(
          "[Repair Test] Speaker info received:",
          JSON.stringify(speakerInfo, null, 2),
        );

        return {
          success: true,
          speakerInfo: speakerInfo,
        };
      } catch (error: any) {
        this.error("[Repair Test] Error:", error);
        throw new Error(`Connection failed: ${error.message}`);
      }
    });

    // Handle repair updates
    session.setHandler("update_device", async (data: any) => {
      this.log("[Repair Update] Updating device with new settings:", data);

      if (!data.ip) {
        throw new Error("IP address is required");
      }

      // Test connection one more time before updating
      try {
        const speaker = new KEFSpeaker(
          data.ip,
          data.port || 80,
          (msg: string) => this.log(msg),
        );
        const connected = await speaker.testConnection();

        if (!connected) {
          throw new Error("Cannot connect to speaker at new address");
        }

        // Get speaker info for logging
        const speakerInfo = await speaker.getSpeakerInfo();
        this.log(
          "[Repair Update] Verified connection to:",
          speakerInfo.name,
          "at",
          data.ip,
        );

        // Update device settings
        await device.setSettings({
          ip: data.ip,
          port: data.port || 80,
          last_repaired: new Date().toISOString(),
        });

        // Force device to reinitialize with new settings
        // The device's onSettings method will handle reconnection
        this.log("[Repair Update] Settings updated successfully");

        // Mark device as available again
        await device.setAvailable();

        return true;
      } catch (error: any) {
        this.error("[Repair Update] Failed to update device:", error);
        throw new Error(`Update failed: ${error.message}`);
      }
    });
  }
}

module.exports = KEFLSX2Driver;
