import { KEFBaseDevice } from "../../lib/KEFBaseDevice";

class KEFLSX2Device extends KEFBaseDevice {
  protected getModelId(): string {
    return "kef-lsx2";
  }
}

module.exports = KEFLSX2Device;
