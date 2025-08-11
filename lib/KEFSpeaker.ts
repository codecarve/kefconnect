import * as http from "http";

// KEF Speaker capabilities and types
export interface KEFSpeakerInfo {
  name: string;
  model: string;
  firmware?: string;
  mac?: string;
  ip: string;
  serialNumber?: string;
}

export interface KEFPlaybackInfo {
  isPlaying: boolean;
  title?: string;
  artist?: string;
  album?: string;
  duration?: number;
  position?: number;
  source?: string;
  albumArtUrl?: string;
}

export interface KEFSettings {
  volume?: number;
  muted?: boolean;
  source?: string;
  standby?: boolean;
  subwooferMode?: string;
  subwooferGain?: number;
  phase?: string;
  highpass?: boolean;
}

export type KEFSource =
  | "wifi"
  | "bluetooth"
  | "tv"
  | "optical"
  | "coaxial"
  | "analog"
  | "usb";

export type KEFRepeatMode = "none" | "track" | "playlist";
export type KEFShuffleMode = "none" | "all";

export class KEFSpeaker {
  private ip: string;
  private port: number = 80;
  private timeout: number = 5000;
  private lastActiveSource: KEFSource = "wifi"; // Store last active source
  private logger?: (message: string) => void;

  // Local state for repeat/shuffle (KEF API might not support these natively)
  private repeatMode: KEFRepeatMode = "none";
  private shuffleMode: KEFShuffleMode = "none";

  constructor(ip: string, port: number = 80, logger?: (message: string) => void) {
    this.ip = ip;
    this.port = port;
    this.logger = logger;
  }

  private log(message: string) {
    if (this.logger) {
      this.logger(message);
    }
  }

  // Core HTTP request method
  private async request(
    method: "GET" | "POST",
    path: string,
    body?: any,
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const options: http.RequestOptions = {
        hostname: this.ip,
        port: this.port,
        path: path,
        method: method,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        timeout: this.timeout,
      };

      const req = http.request(options, (res) => {
        // Set encoding to handle special characters properly
        res.setEncoding('utf8');
        let data = "";

        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", () => {
          try {
            if (data) {
              const parsed = JSON.parse(data);
              resolve(parsed);
            } else {
              resolve(null);
            }
          } catch (error) {
            // Return raw data if not JSON
            resolve(data);
          }
        });
      });

      req.on("error", (error) => {
        req.destroy(); // Clean up the request on error
        reject(new Error(`Request failed: ${error.message}`));
      });

      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Request timeout"));
      });

      if (body) {
        req.write(JSON.stringify(body));
      }

      req.end();
    });
  }

  // Helper to get data from KEF API
  private async getData(path: string): Promise<any> {
    const url = `/api/getData?path=${encodeURIComponent(path)}&roles=value`;
    const response = await this.request("GET", url);
    return response;
  }

  // Helper to set data to KEF API
  private async setData(path: string, value: string): Promise<void> {
    const url = `/api/setData?path=${encodeURIComponent(path)}&roles=value&value=${encodeURIComponent(value)}`;
    await this.request("GET", url);
  }

  // Power Control
  async getPowerState(): Promise<boolean> {
    try {
      const response = await this.getData("settings:/kef/play/physicalSource");
      if (response && response[0] && response[0].kefPhysicalSource) {
        // Speaker is off if source is "standby"
        return response[0].kefPhysicalSource.toLowerCase() !== "standby";
      }
      return true;
    } catch (error) {
      // No response means speaker is off or unreachable
      return false;
    }
  }

  async setPowerState(on: boolean): Promise<void> {
    if (on) {
      // Wake the speaker by setting last active source
      // Use lastActiveSource to avoid setting "standby" as source
      await this.setSource(this.lastActiveSource);
    } else {
      // Send standby command
      const value = JSON.stringify({
        type: "kefPhysicalSource",
        kefPhysicalSource: "standby"
      });
      await this.setData("settings:/kef/play/physicalSource", value);
    }
  }

  // Source Management
  async getSource(): Promise<KEFSource> {
    try {
      const response = await this.getData("settings:/kef/play/physicalSource");
      if (response && response[0] && response[0].kefPhysicalSource) {
        const source = response[0].kefPhysicalSource.toLowerCase();
        // Store last active source (not standby)
        if (source !== "standby") {
          this.lastActiveSource = source as KEFSource;
        }
        return source as KEFSource;
      }
      return "wifi" as KEFSource;
    } catch (error) {
      throw new Error(`Failed to get source: ${error}`);
    }
  }

  async setSource(source: KEFSource): Promise<void> {
    const value = JSON.stringify({
      type: "kefPhysicalSource",
      kefPhysicalSource: source
    });
    await this.setData("settings:/kef/play/physicalSource", value);
  }

  // Volume Control
  async getVolume(): Promise<number> {
    try {
      const response = await this.getData("player:volume");
      if (response && response[0] && response[0].i32_ !== undefined) {
        return response[0].i32_;
      }
      return 0;
    } catch (error) {
      throw new Error(`Failed to get volume: ${error}`);
    }
  }

  async setVolume(volume: number): Promise<void> {
    const vol = Math.min(100, Math.max(0, Math.round(volume)));
    const value = JSON.stringify({
      type: "i32_",
      i32_: vol
    });
    await this.setData("player:volume", value);
  }

  async increaseVolume(step: number = 5): Promise<void> {
    const current = await this.getVolume();
    await this.setVolume(current + step);
  }

  async decreaseVolume(step: number = 5): Promise<void> {
    const current = await this.getVolume();
    await this.setVolume(current - step);
  }

  // Mute Control
  private previousVolume: number = 50;
  private isMuted: boolean = false;

  async getMuted(): Promise<boolean> {
    // KEF speakers don't have a dedicated mute endpoint
    // Mute is implemented by setting volume to 0
    const volume = await this.getVolume();
    return volume === 0 && this.isMuted;
  }

  async setMuted(muted: boolean): Promise<void> {
    if (muted) {
      // Store current volume before muting
      const currentVolume = await this.getVolume();
      if (currentVolume > 0) {
        this.previousVolume = currentVolume;
      }
      await this.setVolume(0);
      this.isMuted = true;
    } else {
      // Restore previous volume
      await this.setVolume(this.previousVolume);
      this.isMuted = false;
    }
  }

  async toggleMute(): Promise<void> {
    const muted = await this.getMuted();
    await this.setMuted(!muted);
  }

  // Playback Control
  async play(): Promise<void> {
    this.log('[play] Play requested');

    try {
      const response = await this.getData("player:player/data");
      if (response && response[0]) {
        const playerData = response[0];
        this.log(`[play] Current state: ${playerData.state}`);

        if (playerData.state === 'paused' || playerData.state === 'stopped') {
          // Use pause command as toggle - it works for both paused and stopped states
          // when using external players like Spotify Connect
          this.log('[play] Sending pause command to toggle playback');
          await this.sendPauseCommand();
        } else if (playerData.state === 'playing') {
          this.log('[play] Already playing, no action needed');
        }
      }
    } catch (error) {
      this.log(`[play] Could not check player state: ${error}`);
      // Try pause command anyway as it's safe
      await this.sendPauseCommand();
    }
  }

  async pause(): Promise<void> {
    this.log('[pause] Sending pause command');
    await this.sendPauseCommand();
  }

  // Internal method to send actual play command
  private async sendPlayCommand(): Promise<void> {
    this.log('[sendPlayCommand] Sending play command');

    const value = '{"control":"play"}';
    const url = `/api/setData?path=${encodeURIComponent("player:player/control")}&roles=activate&value=${encodeURIComponent(value)}`;
    this.log(`[sendPlayCommand] Sending request to: ${url}`);

    try {
      const response = await this.request("GET", url);
      this.log(`[sendPlayCommand] Response: ${JSON.stringify(response)}`);

      // Check if the API returned an error
      if (response && response.error) {
        const errorMessage = response.error.message || 'Operation failed';
        this.log(`[sendPlayCommand] API Error: ${errorMessage}`);
        throw new Error(errorMessage);
      }
    } catch (error: any) {
      this.log(`[sendPlayCommand] Error: ${error.message}`);
      throw error;
    }
  }

  // Internal method to send pause command (used as toggle for external players)
  private async sendPauseCommand(): Promise<void> {
    this.log('[sendPauseCommand] Sending pause command (acts as toggle for external players)');

    const value = '{"control":"pause"}';
    const url = `/api/setData?path=${encodeURIComponent("player:player/control")}&roles=activate&value=${encodeURIComponent(value)}`;
    this.log(`[sendPauseCommand] Sending request to: ${url}`);

    try {
      const response = await this.request("GET", url);
      this.log(`[sendPauseCommand] Response: ${JSON.stringify(response)}`);

      // Check if the API returned an error
      if (response && response.error) {
        const errorMessage = response.error.message || 'Operation failed';
        this.log(`[sendPauseCommand] API Error: ${errorMessage}`);
        throw new Error(errorMessage);
      }
    } catch (error: any) {
      this.log(`[sendPauseCommand] Error: ${error.message}`);
      throw error;
    }
  }

  async togglePlayPause(): Promise<void> {
    try {
      const isPlaying = await this.isPlaying();
      if (isPlaying) {
        this.log('[togglePlayPause] Currently playing, sending pause');
        await this.pause();
      } else {
        this.log('[togglePlayPause] Not playing, sending play');
        await this.play();
      }
    } catch (error) {
      this.log(`[togglePlayPause] Error in toggle: ${error}`);
    }
  }

  async nextTrack(): Promise<void> {
    this.log('[nextTrack] Attempting to skip to next track');

    const value = '{"control":"next"}';
    const url = `/api/setData?path=${encodeURIComponent("player:player/control")}&roles=activate&value=${encodeURIComponent(value)}`;
    this.log(`[nextTrack] Sending request to: ${url}`);

    try {
      const response = await this.request("GET", url);
      this.log(`[nextTrack] Response: ${JSON.stringify(response)}`);

      // Check if the API returned an error
      if (response && response.error) {
        const errorMessage = response.error.message || 'Operation failed';
        this.log(`[nextTrack] API Error: ${errorMessage}`);
        throw new Error(errorMessage);
      }
    } catch (error: any) {
      this.log(`[nextTrack] Error: ${error.message}`);
      throw error; // Re-throw to let the flow card handle it
    }
  }

  async previousTrack(): Promise<void> {
    this.log('[previousTrack] Attempting to skip to previous track');

    const value = '{"control":"previous"}';
    const url = `/api/setData?path=${encodeURIComponent("player:player/control")}&roles=activate&value=${encodeURIComponent(value)}`;
    this.log(`[previousTrack] Sending request to: ${url}`);

    try {
      const response = await this.request("GET", url);
      this.log(`[previousTrack] Response: ${JSON.stringify(response)}`);

      // Check if the API returned an error
      if (response && response.error) {
        const errorMessage = response.error.message || 'Operation failed';
        this.log(`[previousTrack] API Error: ${errorMessage}`);
        throw new Error(errorMessage);
      }
    } catch (error: any) {
      this.log(`[previousTrack] Error: ${error.message}`);
      throw error; // Re-throw to let the flow card handle it
    }
  }

  async isPlaying(): Promise<boolean> {
    try {
      // Get the player data which contains the state field
      const response = await this.getData("player:player/data");
      // Check if state is "playing" (not "stopped" or "paused")
      return response && response[0] && response[0].state === "playing";
    } catch (error) {
      return false;
    }
  }

  // Helper to get model info from web interface
  private async getModelFromWebInterface(): Promise<{ model?: string, version?: string }> {
    return new Promise((resolve) => {
      const options: http.RequestOptions = {
        hostname: this.ip,
        port: this.port,
        path: '/',
        method: 'GET',
        timeout: 3000,
      };

      const req = http.request(options, (res) => {
        // Follow redirect if needed
        if (res.statusCode === 301 || res.statusCode === 302) {
          const redirectPath = res.headers.location || '/index.fcgi';
          this.log(`[getModelFromWebInterface] Following redirect to: ${redirectPath}`);

          const redirectOptions: http.RequestOptions = {
            hostname: this.ip,
            port: this.port,
            path: redirectPath,
            method: 'GET',
            timeout: 3000,
          };

          const redirectReq = http.request(redirectOptions, (redirectRes) => {
            let data = '';
            redirectRes.on('data', (chunk) => {
              data += chunk;
            });

            redirectRes.on('end', () => {
              const result: { model?: string, version?: string } = {};

              // First try to parse the title tag for model (most reliable)
              const titleMatch = data.match(/<title>([^<]+)<\/title>/i);
              if (titleMatch && titleMatch[1]) {
                const title = titleMatch[1];
                this.log(`[getModelFromWebInterface] Found page title: ${title}`);

                // Parse title format: "KEF | MODEL | Homepage"
                const titleParts = title.split('|').map(s => s.trim());
                if (titleParts.length >= 2) {
                  const modelFromTitle = titleParts[1];
                  this.log(`[getModelFromWebInterface] Model from title: ${modelFromTitle}`);

                  // Map the model names to our internal names
                  if (modelFromTitle === 'LS50 Wireless II' || modelFromTitle === 'LS50WII' || modelFromTitle === 'LS50W2') {
                    result.model = 'LS50 Wireless II';
                  } else if (modelFromTitle === 'LS50 Wireless' || modelFromTitle === 'LS50W') {
                    result.model = 'LS50 Wireless';
                  } else if (modelFromTitle === 'LSX II' || modelFromTitle === 'LSX2' || modelFromTitle === 'LSXII') {
                    result.model = 'LSX II';
                  } else if (modelFromTitle === 'LSX II LT' || modelFromTitle === 'LSX2LT') {
                    result.model = 'LSX II LT';
                  } else if (modelFromTitle === 'LSX') {
                    result.model = 'LSX';
                  } else if (modelFromTitle === 'LS60 Wireless' || modelFromTitle === 'LS60') {
                    result.model = 'LS60 Wireless';
                  } else if (modelFromTitle === 'XIO') {
                    result.model = 'XIO';
                  } else {
                    // Use the title model as-is if we don't have a mapping
                    result.model = modelFromTitle;
                  }
                }
              }

              // Fall back to parsing release status if title didn't work
              if (!result.model) {
                const releaseMatch = data.match(/Release status:\s*([^<\s]+)/);
                if (releaseMatch && releaseMatch[1]) {
                  // Extract model from release status (e.g., "LS50WII_V37165" -> "LS50WII")
                  const modelPart = releaseMatch[1].split('_')[0];
                  this.log(`[getModelFromWebInterface] Found release status: ${releaseMatch[1]}, model: ${modelPart}`);

                  // Map the model codes to friendly names
                  if (modelPart === 'LS50WII' || modelPart === 'LS50W2') {
                    result.model = 'LS50 Wireless II';
                  } else if (modelPart === 'LS50W') {
                    result.model = 'LS50 Wireless';
                  } else if (modelPart === 'LSX2' || modelPart === 'LSXII') {
                    result.model = 'LSX II';
                  } else if (modelPart === 'LSX2LT') {
                    result.model = 'LSX II LT';
                  } else if (modelPart === 'LSX') {
                    result.model = 'LSX';
                  } else if (modelPart === 'LS60') {
                    result.model = 'LS60 Wireless';
                  } else if (modelPart === 'XIO') {
                    result.model = 'XIO';
                  }
                }
              }

              // Parse device version
              const versionMatch = data.match(/Device version:\s*([^<\s]+)/);
              if (versionMatch && versionMatch[1]) {
                result.version = versionMatch[1];
                this.log(`[getModelFromWebInterface] Found device version: ${versionMatch[1]}`);
              }

              resolve(result);
            });
          });

          redirectReq.on('error', (error) => {
            this.log('[getModelFromWebInterface] Error fetching redirect: ' + error);
            resolve({});
          });

          redirectReq.end();
        } else {
          // Try to parse directly if no redirect
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });

          res.on('end', () => {
            const result: { model?: string, version?: string } = {};

            // First try to parse the title tag for model (most reliable)
            const titleMatch = data.match(/<title>([^<]+)<\/title>/i);
            if (titleMatch && titleMatch[1]) {
              const title = titleMatch[1];
              this.log(`[getModelFromWebInterface] Found page title: ${title}`);

              // Parse title format: "KEF | MODEL | Homepage"
              const titleParts = title.split('|').map(s => s.trim());
              if (titleParts.length >= 2) {
                const modelFromTitle = titleParts[1];
                this.log(`[getModelFromWebInterface] Model from title: ${modelFromTitle}`);

                // Map the model names to our internal names
                if (modelFromTitle === 'LS50 Wireless II' || modelFromTitle === 'LS50WII' || modelFromTitle === 'LS50W2') {
                  result.model = 'LS50 Wireless II';
                } else if (modelFromTitle === 'LS50 Wireless' || modelFromTitle === 'LS50W') {
                  result.model = 'LS50 Wireless';
                } else if (modelFromTitle === 'LSX II' || modelFromTitle === 'LSX2' || modelFromTitle === 'LSXII') {
                  result.model = 'LSX II';
                } else if (modelFromTitle === 'LSX II LT' || modelFromTitle === 'LSX2LT') {
                  result.model = 'LSX II LT';
                } else if (modelFromTitle === 'LSX') {
                  result.model = 'LSX';
                } else if (modelFromTitle === 'LS60 Wireless' || modelFromTitle === 'LS60') {
                  result.model = 'LS60 Wireless';
                } else if (modelFromTitle === 'XIO') {
                  result.model = 'XIO';
                } else {
                  // Use the title model as-is if we don't have a mapping
                  result.model = modelFromTitle;
                }
              }
            }

            // Fall back to parsing release status if title didn't work
            if (!result.model) {
              const releaseMatch = data.match(/Release status:\s*([^<\s]+)/);
              if (releaseMatch && releaseMatch[1]) {
                const modelPart = releaseMatch[1].split('_')[0];
                this.log(`[getModelFromWebInterface] Found release status: ${releaseMatch[1]}, model: ${modelPart}`);

                if (modelPart === 'LS50WII' || modelPart === 'LS50W2') {
                  result.model = 'LS50 Wireless II';
                } else if (modelPart === 'LS50W') {
                  result.model = 'LS50 Wireless';
                } else if (modelPart === 'LSX2' || modelPart === 'LSXII') {
                  result.model = 'LSX II';
                } else if (modelPart === 'LSX2LT') {
                  result.model = 'LSX II LT';
                } else if (modelPart === 'LSX') {
                  result.model = 'LSX';
                } else if (modelPart === 'LS60') {
                  result.model = 'LS60 Wireless';
                } else if (modelPart === 'XIO') {
                  result.model = 'XIO';
                }
              }
            }

            // Parse device version
            const versionMatch = data.match(/Device version:\s*([^<\s]+)/);
            if (versionMatch && versionMatch[1]) {
              result.version = versionMatch[1];
              this.log(`[getModelFromWebInterface] Found device version: ${versionMatch[1]}`);
            }

            resolve(result);
          });
        }
      });

      req.on('error', (error) => {
        this.log('[getModelFromWebInterface] Error fetching web interface: ' + error);
        resolve({});
      });

      req.on('timeout', () => {
        req.destroy();
        this.log('[getModelFromWebInterface] Timeout fetching web interface');
        resolve({});
      });

      req.end();
    });
  }

  // Speaker Information
  async getSpeakerInfo(): Promise<KEFSpeakerInfo> {
    const startTime = Date.now();
    this.log("[getSpeakerInfo] ========== Starting to fetch speaker information ==========");
    this.log(`[getSpeakerInfo] Target IP: ${this.ip}, Port: ${this.port}`);

    const info: KEFSpeakerInfo = {
      ip: this.ip,
      name: "KEF Speaker",
      model: "Unknown",
    };

    try {
      // Run ALL requests in parallel for maximum efficiency
      this.log("[getSpeakerInfo] Launching all requests in parallel...");

      const allPromises: Promise<any>[] = [];

      // Web interface promise
      const webPromise = this.getModelFromWebInterface()
        .then(res => ({type: 'web', data: res}))
        .catch(err => ({type: 'web', error: err}));
      allPromises.push(webPromise);

      // API promises - all paths that might work
      const apiPaths = [
        {path: "settings:/kef/host/serialNumber", type: 'serial'},
        {path: "settings:/kef/host/firmwareVersion", type: 'firmware'},
        {path: "settings:/kef/host/speakerName", type: 'name1'},
        {path: "settings:/deviceName", type: 'name2'},  // Most successful name path based on logs
        {path: "settings:/system/deviceName", type: 'name3'}
      ];

      for (const {path, type} of apiPaths) {
        const promise = this.getData(path)
          .then(res => ({type, data: res, path}))
          .catch(err => ({type, error: err, path}));
        allPromises.push(promise);
      }

      // Execute all requests in parallel
      this.log(`[getSpeakerInfo] Executing ${allPromises.length} requests in parallel...`);
      const allResults = await Promise.all(allPromises);
      const totalElapsed = Date.now() - startTime;
      this.log(`[getSpeakerInfo] All requests completed in ${totalElapsed}ms`);

      // Process results
      let nameFound = false;

      for (const result of allResults) {
        if (result.type === 'web') {
          if (!result.error && result.data) {
            if (result.data.model) {
              info.model = result.data.model;
              this.log(`[getSpeakerInfo] ✓ Model from web: "${info.model}"`);
            }
            if (result.data.version) {
              info.firmware = result.data.version;
              this.log(`[getSpeakerInfo] ✓ Firmware from web: "${info.firmware}"`);
            }
          } else {
            this.log(`[getSpeakerInfo] ✗ Web interface failed: ${result.error}`);
          }
        } else if (result.type === 'serial') {
          if (!result.error && result.data && result.data[0]) {
            const serialValue = result.data[0].serialNumber || result.data[0].string_;
            if (serialValue) {
              info.serialNumber = serialValue;
              this.log(`[getSpeakerInfo] ✓ Serial number: "${info.serialNumber}"`);

              // Model detection from serial if still unknown
              if (info.model === "Unknown" && info.serialNumber) {
                const serial = info.serialNumber.toUpperCase();
                const modelMap: { [key: string]: string } = {
                  'LSW': 'LS50 Wireless',
                  'LS50W2': 'LS50 Wireless II',
                  'LSX2': 'LSX II',
                  'LSX': 'LSX',
                  'LS60': 'LS60 Wireless'
                };

                for (const [prefix, model] of Object.entries(modelMap)) {
                  if (serial.startsWith(prefix)) {
                    info.model = model;
                    this.log(`[getSpeakerInfo] ✓ Model from serial: "${info.model}"`);
                    break;
                  }
                }
              }
            }
          } else if (result.error) {
            this.log(`[getSpeakerInfo] ✗ Serial API error`);
          }
        } else if (result.type === 'firmware') {
          if (!result.error && result.data && result.data[0]) {
            const fwValue = result.data[0].firmwareVersion || result.data[0].string_;
            if (fwValue && !info.firmware) {
              info.firmware = fwValue;
              this.log(`[getSpeakerInfo] ✓ Firmware from API: "${info.firmware}"`);
            }
          } else if (result.error) {
            this.log(`[getSpeakerInfo] ✗ Firmware API error`);
          }
        } else if (result.type.startsWith('name') && !nameFound) {
          if (!result.error && result.data && result.data[0]) {
            const nameValue = result.data[0].speakerName ||
              result.data[0].deviceName ||
              result.data[0].string_;
            if (nameValue && nameValue !== "KEF Speaker") {
              info.name = nameValue;
              nameFound = true;
              this.log(`[getSpeakerInfo] ✓ Name from ${result.path}: "${info.name}"`);
            }
          }
        }
      }

    } catch (error) {
      this.log(`[getSpeakerInfo] ✗✗✗ Critical error: ${error}`);
    }

    const totalTime = Date.now() - startTime;
    this.log("[getSpeakerInfo] ========== Summary ==========");
    this.log(`[getSpeakerInfo] Total execution time: ${totalTime}ms`);
    this.log(`[getSpeakerInfo] Name: "${info.name}"`);
    this.log(`[getSpeakerInfo] Model: "${info.model}"`);
    this.log(`[getSpeakerInfo] Firmware: "${info.firmware || 'Not detected'}"`);
    this.log(`[getSpeakerInfo] Serial: "${info.serialNumber || 'Not detected'}"`);
    this.log(`[getSpeakerInfo] IP: "${info.ip}"`);
    this.log("[getSpeakerInfo] ========================================");

    return info;
  }

  // Get album art URL
  async getAlbumArtUrl(): Promise<string | null> {
    try {
      const trackResponse = await this.getData("player:player/data");


      if (!trackResponse) {
        return null;
      }

      // Handle different response formats
      let playerData = null;

      if (Array.isArray(trackResponse)) {
        if (trackResponse.length > 0) {
          playerData = trackResponse[0];
        } else {
          return null;
        }
      } else {
        // Check if it's an error response
        if (trackResponse.error) {
          return null;
        }

        if (trackResponse.data) {
          if (Array.isArray(trackResponse.data)) {
            if (trackResponse.data.length > 0) {
              playerData = trackResponse.data[0];
            }
          } else {
            playerData = trackResponse.data;
          }
        } else {
          // Use the response directly
          playerData = trackResponse;
        }
      }

      if (!playerData) {
        return null;
      }

      if (playerData.state === 'stopped') {
        return null;
      }

      // Try multiple possible locations for album art URL
      let albumArtUrl = null;

      if (playerData.trackRoles && playerData.trackRoles.icon) {
        albumArtUrl = playerData.trackRoles.icon;
      }
      // 2. Check icon directly
      else if (playerData.icon) {
        albumArtUrl = playerData.icon;
      }
      // 3. Check for nested player object
      else if (playerData.player && playerData.player.trackRoles && playerData.player.trackRoles.icon) {
        albumArtUrl = playerData.player.trackRoles.icon;
      }

      return albumArtUrl;
    } catch (error) {
      this.log(`[getAlbumArtUrl] Error fetching album art: ${error}`);
    }
    return null;
  }

  // Playback Information
  async getPlaybackInfo(): Promise<KEFPlaybackInfo> {
    const info: KEFPlaybackInfo = {
      isPlaying: false,
    };

    try {
      // Get playing state
      info.isPlaying = await this.isPlaying();

      // Get current source
      info.source = await this.getSource();

      // Get track info if available
      const trackResponse = await this.getData("player:player/data");
      if (trackResponse && trackResponse[0]) {
        const track = trackResponse[0];

        // Skip if player is stopped
        if (track.state === 'stopped') {
          this.log('[getPlaybackInfo] Player is stopped');
          return info;
        }

        // Log available fields for debugging
        const topLevelKeys = Object.keys(track).slice(0, 15);

        // Try multiple paths to extract metadata
        if (track.trackRoles) {

          // Title is directly in trackRoles
          if (track.trackRoles.title) {
            info.title = track.trackRoles.title;
          }

          // Artist and album are in mediaData.metaData
          if (track.trackRoles.mediaData && track.trackRoles.mediaData.metaData) {
            const metaData = track.trackRoles.mediaData.metaData;
            if (metaData.artist) {
              info.artist = metaData.artist;
            }
            if (metaData.album) {
              info.album = metaData.album;
            }
          }

          // Duration is in mediaData.resources
          if (track.trackRoles.mediaData && track.trackRoles.mediaData.resources &&
            track.trackRoles.mediaData.resources[0] && track.trackRoles.mediaData.resources[0].duration) {
            info.duration = track.trackRoles.mediaData.resources[0].duration;
          }

          // Album art URL is in trackRoles.icon
          if (track.trackRoles.icon) {
            info.albumArtUrl = track.trackRoles.icon;
          }
        }

        // Path 2: Direct fields (alternative structure)
        if (!info.title && track.title) {
          info.title = track.title;
        }

        if (!info.artist && track.artist) {
          info.artist = track.artist;
        }

        if (!info.album && track.album) {
          info.album = track.album;
        }

        // Path 3: Check metadata field directly
        if (track.metadata) {
          if (!info.title && track.metadata.title) {
            info.title = track.metadata.title;
          }
          if (!info.artist && track.metadata.artist) {
            info.artist = track.metadata.artist;
          }
          if (!info.album && track.metadata.album) {
            info.album = track.metadata.album;
          }
        }

        // Path 4: Check metaData field (different casing)
        if (track.metaData) {
          if (!info.title && track.metaData.title) {
            info.title = track.metaData.title;
          }
          if (!info.artist && track.metaData.artist) {
            info.artist = track.metaData.artist;
          }
          if (!info.album && track.metaData.album) {
            info.album = track.metaData.album;
          }
        }

        // Position might be at top level or elsewhere
        if (track.position) info.position = track.position;
      }
    } catch (error) {
      this.log(`[getPlaybackInfo] Error fetching playback info: ${error}`);
    }

    return info;
  }

  // DSP and EQ Settings
  async getSubwooferGain(): Promise<number> {
    try {
      const response = await this.getData("settings:/kef/dsp/subwooferGain");
      if (
        response &&
        response[0] &&
        typeof response[0].subwooferGain === "number"
      ) {
        return response[0].subwooferGain;
      }
      return 0;
    } catch (error) {
      // Subwoofer settings not available
      return 0;
    }
  }


  // Get all current settings
  async getAllSettings(): Promise<KEFSettings> {
    const settings: KEFSettings = {};

    try {
      // First check if speaker is in standby
      const powerState = await this.getPowerState();
      settings.standby = !powerState;

      // Get source (this also updates lastActiveSource)
      settings.source = await this.getSource();

      // If speaker is in standby, skip other settings as they might fail
      if (!settings.standby && settings.source !== "standby") {
        try {
          settings.volume = await this.getVolume();
          settings.muted = await this.getMuted();
        } catch (error) {
          // Volume/mute might fail, continue with other settings
          // Could not get volume/mute
        }

        try {
          settings.subwooferGain = await this.getSubwooferGain();
        } catch (error) {
          // DSP settings might not be available on all models
          // Could not get DSP settings
        }
      }
    } catch (error) {
      this.log(`Error fetching all settings: ${error}`);
      // Return minimal settings on error
      settings.standby = true; // Assume standby if we can't connect
    }

    return settings;
  }


  // Repeat and Shuffle Management
  // Note: KEF speakers show available playMode options when playing via WiFi/Roon
  // but don't expose the current state or support setting these values via API.
  // The actual shuffle/repeat state is managed by the streaming service (Roon, Spotify, etc.)

  async getRepeatMode(): Promise<KEFRepeatMode> {
    // KEF API only shows available modes, not current state
    // We maintain local state for UI display purposes only
    this.log(`[getRepeatMode] Returning local state: ${this.repeatMode}`);
    return this.repeatMode;
  }

  async setRepeatMode(mode: KEFRepeatMode): Promise<void> {
    this.log(`[setRepeatMode] Setting local repeat mode to: ${mode}`);
    this.repeatMode = mode;
    // Note: This only updates the local state for display
    // The actual repeat control must be done through the streaming service app
  }

  async getShuffleMode(): Promise<KEFShuffleMode> {
    // KEF API only shows available modes, not current state
    // We maintain local state for UI display purposes only
    return this.shuffleMode;
  }

  async setShuffleMode(mode: KEFShuffleMode): Promise<void> {
    this.log(`[setShuffleMode] Setting local shuffle mode to: ${mode}`);
    this.shuffleMode = mode;
    // Note: This only updates the local state for display
    // The actual shuffle control must be done through the streaming service app
  }

  // Connection test
  async testConnection(): Promise<boolean> {
    try {
      await this.getSource();
      return true;
    } catch (error) {
      return false;
    }
  }
}
