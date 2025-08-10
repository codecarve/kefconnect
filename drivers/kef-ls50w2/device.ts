import { KEFBaseDevice } from "../../lib/KEFBaseDevice";

class KEFLS50W2Device extends KEFBaseDevice {
  protected getModelId(): string {
    return "kef-ls50w2";
  }
}

module.exports = KEFLS50W2Device;