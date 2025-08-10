// KEF Speaker Model Definitions

export interface KEFModelConfig {
  name: string;
  sources: string[];
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
      "source_input",
      "bass_extension",
      "desk_mode",
      "wall_mode",
      "speaker_balance"
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
      "source_input",
      "bass_extension",
      "desk_mode",
      "wall_mode",
      "speaker_balance"
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
  "kef-ls50": {
    name: "KEF LS50 Wireless",
    sources: ["wifi", "bluetooth", "tv", "optical", "analog"],
    capabilities: [
      "onoff",
      "volume_set",
      "volume_mute",
      "source_input"
    ],
    energyUsage: {
      usageOn: 115,  // 230W total system / 2 for average usagec
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
      "source_input",
      "bass_extension",
      "desk_mode",
      "wall_mode",
      "speaker_balance"
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
  return config.sources.includes(source.toLowerCase());
}

// Helper to get available sources for a model
export function getAvailableSources(modelId: string): string[] {
  const config = getModelConfig(modelId);
  return config.sources;
}

// Helper to detect model from speaker info
export async function detectModelFromSpeaker(speakerInfo: any): Promise<string> {
  // Try to detect model from speaker model string or serial number
  const rawModel = speakerInfo?.model || "";
  const model = rawModel.toLowerCase();
  const serial = (speakerInfo?.serialNumber || "").toUpperCase();

  // LSX variants
  if (model.includes("lsx ii lt") || model.includes("lsx2lt") || model.includes("lsx 2 lt") || serial.startsWith("LSX2LT")) {
    return "kef-lsx2lt";
  } else if (model.includes("lsx ii") || model.includes("lsx2") || model.includes("lsx 2") || serial.startsWith("LSX2")) {
    return "kef-lsx2";
  } else if ((model.includes("lsx") && !model.includes("ii") && !model.includes("2")) || (serial.startsWith("LSX") && !serial.startsWith("LSX2"))) {
    return "kef-lsx";
  }

  // LS50 variants
  if (model.includes("ls50 wireless ii") || model.includes("ls50w2") || model.includes("ls50 wireless 2") || serial.startsWith("LS50W2")) {
    return "kef-ls50w2";
  } else if ((model.includes("ls50 wireless") && !model.includes("ii") && !model.includes("2")) || serial.startsWith("LSW")) {
    return "kef-ls50";
  }

  // LS60
  if (model.includes("ls60") || serial.startsWith("LS60")) {
    return "kef-ls60";
  }

  // XIO Soundbar
  if (model.includes("xio") || serial.startsWith("XIO")) {
    return "kef-xio";
  }

  // Default to auto-detect if model can't be detected
  return "auto-detect";
}
