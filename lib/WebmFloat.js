import { WebmBase } from "./WebmBase.js";
/** @extends WebmBase<number, number> */
export class WebmFloat extends WebmBase {
  /**
   * @param {string} [name]
   * @param {number} [start=0]
   */
  constructor(name, start = 0) {
    super(name, start);
  }
  /**
   * @returns {string}
   */
  getType() {
    return "Float";
  }
  /**
   * @returns {Float32ArrayConstructor | Float64ArrayConstructor}
   */
  getFloatArrayType() {
    return this.source && this.source.length === 4
      ? Float32Array
      : Float64Array;
  }
  /**
   * @returns {void}
   */
  updateBySource() {
    const byteArray = this.source.reverse();
    const floatArrayType = this.getFloatArrayType();
    const floatArray = new floatArrayType(byteArray.buffer);
    this.data = floatArray[0];
  }
  /**
   * @returns {void}
   */
  updateByData() {
    const floatArrayType = this.getFloatArrayType();
    const floatArray = new floatArrayType([this.data]);
    const byteArray = new Uint8Array(floatArray.buffer);
    this.source = byteArray.reverse();
  }
}
