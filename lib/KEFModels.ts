// KEF Speaker Model Definitions

import { KEFSource } from './KEFSpeaker';

export interface KEFModelConfig {
  name: string;
  sources: KEFSource[];
  capabilities: string[];
  energyUsage?: {
    usageOn: number;   // Watts when playing
    usageOff: number;  // Watts in standby
  };
}

export const KEF_MODELS: Record<string, KEFModelConfig> = {
  "kef-lsx2": {
    name: "KEF LSX II",
    sources: ["wifi", "bluetooth", "tv", "optical", "analog", "usb"],
    capabilities: [
      "onoff",
      "volume_set",
      "volume_mute",
      "source_input"
    ],
    energyUsage: {
      usageOn: 100,  // 200W total system / 2 for average usage
      usageOff: 5    // Estimated standby
    }
  },
  "kef-lsx2lt": {
    name: "KEF LSX II LT",
    sources: ["wifi", "bluetooth", "tv", "optical", "usb"],
    capabilities: [
      "onoff",
      "volume_set",
      "volume_mute",
      "source_input"
    ],
    energyUsage: {
      usageOn: 100,  // Same 200W total system as LSX II
      usageOff: 5    // Estimated standby
    }
  },
  "kef-ls50w2": {
    name: "KEF LS50 Wireless II",
    sources: ["wifi", "bluetooth", "tv", "optical", "coaxial", "analog"],
    capabilities: [
      "onoff",
      "volume_set",
      "volume_mute",
      "source_input"
    ],
    energyUsage: {
      usageOn: 190,  // 380W total per speaker, average usage
      usageOff: 5    // Estimated standby
    }
  },
  "kef-ls60": {
    name: "KEF LS60 Wireless",
    sources: ["wifi", "bluetooth", "tv", "optical", "coaxial", "analog"],
    capabilities: [
      "onoff",
      "volume_set",
      "volume_mute",
      "source_input"
    ],
    energyUsage: {
      usageOn: 450,  // Actual operating power consumption
      usageOff: 2    // Documented standby consumption
    }
  },
  "kef-lsx": {
    name: "KEF LSX",
    sources: ["wifi", "bluetooth", "tv", "optical", "analog"],
    capabilities: [
      "onoff",
      "volume_set",
      "volume_mute",
      "source_input"
    ],
    energyUsage: {
      usageOn: 100,  // 200W total system / 2 for average usage
      usageOff: 5    // Estimated standby
    }
  },
  "kef-xio": {
    name: "KEF XIO Soundbar",
    sources: ["wifi", "bluetooth", "tv", "optical"],
    capabilities: [
      "onoff",
      "volume_set",
      "volume_mute",
      "source_input"
    ],
    energyUsage: {
      usageOn: 200,  // 820W peak / 4 for average usage (soundbar)
      usageOff: 5    // Estimated standby
    }
  },
  "auto-detect": {
    name: "Auto-detected KEF Speaker",
    sources: ["wifi", "bluetooth", "tv", "optical", "coaxial", "analog", "usb"],
    capabilities: [
      "onoff",
      "volume_set",
      "volume_mute",
      "source_input"
    ],
    energyUsage: {
      usageOn: 150,  // Average for unknown models
      usageOff: 5    // Average standby
    }
  }
};

// Helper to get model config with fallback to auto-detect
export function getModelConfig(modelId: string): KEFModelConfig {
  return KEF_MODELS[modelId] || KEF_MODELS["auto-detect"];
}

// Helper to check if a source is supported by a model
export function isSourceSupported(modelId: string, source: string): boolean {
  const config = getModelConfig(modelId);
  return config.sources.includes(source.toLowerCase() as KEFSource);
}

