import { KEFBaseDevice } from "../../lib/KEFBaseDevice";

class KEFLSX2LTDevice extends KEFBaseDevice {
  protected getModelId(): string {
    return "kef-lsx2lt";
  }
}

module.exports = KEFLSX2LTDevice;