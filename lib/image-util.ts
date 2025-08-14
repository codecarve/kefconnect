import Homey from 'homey';

/**
 * Image utility functions for handling album art
 */
export class ImageUtil {
  /**
   * Create an album art image instance
   * @param homey - The Homey instance
   * @returns The created image instance
   */
  static async createAlbumArtImage(homey: any): Promise<any> {
    try {
      const image = await homey.images.createImage();
      // Don't set any initial path/URL - let it be empty
      return image;
    } catch (error) {
      throw new Error(`Failed to create album art image: ${error}`);
    }
  }

  /**
   * Update album art image with a new URL
   * @param image - The image instance to update
   * @param url - The new URL (null to clear the image)
   * @param allowedHost - Optional: The speaker's IP address to validate against
   * @param logger - Optional: Logger function for debugging
   * @returns Promise that resolves when the image is updated
   */
  static async updateAlbumArt(image: any, url: string | null, allowedHost?: string, logger?: (message: string) => void): Promise<void> {
    try {
      if (url) {
        if (logger) {
          logger(`[ImageUtil.updateAlbumArt] Updating with URL: ${url}`);
        }

        // Validate URL format
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          if (logger) {
            logger(`[ImageUtil.updateAlbumArt] Invalid URL format: ${url}`);
          }
          throw new Error(`Invalid album art URL: ${url}`);
        }

        // Security: Validate the URL host against the speaker's IP if provided
        if (allowedHost) {
          const urlObj = new URL(url);
          if (urlObj.hostname !== allowedHost) {
            if (logger) {
              logger(`[ImageUtil.updateAlbumArt] Security: URL host ${urlObj.hostname} does not match speaker IP ${allowedHost}`);
            }
            throw new Error(`Album art URL must be from the speaker at ${allowedHost}`);
          }
        }

        // Use setStream to fetch the image from the KEF speaker
        // This is more reliable for external URLs
        image.setStream(async (stream: any) => {
          const http = require('http');
          const https = require('https');
          const urlParts = new URL(url);
          const client = url.startsWith('https://') ? https : http;

          return new Promise((resolve, reject) => {
            let request: any = null;
            let responseHandled = false;

            // Helper function to cleanup resources
            const cleanup = () => {
              if (request && !request.destroyed) {
                request.destroy();
              }
            };

            // Security: Add size limit check via response headers
            request = client.get({
              hostname: urlParts.hostname,
              port: urlParts.port || (url.startsWith('https://') ? 443 : 80),
              path: urlParts.pathname + urlParts.search,
              timeout: 5000
            }, (response: any) => {
              if (logger) {
                logger(`[ImageUtil.updateAlbumArt] Response status: ${response.statusCode}`);
                logger(`[ImageUtil.updateAlbumArt] Response headers: ${JSON.stringify(response.headers)}`);
              }

              // Security: Check content length to prevent excessively large downloads
              const contentLength = parseInt(response.headers['content-length'] || '0', 10);
              const maxSize = 5 * 1024 * 1024; // 5MB limit
              if (contentLength > maxSize) {
                if (logger) {
                  logger(`[ImageUtil.updateAlbumArt] Image too large: ${contentLength} bytes`);
                }
                response.destroy();
                cleanup();
                responseHandled = true;
                reject(new Error(`Album art too large: ${contentLength} bytes (max ${maxSize} bytes)`));
                return;
              }

              if (response.statusCode === 200) {
                // Track bytes received to enforce size limit even without content-length header
                let bytesReceived = 0;
                response.on('data', (chunk: Buffer) => {
                  bytesReceived += chunk.length;
                  if (bytesReceived > maxSize) {
                    if (logger) {
                      logger(`[ImageUtil.updateAlbumArt] Stream exceeded size limit: ${bytesReceived} bytes`);
                    }
                    response.destroy();
                    cleanup();
                    if (!responseHandled) {
                      responseHandled = true;
                      reject(new Error(`Album art stream too large: ${bytesReceived} bytes (max ${maxSize} bytes)`));
                    }
                  }
                });

                response.pipe(stream);
                response.on('end', () => {
                  if (!responseHandled) {
                    responseHandled = true;
                    resolve(stream);
                  }
                });
                response.on('error', (err: any) => {
                  cleanup();
                  if (!responseHandled) {
                    responseHandled = true;
                    reject(err);
                  }
                });
              } else {
                if (logger) {
                  logger(`[ImageUtil.updateAlbumArt] Failed with status: ${response.statusCode}`);
                }
                cleanup();
                responseHandled = true;
                reject(new Error(`Failed to fetch album art: ${response.statusCode}`));
              }
            });

            request.on('error', (err: any) => {
              if (logger) {
                logger(`[ImageUtil.updateAlbumArt] Request error: ${err}`);
              }
              cleanup();
              if (!responseHandled) {
                responseHandled = true;
                reject(err);
              }
            });
            request.on('timeout', () => {
              if (logger) {
                logger('[ImageUtil.updateAlbumArt] Request timeout');
              }
              cleanup();
              if (!responseHandled) {
                responseHandled = true;
                reject(new Error('Album art fetch timeout'));
              }
            });
          });
        });

      } else {
        // Clear the image by setting to null path
        image.setPath(null);
      }

      // Trigger update to refresh the UI
      await image.update();

    } catch (error) {
      if (logger) {
        logger(`[ImageUtil.updateAlbumArt] Error: ${error}`);
      }
      throw new Error(`Failed to update album art: ${error}`);
    }
  }

  /**
   * Check if a URL is valid and accessible
   * @param url - The URL to check
   * @returns True if the URL is valid and accessible
   */
  static isValidUrl(url: string | null | undefined): boolean {
    if (!url) return false;

    try {
      const urlObj = new URL(url);
      return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
    } catch {
      return false;
    }
  }

  /**
   * Extract hostname from speaker's album art URL for validation
   * @param url - The album art URL from KEF speaker
   * @returns The hostname or null if invalid
   */
  static extractHostFromUrl(url: string): string | null {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch {
      return null;
    }
  }
}
