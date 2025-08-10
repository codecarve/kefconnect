import { KEFBaseDevice } from "../../lib/KEFBaseDevice";

class KEFLS60Device extends KEFBaseDevice {
  protected getModelId(): string {
    return "kef-ls60";
  }
}

module.exports = KEFLS60Device;