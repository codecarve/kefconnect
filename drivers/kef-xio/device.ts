import { KEFBaseDevice } from "../../lib/KEFBaseDevice";

class KEFXIODevice extends KEFBaseDevice {
  protected getModelId(): string {
    return "kef-xio";
  }
}

module.exports = KEFXIODevice;
